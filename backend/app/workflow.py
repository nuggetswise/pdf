"""Review, approval, automation policy, agent memory and ERP delivery (Slices 3-6).

States are kept apart on purpose:
  processing (source_documents.status) -> review (orders.review_state) -> approval (approvals table)
  -> delivery (orders.delivery_state, delivery_attempts) -> ERP acknowledgement (erp_sim_orders).
"""
from __future__ import annotations

import json
import logging
import shutil
from typing import Any

from .db import Database, now
from .validation import POLICY, load_reference, validate

log = logging.getLogger("order_agent.workflow")
SYSTEM = "system:order-agent"

SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    document_id INTEGER PRIMARY KEY REFERENCES source_documents(id),
    customer_id TEXT, po_number TEXT,
    current_version INTEGER NOT NULL,
    review_state TEXT NOT NULL,
    delivery_state TEXT NOT NULL DEFAULT 'not_started',
    erp_order_id TEXT,
    validation_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL,
    issue_key TEXT NOT NULL,
    fingerprint TEXT,
    action TEXT NOT NULL,
    params_json TEXT NOT NULL,
    reason TEXT,
    actor TEXT NOT NULL, role TEXT NOT NULL,
    version_created INTEGER,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL, version INTEGER NOT NULL,
    kind TEXT NOT NULL, actor TEXT NOT NULL, policy_mode TEXT NOT NULL, policy_version INTEGER NOT NULL,
    created_at TEXT NOT NULL, invalidated_at TEXT, invalidated_reason TEXT
);
CREATE TABLE IF NOT EXISTS automation_policy (
    id INTEGER PRIMARY KEY, mode TEXT NOT NULL, set_by TEXT NOT NULL, effective_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_rules (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    customer_id TEXT NOT NULL, obsolete_identifier TEXT NOT NULL,
    replacement_identifier TEXT NOT NULL, replacement_sku TEXT NOT NULL,
    reference_version TEXT NOT NULL, state TEXT NOT NULL,
    source_document_id INTEGER, source_decision_id INTEGER, evidence TEXT,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    activated_by TEXT, activated_at TEXT, revoked_by TEXT, revoked_at TEXT, revoke_reason TEXT
);
CREATE TABLE IF NOT EXISTS delivery_attempts (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL, version INTEGER NOT NULL, idempotency_key TEXT NOT NULL,
    state TEXT NOT NULL, detail TEXT, erp_order_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS erp_sim_orders (
    erp_order_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

REVIEWER_ROLES = {"reviewer", "administrator"}
LINE_EDIT_ACTIONS = {"change_quantity", "correct_price"}


class Forbidden(Exception):
    pass


class Conflict(Exception):
    pass


def init(db: Database) -> None:
    with db.connect() as conn:
        conn.executescript(SCHEMA)
        if conn.execute("SELECT COUNT(*) FROM automation_policy").fetchone()[0] == 0:
            conn.execute("INSERT INTO automation_policy (mode, set_by, effective_at) VALUES ('review_all', ?, ?)",
                         (SYSTEM, now()))


# ---------- settings (ERP simulator toggles, rehearsal mode) ----------

def get_setting(db: Database, key: str, default: str | None = None) -> str | None:
    with db.connect() as conn:
        r = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return r["value"] if r else default


def set_setting(db: Database, key: str, value: str | None) -> None:
    with db.connect() as conn:
        if value is None:
            conn.execute("DELETE FROM settings WHERE key = ?", (key,))
        else:
            conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
                         (key, value, value))


# ---------- policy ----------

def current_policy(db: Database) -> dict[str, Any]:
    with db.connect() as conn:
        return dict(conn.execute("SELECT * FROM automation_policy ORDER BY id DESC LIMIT 1").fetchone())


def set_policy(db: Database, mode: str, actor: str, role: str) -> dict[str, Any]:
    if role != "administrator":
        raise Forbidden("Only an administrator can change the automation mode")
    if mode not in ("review_all", "exception_only"):
        raise Conflict("Unknown mode")
    with db.connect() as conn:
        conn.execute("INSERT INTO automation_policy (mode, set_by, effective_at) VALUES (?, ?, ?)",
                     (mode, actor, now()))
        pid = conn.execute("SELECT MAX(id) FROM automation_policy").fetchone()[0]
        db.audit(conn, "policy", pid, "policy_changed", actor, {"mode": mode})
    return current_policy(db)


# ---------- evaluation ----------

def _status(db: Database, conn, doc_id: int, status: str, detail: dict | None = None) -> None:
    conn.execute("UPDATE source_documents SET status = ?, status_detail = NULL, updated_at = ? WHERE id = ?",
                 (status, now(), doc_id))
    db.audit(conn, "document", doc_id, status, SYSTEM, detail or {})


def _overrides(conn, doc_id: int) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for d in conn.execute("SELECT * FROM decisions WHERE document_id = ? ORDER BY id", (doc_id,)):
        p = json.loads(d["params_json"])
        if d["action"] == "map_item":
            out[d["issue_key"]] = {"sku": p["sku"], "text": f"Mapped to {p['sku']} by {d['actor'].partition(':')[2]} (decision "
                                                            f"#{d['id']})"}
        elif d["action"] == "apply_mapping":
            out[d["issue_key"]] = {"replacement_sku": p["replacement_sku"],
                                   "text": f"Mapping {p['obsolete_identifier']} -> {p['replacement_identifier']} "
                                           f"approved by {d['actor'].partition(':')[2]} for this order (decision #{d['id']})"}
        elif d["action"] in LINE_EDIT_ACTIONS:
            edit = out.setdefault(f"edit:{p['line_index']}", {})
            edit["quantity" if d["action"] == "change_quantity" else "unit_price"] = p["value"]
    return out


def _resolved(conn, doc_id: int) -> dict[tuple[str, str], dict]:
    res = {}
    for d in conn.execute("SELECT * FROM decisions WHERE document_id = ? ORDER BY id", (doc_id,)):
        res[(d["issue_key"], d["fingerprint"] or "")] = dict(d)
    return res


def _active_rules(conn) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute("SELECT * FROM memory_rules WHERE state = 'active'")]


def evaluate(db: Database, doc_id: int, conn=None) -> dict[str, Any]:
    """Run matching + validation on the current version and store the result. Pure recomputation."""
    own = conn is None
    ctx = db.connect() if own else None
    conn = ctx.__enter__() if own else conn
    try:
        ver = conn.execute("SELECT * FROM order_versions WHERE document_id = ? ORDER BY version DESC LIMIT 1",
                           (doc_id,)).fetchone()
        payload = json.loads(ver["payload_json"])
        others = [dict(r) for r in conn.execute(
            "SELECT o.document_id, o.customer_id, o.po_number FROM orders o WHERE o.document_id < ?"
            " AND o.review_state != 'rejected'", (doc_id,))]
        existing = conn.execute("SELECT validation_json FROM orders WHERE document_id = ?", (doc_id,)).fetchone()
        # Memory rules are applied at first validation; activation affects future orders, not this one.
        rules = (json.loads(existing["validation_json"]).get("rules_snapshot", []) if existing
                 else _active_rules(conn))
        result = validate(payload, load_reference(), rules, _overrides(conn, doc_id), others)
        resolved = _resolved(conn, doc_id)
        for issue in result["issues"]:
            hit = resolved.get((issue["key"], issue["fingerprint"]))
            issue["status"] = "resolved" if hit else "open"
            issue["resolution"] = ({"decision_id": hit["id"], "action": hit["action"], "actor": hit["actor"],
                                    "role": hit["role"], "reason": hit["reason"], "at": hit["created_at"]}
                                   if hit else None)
        result["rules_snapshot"] = rules
        result["version"] = ver["version"]
        order = result["order"]
        if existing is None:
            conn.execute("INSERT INTO orders (document_id, customer_id, po_number, current_version, review_state,"
                         " validation_json, updated_at) VALUES (?, ?, ?, ?, 'validating', ?, ?)",
                         (doc_id, order["customer_id"], order["po_number"], ver["version"], json.dumps(result),
                          now()))
        else:
            conn.execute("UPDATE orders SET current_version = ?, validation_json = ?, updated_at = ?"
                         " WHERE document_id = ?", (ver["version"], json.dumps(result), now(), doc_id))
        return result
    finally:
        if own:
            ctx.__exit__(None, None, None)


def open_blocking(result: dict[str, Any]) -> list[dict[str, Any]]:
    return [i for i in result["issues"] if i["blocking"] and i["status"] == "open"]


def _order(conn, doc_id: int) -> dict[str, Any] | None:
    r = conn.execute("SELECT * FROM orders WHERE document_id = ?", (doc_id,)).fetchone()
    return dict(r) if r else None


def _valid_approval(conn, doc_id: int, version: int):
    return conn.execute("SELECT * FROM approvals WHERE document_id = ? AND version = ? AND invalidated_at IS NULL",
                        (doc_id, version)).fetchone()


def process_after_extraction(db: Database, doc_id: int) -> None:
    with db.connect() as conn:
        _status(db, conn, doc_id, "matching")
        _status(db, conn, doc_id, "validating")
        result = evaluate(db, doc_id, conn)
        memory = [l["resolved_by"] for l in result["order"]["lines"]
                  if l.get("resolved_by") and l["resolved_by"]["type"] == "memory_rule"]
        for m in memory:
            db.audit(conn, "document", doc_id, "memory_rule_applied", SYSTEM, m)
    settle(db, doc_id)


def settle(db: Database, doc_id: int) -> None:
    """Move an order to its next state after any change: needs review, ready, approved, then delivery."""
    deliver_now = False
    with db.connect() as conn:
        order = _order(conn, doc_id)
        if order is None or order["review_state"] in ("rejected", "awaiting_customer", "amendment_held"):
            return
        result = json.loads(order["validation_json"])
        blocking = open_blocking(result)
        version = order["current_version"]
        if _valid_approval(conn, doc_id, version):
            deliver_now = order["delivery_state"] in ("not_started",)
        elif blocking:
            new = "needs_review"
            if order["review_state"] != new:
                conn.execute("UPDATE orders SET review_state = ? WHERE document_id = ?", (new, doc_id))
                _status(db, conn, doc_id, "needs_review", {"open_issues": [i["code"] for i in blocking]})
        else:
            policy = current_policy(db)
            human_decisions = conn.execute("SELECT COUNT(*) FROM decisions WHERE document_id = ?",
                                           (doc_id,)).fetchone()[0]
            if policy["mode"] == "exception_only" and human_decisions == 0:
                _approve(db, conn, doc_id, version, "system", f"policy:exception_only#{policy['id']}", policy)
                deliver_now = True
            elif order["review_state"] != "ready":
                conn.execute("UPDATE orders SET review_state = 'ready' WHERE document_id = ?", (doc_id,))
                _status(db, conn, doc_id, "ready_for_approval", {"policy": policy["mode"]})
    if deliver_now:
        deliver(db, doc_id)


def _approve(db: Database, conn, doc_id: int, version: int, kind: str, actor: str, policy: dict) -> None:
    conn.execute("INSERT INTO approvals (document_id, version, kind, actor, policy_mode, policy_version, created_at)"
                 " VALUES (?, ?, ?, ?, ?, ?, ?)", (doc_id, version, kind, actor, policy["mode"], policy["id"], now()))
    conn.execute("UPDATE orders SET review_state = 'approved' WHERE document_id = ?", (doc_id,))
    _status(db, conn, doc_id, "approved", {"kind": kind, "actor": actor, "version": version,
                                           "policy": policy["mode"], "policy_version": policy["id"]})


# ---------- reviewer actions ----------

def _require_reviewer(role: str) -> None:
    if role not in REVIEWER_ROLES:
        raise Forbidden("Reviewer or administrator role required")


def _new_version(db: Database, conn, doc_id: int, actor: str, decision_id: int) -> int:
    latest = conn.execute("SELECT * FROM order_versions WHERE document_id = ? ORDER BY version DESC LIMIT 1",
                          (doc_id,)).fetchone()
    payload = json.loads(latest["payload_json"])
    payload.setdefault("applied_decisions", []).append(decision_id)
    version = latest["version"] + 1
    conn.execute("INSERT INTO order_versions (document_id, version, origin, extractor, payload_json, created_by,"
                 " created_at) VALUES (?, ?, 'review', ?, ?, ?, ?)",
                 (doc_id, version, latest["extractor"], json.dumps(payload), actor, now()))
    for a in conn.execute("SELECT id FROM approvals WHERE document_id = ? AND invalidated_at IS NULL", (doc_id,)):
        conn.execute("UPDATE approvals SET invalidated_at = ?, invalidated_reason = ? WHERE id = ?",
                     (now(), f"superseded by version {version}", a["id"]))
        db.audit(conn, "document", doc_id, "approval_invalidated", actor, {"approval_id": a["id"],
                                                                           "new_version": version})
    return version


def decide(db: Database, doc_id: int, issue_key: str, action: str, params: dict[str, Any], reason: str | None,
           actor: str, role: str) -> dict[str, Any]:
    _require_reviewer(role)
    with db.connect() as conn:
        order = _order(conn, doc_id)
        if order is None:
            raise Conflict("Order has not been validated")
        if order["delivery_state"] not in ("not_started", "failed"):
            if action in LINE_EDIT_ACTIONS:
                return _hold_amendment(db, conn, doc_id, actor, action, params)
            raise Conflict("Order was already delivered; changes are held as amendments")
        result = json.loads(order["validation_json"])
        if action in LINE_EDIT_ACTIONS and issue_key.startswith("edit:"):
            issue = {"key": issue_key, "fingerprint": None, "code": "edit", "actions": list(LINE_EDIT_ACTIONS),
                     "line_index": int(issue_key.split(":")[1]), "proposal": None}
        else:
            issue = next((i for i in result["issues"] if i["key"] == issue_key and i["status"] == "open"), None)
            if issue is None:
                raise Conflict("No open issue with that key")
        if action not in issue["actions"] and not (action in LINE_EDIT_ACTIONS and issue["code"] in
                                                    ("moq_violation", "price_mismatch")):
            raise Conflict(f"Action {action} is not allowed for {issue['code']}")
        if action in ("one_off_exception", "accept_printed_price", "acknowledge_total_difference", "confirm_field",
                      "accept_as_revision", "reject_order", "change_quantity", "correct_price") and not reason:
            raise Conflict("A reason is required for this decision")
        stored: dict[str, Any] = {}
        if action == "map_item":
            sku = params.get("sku")
            if sku not in {p["sku"] for p in load_reference()["products"]}:
                raise Conflict("Unknown SKU")
            stored = {"sku": sku}
        elif action == "apply_mapping":
            proposal = issue.get("proposal")
            if not proposal:
                raise Conflict("No proposed mapping exists for this identifier")
            stored = {k: proposal[k] for k in ("obsolete_identifier", "replacement_identifier", "replacement_sku")}
            stored["save_for_future"] = bool(params.get("save_for_future"))
        elif action in LINE_EDIT_ACTIONS:
            from .validation import dec
            value = dec(params.get("value"))
            if value is None or value <= 0:
                raise Conflict("A positive decimal value is required")
            stored = {"line_index": issue["line_index"], "value": str(value), "authorised_by": actor}
        elif action == "request_customer_correction":
            stored = {"note": params.get("note") or "Customer asked to correct the order"}
        cur = conn.execute("INSERT INTO decisions (document_id, issue_key, fingerprint, action, params_json, reason,"
                           " actor, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           (doc_id, issue_key, issue["fingerprint"], action, json.dumps(stored), reason, actor, role,
                            now()))
        decision_id = cur.lastrowid
        version = _new_version(db, conn, doc_id, actor, decision_id)
        conn.execute("UPDATE decisions SET version_created = ? WHERE id = ?", (version, decision_id))
        db.audit(conn, "document", doc_id, "decision_recorded", actor,
                 {"decision_id": decision_id, "issue": issue_key, "action": action, "reason": reason,
                  "role": role, "version": version, **stored})
        if action == "reject_order":
            conn.execute("UPDATE orders SET review_state = 'rejected' WHERE document_id = ?", (doc_id,))
            _status(db, conn, doc_id, "rejected", {"actor": actor, "reason": reason})
        elif action == "request_customer_correction":
            conn.execute("UPDATE orders SET review_state = 'awaiting_customer' WHERE document_id = ?", (doc_id,))
            _status(db, conn, doc_id, "awaiting_customer", {"actor": actor})
        if action == "apply_mapping" and stored["save_for_future"]:
            _save_candidate(db, conn, doc_id, decision_id, stored, actor, issue)
        result = evaluate(db, doc_id, conn)
        # Approving the final exception is the reviewer's approval of this exact version (no Send click).
        if not open_blocking(result) and _order(conn, doc_id)["review_state"] not in ("rejected",
                                                                                      "awaiting_customer"):
            _approve(db, conn, doc_id, version, "human", actor, current_policy(db))
    settle(db, doc_id)
    return get_state(db, doc_id)


def approve(db: Database, doc_id: int, actor: str, role: str) -> dict[str, Any]:
    """Explicit approval of a clean order (Review-all mode). Delivery then starts automatically."""
    _require_reviewer(role)
    with db.connect() as conn:
        order = _order(conn, doc_id)
        if order is None or order["review_state"] != "ready":
            raise Conflict("Only a validated order with no open issues can be approved")
        _approve(db, conn, doc_id, order["current_version"], "human", actor, current_policy(db))
    settle(db, doc_id)
    return get_state(db, doc_id)


def _hold_amendment(db: Database, conn, doc_id: int, actor: str, action: str, params: dict) -> dict[str, Any]:
    conn.execute("UPDATE orders SET review_state = 'amendment_held' WHERE document_id = ?", (doc_id,))
    db.audit(conn, "document", doc_id, "amendment_held", actor,
             {"action": action, "params": params,
              "detail": "Order already delivered to ERP; the ERP record is not overwritten. A separate decision is "
                        "required."})
    return {"held": True}


# ---------- agent memory ----------

def _save_candidate(db: Database, conn, doc_id: int, decision_id: int, stored: dict, actor: str,
                    issue: dict) -> None:
    order = _order(conn, doc_id)
    ref = load_reference()
    cur = conn.execute(
        "INSERT INTO memory_rules (kind, customer_id, obsolete_identifier, replacement_identifier, replacement_sku,"
        " reference_version, state, source_document_id, source_decision_id, evidence, created_by, created_at)"
        " VALUES ('identifier_mapping', ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?)",
        (order["customer_id"], stored["obsolete_identifier"], stored["replacement_identifier"],
         stored["replacement_sku"], ref["reference_version"], doc_id, decision_id, issue.get("evidence"), actor,
         now()))
    db.audit(conn, "memory_rule", cur.lastrowid, "rule_candidate_saved", actor,
             {"customer_id": order["customer_id"], "from": stored["obsolete_identifier"],
              "to": stored["replacement_identifier"], "source_document_id": doc_id})


def list_rules(db: Database) -> list[dict[str, Any]]:
    with db.connect() as conn:
        rules = [dict(r) for r in conn.execute("SELECT * FROM memory_rules ORDER BY id")]
        for r in rules:
            r["uses"] = [dict(a) for a in conn.execute(
                "SELECT entity_id AS document_id, created_at FROM audit_events WHERE event = 'memory_rule_applied'"
                " AND json_extract(detail_json, '$.rule_id') = ?", (r["id"],))]
    return rules


def set_rule_state(db: Database, rule_id: int, target: str, actor: str, role: str, reason: str | None) -> dict:
    if role != "administrator":
        raise Forbidden("Only an administrator can activate or revoke memory rules")
    with db.connect() as conn:
        rule = conn.execute("SELECT * FROM memory_rules WHERE id = ?", (rule_id,)).fetchone()
        if rule is None:
            raise Conflict("Unknown rule")
        if target == "active" and rule["state"] != "candidate":
            raise Conflict("Only a candidate can be activated")
        if target == "revoked" and rule["state"] == "revoked":
            raise Conflict("Rule already revoked")
        if target == "active":
            conn.execute("UPDATE memory_rules SET state = 'active', activated_by = ?, activated_at = ? WHERE id = ?",
                         (actor, now(), rule_id))
        else:
            conn.execute("UPDATE memory_rules SET state = 'revoked', revoked_by = ?, revoked_at = ?,"
                         " revoke_reason = ? WHERE id = ?", (actor, now(), reason, rule_id))
        db.audit(conn, "memory_rule", rule_id, f"rule_{target}", actor, {"reason": reason})
    return next(r for r in list_rules(db) if r["id"] == rule_id)


# ---------- ERP simulator (local, persistent; no live ERP) ----------

class ErpFailed(Exception):
    pass


class ErpTimeout(Exception):
    pass


def erp_submit(db: Database, key: str, payload: dict[str, Any]) -> str:
    mode = get_setting(db, "erp_failure_mode", "none")
    if mode == "fail_next":
        set_setting(db, "erp_failure_mode", None)
        raise ErpFailed("ERP simulator rejected the request (simulated outage)")
    with db.connect() as conn:
        existing = conn.execute("SELECT erp_order_id FROM erp_sim_orders WHERE idempotency_key = ?",
                                (key,)).fetchone()
        if existing:
            erp_id = existing["erp_order_id"]
        else:
            n = conn.execute("SELECT COUNT(*) FROM erp_sim_orders").fetchone()[0]
            erp_id = f"SIM-ERP-{100001 + n}"
            conn.execute("INSERT INTO erp_sim_orders (erp_order_id, idempotency_key, payload_json, created_at)"
                         " VALUES (?, ?, ?, ?)", (erp_id, key, json.dumps(payload), now()))
    if mode == "timeout_next":
        set_setting(db, "erp_failure_mode", None)
        raise ErpTimeout("No response from ERP simulator after the order was created (simulated timeout)")
    return erp_id


def erp_lookup(db: Database, key: str) -> str | None:
    with db.connect() as conn:
        r = conn.execute("SELECT erp_order_id FROM erp_sim_orders WHERE idempotency_key = ?", (key,)).fetchone()
    return r["erp_order_id"] if r else None


def _delivery_state(db: Database, doc_id: int, attempt_id: int | None, state: str, detail: str | None = None,
                    erp_id: str | None = None, version: int | None = None, key: str | None = None) -> int:
    with db.connect() as conn:
        if attempt_id is None:
            attempt_id = conn.execute(
                "INSERT INTO delivery_attempts (document_id, version, idempotency_key, state, detail, created_at,"
                " updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (doc_id, version, key, state, detail, now(), now())
            ).lastrowid
        else:
            conn.execute("UPDATE delivery_attempts SET state = ?, detail = ?, erp_order_id = ?, updated_at = ?"
                         " WHERE id = ?", (state, detail, erp_id, now(), attempt_id))
        conn.execute("UPDATE orders SET delivery_state = ?, erp_order_id = COALESCE(?, erp_order_id)"
                     " WHERE document_id = ?", (state, erp_id, doc_id))
        db.audit(conn, "document", doc_id, f"delivery_{state}", SYSTEM,
                 {"attempt_id": attempt_id, "idempotency_key": key, "erp_order_id": erp_id, "detail": detail})
    return attempt_id


def deliver(db: Database, doc_id: int) -> None:
    """Automatic delivery after approval. Idempotency key = document hash + approved version."""
    with db.connect() as conn:
        order = _order(conn, doc_id)
        approval = _valid_approval(conn, doc_id, order["current_version"])
        if approval is None or order["delivery_state"] in ("submitting", "erp_created"):
            return
        sha = conn.execute("SELECT sha256 FROM source_documents WHERE id = ?", (doc_id,)).fetchone()["sha256"]
    version = order["current_version"]
    key = f"{sha[:16]}:v{version}"
    result = json.loads(order["validation_json"])
    attempt = _delivery_state(db, doc_id, None, "queued", "Queued automatically after approval", version=version,
                              key=key)
    existing = erp_lookup(db, key)  # reconcile before any (re)submission
    if existing:
        _delivery_state(db, doc_id, attempt, "erp_created", "Reconciled: ERP already holds this order",
                        existing, key=key)
        return
    _delivery_state(db, doc_id, attempt, "submitting", None, key=key)
    payload = {"idempotency_key": key, "approved_version": version, "approval": {
        "kind": approval["kind"], "actor": approval["actor"], "policy": approval["policy_mode"]},
        "order": result["order"]}
    try:
        erp_id = erp_submit(db, key, payload)
    except ErpFailed as exc:
        _delivery_state(db, doc_id, attempt, "failed", str(exc), key=key)
        return
    except ErpTimeout as exc:
        _delivery_state(db, doc_id, attempt, "unknown", str(exc), key=key)
        return
    _delivery_state(db, doc_id, attempt, "erp_created", "ERP simulator acknowledged the order", erp_id, key=key)


def retry_delivery(db: Database, doc_id: int, actor: str, role: str) -> dict[str, Any]:
    _require_reviewer(role)
    with db.connect() as conn:
        order = _order(conn, doc_id)
        if order is None or order["delivery_state"] not in ("failed", "unknown"):
            raise Conflict("Only failed or unknown deliveries can be retried")
        conn.execute("UPDATE orders SET delivery_state = 'not_started' WHERE document_id = ?", (doc_id,))
        db.audit(conn, "document", doc_id, "delivery_retry_requested", actor, {})
    deliver(db, doc_id)
    return get_state(db, doc_id)


def recover_deliveries(db: Database) -> None:
    """After a restart: reconcile any delivery left queued, submitting or unknown."""
    with db.connect() as conn:
        ids = [r["document_id"] for r in conn.execute(
            "SELECT document_id FROM orders WHERE delivery_state IN ('queued', 'submitting', 'unknown')")]
        for doc_id in ids:
            conn.execute("UPDATE orders SET delivery_state = 'not_started' WHERE document_id = ?", (doc_id,))
    for doc_id in ids:
        deliver(db, doc_id)


# ---------- read models ----------

def get_state(db: Database, doc_id: int) -> dict[str, Any] | None:
    with db.connect() as conn:
        order = _order(conn, doc_id)
        if order is None:
            return None
        order["validation"] = json.loads(order.pop("validation_json"))
        order["validation"].pop("rules_snapshot", None)
        order["approvals"] = [dict(a) for a in conn.execute(
            "SELECT * FROM approvals WHERE document_id = ? ORDER BY id", (doc_id,))]
        order["decisions"] = [dict(d) | {"params": json.loads(d["params_json"])} for d in conn.execute(
            "SELECT * FROM decisions WHERE document_id = ? ORDER BY id", (doc_id,))]
        order["deliveries"] = [dict(d) for d in conn.execute(
            "SELECT * FROM delivery_attempts WHERE document_id = ? ORDER BY id", (doc_id,))]
        if order["erp_order_id"]:
            erp = conn.execute("SELECT * FROM erp_sim_orders WHERE erp_order_id = ?",
                               (order["erp_order_id"],)).fetchone()
            order["erp_record"] = dict(erp) | {"payload": json.loads(erp["payload_json"])} if erp else None
    for d in order["decisions"]:
        d.pop("params_json", None)
    if order.get("erp_record"):
        order["erp_record"].pop("payload_json", None)
    return order


def erp_orders(db: Database) -> list[dict[str, Any]]:
    with db.connect() as conn:
        return [dict(r) | {"payload": json.loads(r["payload_json"])} for r in
                conn.execute("SELECT * FROM erp_sim_orders ORDER BY created_at")]


def summary(db: Database) -> dict[str, Any]:
    with db.connect() as conn:
        docs = conn.execute("SELECT COUNT(*) FROM source_documents").fetchone()[0]
        rows = [dict(r) for r in conn.execute("SELECT review_state, delivery_state FROM orders")]
        auto = conn.execute("SELECT COUNT(*) FROM approvals WHERE kind = 'system' AND invalidated_at IS NULL"
                            ).fetchone()[0]
        mem = conn.execute("SELECT COUNT(*) FROM audit_events WHERE event = 'memory_rule_applied'").fetchone()[0]
    return {
        "orders_received": docs,
        "delivered_to_erp": sum(r["delivery_state"] == "erp_created" for r in rows),
        "auto_approved_by_policy": auto,
        "held_for_review": sum(r["review_state"] in ("needs_review", "ready", "awaiting_customer", "amendment_held")
                               for r in rows),
        "resolved_by_memory": mem,
        "delivery_problems": sum(r["delivery_state"] in ("failed", "unknown") for r in rows),
    }


def reset_demo(db: Database, data_dir, actor: str, role: str) -> None:
    if role != "administrator":
        raise Forbidden("Only an administrator can reset the demo")
    with db.connect() as conn:
        for table in ("erp_sim_orders", "delivery_attempts", "approvals", "decisions", "memory_rules", "orders",
                      "order_versions", "audit_events", "source_documents", "email_envelopes", "automation_policy",
                      "settings"):
            conn.execute(f"DELETE FROM {table}")  # fixed table names, no user input
        conn.execute("INSERT INTO automation_policy (mode, set_by, effective_at) VALUES ('review_all', ?, ?)",
                     (actor, now()))
        db.audit(conn, "system", 0, "demo_reset", actor, {})
    shutil.rmtree(data_dir / "files", ignore_errors=True)


__all__ = ["POLICY"]
