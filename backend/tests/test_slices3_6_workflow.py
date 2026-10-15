"""Slices 3-6: validation, review, approval modes, ERP delivery and agent memory.

Covers P03-P15, P19-P27. All data is fictional fixture data; extraction uses the labelled TEST ADAPTER.
"""
import json
from decimal import Decimal
from pathlib import Path

from app.extraction import FixtureTestExtractor, normalise
from app.validation import load_reference, validate

ROOT = Path(__file__).resolve().parents[2]
GEN = ROOT / "fixtures" / "demo" / "generated"
GOLDEN = json.loads((ROOT / "fixtures" / "demo" / "golden-expected.json").read_text())
REG_GOLDEN = json.loads((ROOT / "fixtures" / "regression" / "golden-expected.json").read_text())
REVIEWER = {"X-Demo-Role": "reviewer", "X-Demo-User": "rita"}
ADMIN = {"X-Demo-Role": "administrator", "X-Demo-User": "alex"}

SAMPLE = """FICTIONAL TEST PURCHASE ORDER
PO: {po}
Customer ID: {cust}
Ship-to: {ship}
Currency: {cur}
Line | GTIN | Description | Quantity | Unit | Unit price | Amount
A | DEMO-GTIN-A01 | Demo granola case | 10 | CASE | 24.00 | 240.00
Subtotal: 240.00
Tax amount: 0.00
Shipping amount: 0.00
Total: {total}
"""


def run_validate(text, rules=None, overrides=None):
    pages = [text]
    ex = FixtureTestExtractor()
    return validate(normalise(ex.extract(pages), pages, ex), load_reference(), rules, overrides)


def codes(result):
    return sorted(i["code"] for i in result["issues"])


def forward(client, name):
    return client.post(f"/api/demo/forward/{name}").json()["document_ids"][0]


def state(client, doc_id):
    return client.get(f"/api/documents/{doc_id}").json()


def issue(detail, code):
    return next(i for i in detail["order"]["validation"]["issues"] if i["code"] == code and i["status"] == "open")


def resolve_demo_001(client, doc_id, save=True):
    d = state(client, doc_id)
    client.post(f"/api/documents/{doc_id}/decisions", headers=REVIEWER, json={
        "issue_key": issue(d, "moq_violation")["key"], "action": "one_off_exception",
        "reason": "Customer confirmed one-off trial quantity (fictional)"})
    client.post(f"/api/documents/{doc_id}/decisions", headers=REVIEWER, json={
        "issue_key": issue(d, "price_mismatch")["key"], "action": "accept_printed_price",
        "reason": "Promotional price agreed by account manager (fictional)"})
    r = client.post(f"/api/documents/{doc_id}/decisions", headers=REVIEWER, json={
        "issue_key": issue(d, "outdated_identifier")["key"], "action": "apply_mapping",
        "params": {"save_for_future": save}})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Slice 3: validation ----------

def test_video_demo_001_has_exactly_moq_price_and_gtin_issues(make_client):
    client = make_client()
    d = state(client, forward(client, "VIDEO-DEMO-001"))
    issues = d["order"]["validation"]["issues"]
    assert sorted(i["code"] for i in issues) == ["moq_violation", "outdated_identifier", "price_mismatch"]
    moq = issue(d, "moq_violation")
    assert (moq["printed_value"], moq["reference_value"]) == ("5 CASE", "10 CASE")  # P19
    price = issue(d, "price_mismatch")
    assert (price["printed_value"], price["reference_value"]) == ("26.00", "24.00")  # P20
    gtin = issue(d, "outdated_identifier")
    assert gtin["printed_value"] == "OLD-DEMO-003" and gtin["reference_value"] == "NEW-DEMO-003"  # P21
    lines = d["order"]["validation"]["order"]["lines"]
    assert lines[0]["quantity"] == "5" and lines[1]["printed_unit_price"] == "26.00"
    assert lines[2]["sku"] is None  # no mapping applied without a decision
    assert d["order"]["validation"]["order"]["totals"]["printed_total"] == GOLDEN["VIDEO-DEMO-001"]["total"]
    assert d["document"]["status"] == "needs_review"


def test_regression_sample_produces_three_golden_issues(make_client):
    client = make_client()
    d = state(client, forward(client, "DEMO-PO-001"))
    v = d["order"]["validation"]
    assert sorted(i["code"] for i in v["issues"]) == ["price_mismatch", "unit_conversion", "unknown_item"]
    conv = issue(d, "unit_conversion")  # P06
    assert (conv["printed_value"], conv["reference_value"]) == ("24 EA", "2 CASE")
    line2 = v["order"]["lines"][1]
    assert (line2["original_quantity"], line2["original_unit"], line2["quantity"], line2["unit"]) == \
        ("24", "EA", "2", "CASE")
    assert line2["unit_price"] == "24.00"
    assert issue(d, "price_mismatch")["printed_value"] == "24.00"  # P05: printed price preserved
    assert issue(d, "unknown_item")["printed_value"] == "NF-NEW"  # P04
    # Resolve with the golden operator resolutions and compare to golden resolved lines.
    doc_id = d["document"]["id"]
    for key, action, extra in [(issue(d, "price_mismatch")["key"], "accept_printed_price", {}),
                               (conv["key"], "confirm_conversion", {}),
                               (issue(d, "unknown_item")["key"], "map_item", {"sku": "NEW-CASE"})]:
        r = client.post(f"/api/documents/{doc_id}/decisions", headers=REVIEWER,
                        json={"issue_key": key, "action": action, "params": extra, "reason": "golden resolution"})
        assert r.status_code == 200, r.text
    lines = state(client, doc_id)["order"]["validation"]["order"]["lines"]
    got = [{k: l[k] for k in ("sku", "quantity", "unit", "unit_price")} | {"amount": l["line_amount"]}
           for l in lines]
    assert got == REG_GOLDEN["resolved_lines"]


def test_p03_unknown_customer_blocks_and_is_never_reassigned():
    r = run_validate(SAMPLE.format(po="X1", cust="DEMO-CUST-99", ship="DEMO-DC-01", cur="CAD", total="240.00"))
    assert "unknown_customer" in codes(r)
    assert r["order"]["customer_id"] is None


def test_p12_missing_currency_stays_unknown_and_blocks():
    text = SAMPLE.format(po="X1", cust="DEMO-CUST-01", ship="DEMO-DC-01", cur="", total="240.00")
    r = run_validate(text.replace("Currency: \n", ""))
    assert "missing_currency" in codes(r) and r["order"]["currency"] is None


def test_p13_and_p27_totals_use_decimal_and_keep_printed_values():
    r = run_validate(SAMPLE.format(po="X1", cust="DEMO-CUST-01", ship="DEMO-DC-01", cur="CAD", total="250.00"))
    t = r["order"]["totals"]
    assert t["printed_total"] == "250.00" and t["computed_total"] == "240.00"
    assert "total_mismatch" in codes(r)
    for name, g in GOLDEN.items():
        if name.startswith("VIDEO"):
            assert Decimal(g["subtotal"]) + Decimal(g["tax"]) + Decimal(g["shipping"]) == Decimal(g["total"])


def test_unknown_ship_to_blocks():
    r = run_validate(SAMPLE.format(po="X1", cust="DEMO-CUST-01", ship="DEMO-DC-99", cur="CAD", total="240.00"))
    assert codes(r) == ["unknown_ship_to"]


def test_p08_same_customer_and_po_with_changed_content_is_held_as_revision(make_client):
    client = make_client()
    forward(client, "VIDEO-DEMO-002")
    pdf = (GEN / "VIDEO-DEMO-002.pdf").read_bytes() + b"\n% changed revision bytes\n"
    doc_id = client.post("/api/intake/demo-envelope", data={"sender": "orders@northfield-demo.example"},
                         files={"file": ("rev.pdf", pdf, "application/pdf")}).json()["document_ids"][0]
    d = state(client, doc_id)
    assert "possible_revision" in [i["code"] for i in d["order"]["validation"]["issues"]]
    assert d["order"]["delivery_state"] == "not_started"


# ---------- Slice 4: review, roles, modes ----------

def test_p24_review_all_holds_clean_order_until_human_approval(make_client):
    client = make_client()
    doc_id = forward(client, "DEMO-PO-001")
    d = state(client, doc_id)
    assert d["order"]["review_state"] == "needs_review"
    # Viewer cannot decide (P15 role check)
    r = client.post(f"/api/documents/{doc_id}/decisions",
                    json={"issue_key": issue(d, "unit_conversion")["key"], "action": "confirm_conversion"})
    assert r.status_code == 403


def test_p22_exception_only_clean_order_auto_delivers_without_send(make_client):
    client = make_client()
    assert client.put("/api/policy", json={"mode": "exception_only"}, headers=REVIEWER).status_code == 403
    assert client.put("/api/policy", json={"mode": "exception_only"}, headers=ADMIN).json()["mode"] == \
        "exception_only"
    # VIDEO-DEMO-001 resolved, mapping saved & activated, then VIDEO-DEMO-002 is clean.
    resolve_demo_001(client, forward(client, "VIDEO-DEMO-001"))
    rule = client.get("/api/memory-rules").json()[0]
    client.post(f"/api/memory-rules/{rule['id']}/state", json={"state": "active"}, headers=ADMIN)
    d = state(client, forward(client, "VIDEO-DEMO-002"))
    o = d["order"]
    assert o["validation"]["issues"] == []
    assert o["approvals"][0]["kind"] == "system" and o["approvals"][0]["policy_mode"] == "exception_only"
    assert o["delivery_state"] == "erp_created" and o["erp_order_id"].startswith("SIM-ERP-")
    assert o["erp_record"]["payload"]["order"]["totals"]["printed_total"] == "306.00"


def test_p23_and_p14_final_exception_approval_starts_delivery_and_is_audited(make_client):
    client = make_client()
    doc_id = forward(client, "VIDEO-DEMO-001")
    out = resolve_demo_001(client, doc_id)
    assert out["approvals"][-1]["kind"] == "human" and out["approvals"][-1]["actor"] == "reviewer:rita"
    assert out["delivery_state"] == "erp_created"
    order = out["validation"]["order"]
    # Golden: quantity, price and total unchanged at 190.00; GTIN mapping traceable.
    assert [l["quantity"] for l in order["lines"]] == ["5", "2", "1"]
    assert order["lines"][1]["unit_price"] == "26.00"
    assert order["totals"]["computed_total"] == "190.00" == order["totals"]["printed_total"]
    assert order["lines"][2]["sku"] == "DEMO-SKU-C" and order["lines"][2]["printed_gtin"] == "OLD-DEMO-003"
    assert "decision" in order["lines"][2]["resolved_by"]["text"]
    events = [t["event"] for t in state(client, doc_id)["timeline"]]
    for e in ("extracted", "needs_review", "decision_recorded", "approved", "delivery_queued",
              "delivery_submitting", "delivery_erp_created"):
        assert e in events
    # No reusable price/MOQ rule created
    assert [r["kind"] for r in client.get("/api/memory-rules").json()] == ["identifier_mapping"]


def test_p09_edit_after_approval_invalidates_it(make_client):
    client = make_client()
    client.put("/api/demo/erp-failure-mode", json={"value": "fail_next"}, headers=ADMIN)
    doc_id = forward(client, "VIDEO-DEMO-001")
    out = resolve_demo_001(client, doc_id)
    assert out["delivery_state"] == "failed"
    v = out["current_version"]
    r = client.post(f"/api/documents/{doc_id}/decisions", headers=REVIEWER, json={
        "issue_key": "edit:1", "action": "correct_price", "params": {"value": "24.00"}, "reason": "typo"})
    o = r.json()
    assert o["current_version"] == v + 1
    assert o["approvals"][-1]["invalidated_at"] is not None
    # P27: changed price changes the computed total; printed total stays and needs a recorded resolution.
    tm = [i for i in o["validation"]["issues"] if i["code"] == "total_mismatch"]
    assert tm and tm[0]["printed_value"] == "190.00" and tm[0]["reference_value"] == "186.00"
    assert o["review_state"] == "needs_review"


def test_moq_quantity_is_never_raised_without_authorised_change(make_client):
    client = make_client()
    doc_id = forward(client, "VIDEO-DEMO-001")
    d = state(client, doc_id)
    r = client.post(f"/api/documents/{doc_id}/decisions", headers=REVIEWER,
                    json={"issue_key": issue(d, "moq_violation")["key"], "action": "one_off_exception"})
    assert r.status_code == 409  # reason required
    assert state(client, doc_id)["order"]["validation"]["order"]["lines"][0]["quantity"] == "5"


# ---------- Slice 5: ERP delivery ----------

def test_p07_reuploading_identical_file_creates_no_second_erp_order(make_client):
    client = make_client()
    client.put("/api/policy", json={"mode": "exception_only"}, headers=ADMIN)
    resolve_demo_001(client, forward(client, "VIDEO-DEMO-001"))
    second = forward(client, "VIDEO-DEMO-001")
    assert state(client, second)["document"]["status"] == "duplicate"
    assert len(client.get("/api/erp/orders").json()) == 1


def test_p10_failed_delivery_retry_uses_same_idempotency_key(make_client):
    client = make_client()
    client.put("/api/demo/erp-failure-mode", json={"value": "fail_next"}, headers=ADMIN)
    doc_id = forward(client, "VIDEO-DEMO-001")
    out = resolve_demo_001(client, doc_id)
    assert out["delivery_state"] == "failed"
    out = client.post(f"/api/documents/{doc_id}/retry-delivery", headers=REVIEWER).json()
    keys = {a["idempotency_key"] for a in out["deliveries"]}
    assert len(keys) == 1 and out["delivery_state"] == "erp_created"


def test_p11_timeout_after_create_reconciles_to_one_erp_order(make_client):
    client = make_client()
    client.put("/api/demo/erp-failure-mode", json={"value": "timeout_next"}, headers=ADMIN)
    doc_id = forward(client, "VIDEO-DEMO-001")
    out = resolve_demo_001(client, doc_id)
    assert out["delivery_state"] == "unknown"
    out = client.post(f"/api/documents/{doc_id}/retry-delivery", headers=REVIEWER).json()
    assert out["delivery_state"] == "erp_created"
    assert "Reconciled" in out["deliveries"][-1]["detail"]
    assert len(client.get("/api/erp/orders").json()) == 1


def test_restart_mid_delivery_recovers_without_duplicates(make_client, tmp_path):
    client = make_client(data_dir=tmp_path)
    client.put("/api/demo/erp-failure-mode", json={"value": "timeout_next"}, headers=ADMIN)
    doc_id = forward(client, "VIDEO-DEMO-001")
    resolve_demo_001(client, doc_id)
    with make_client(data_dir=tmp_path) as restarted:
        o = state(restarted, doc_id)["order"]
        assert o["delivery_state"] == "erp_created"
        assert len(restarted.get("/api/erp/orders").json()) == 1


def test_amendment_after_delivery_is_held_not_overwritten(make_client):
    client = make_client()
    doc_id = forward(client, "VIDEO-DEMO-001")
    out = resolve_demo_001(client, doc_id)
    erp = out["erp_order_id"]
    client.post(f"/api/documents/{doc_id}/decisions", headers=REVIEWER, json={
        "issue_key": "edit:0", "action": "change_quantity", "params": {"value": "10"}, "reason": "late change"})
    o = state(client, doc_id)["order"]
    assert o["review_state"] == "amendment_held" and o["erp_order_id"] == erp
    assert len(client.get("/api/erp/orders").json()) == 1


# ---------- Slice 6: agent memory ----------

def test_p25_p26_memory_rule_lifecycle_and_scope(make_client):
    client = make_client()
    client.put("/api/policy", json={"mode": "exception_only"}, headers=ADMIN)
    resolve_demo_001(client, forward(client, "VIDEO-DEMO-001"))
    rule = client.get("/api/memory-rules").json()[0]
    assert rule["state"] == "candidate" and rule["customer_id"] == "DEMO-CUST-01"
    # P25: candidate is not used
    d2 = state(client, forward(client, "VIDEO-DEMO-002"))
    assert [i["code"] for i in d2["order"]["validation"]["issues"]] == ["outdated_identifier"]
    # Reviewer cannot activate
    assert client.post(f"/api/memory-rules/{rule['id']}/state", json={"state": "active"},
                       headers=REVIEWER).status_code == 403
    client.post(f"/api/memory-rules/{rule['id']}/state", json={"state": "active"}, headers=ADMIN)
    # Activation affects future orders only: the held VIDEO-DEMO-002 is unchanged.
    assert state(client, d2["document"]["id"])["order"]["delivery_state"] == "not_started"
    # A later matching order uses the rule, with provenance (needs fresh content: same PDF would be duplicate)
    client.post("/api/demo/reset", headers=REVIEWER)  # reviewer cannot reset
    assert client.get("/api/summary").json()["orders_received"] == 2
    pdf = (GEN / "VIDEO-DEMO-002.pdf").read_bytes()
    with client.app.state.db.connect() as conn:  # drop the earlier held copy so this is not a duplicate/revision
        conn.execute("UPDATE orders SET review_state = 'rejected' WHERE document_id = ?", (d2["document"]["id"],))
        conn.execute("UPDATE source_documents SET sha256 = 'x' WHERE id = ?", (d2["document"]["id"],))
    new = client.post("/api/intake/demo-envelope", data={"sender": "orders@northfield-demo.example"},
                      files={"file": ("po.pdf", pdf, "application/pdf")}).json()["document_ids"][0]
    o = state(client, new)["order"]
    assert o["validation"]["issues"] == [] and o["delivery_state"] == "erp_created"
    assert o["validation"]["order"]["lines"][2]["resolved_by"]["type"] == "memory_rule"
    assert "alex" in o["validation"]["order"]["lines"][2]["resolved_by"]["text"]
    # Different customer: not applied
    d3 = state(client, forward(client, "VIDEO-DEMO-003"))
    assert [i["code"] for i in d3["order"]["validation"]["issues"]] == ["outdated_identifier"]
    # Revoked: not applied to later orders
    client.post(f"/api/memory-rules/{rule['id']}/state", json={"state": "revoked", "reason": "test"}, headers=ADMIN)
    line_c = "C | OLD-DEMO-003 | Demo trail mix case | 1 | CASE | 18.00 | 18.00"
    text = SAMPLE.format(po="X1", cust="DEMO-CUST-01", ship="DEMO-DC-01", cur="CAD", total="18.00")
    text = text.replace("A | DEMO-GTIN-A01 | Demo granola case | 10 | CASE | 24.00 | 240.00", line_c)
    r = run_validate(text.replace("Subtotal: 240.00", "Subtotal: 18.00"), rules=client.get("/api/memory-rules").json())
    assert codes(r) == ["outdated_identifier"]


def test_reset_restores_known_state(make_client):
    client = make_client()
    client.put("/api/policy", json={"mode": "exception_only"}, headers=ADMIN)
    forward(client, "VIDEO-DEMO-001")
    assert client.post("/api/demo/reset", headers=REVIEWER).status_code == 403
    assert client.post("/api/demo/reset", headers=ADMIN).status_code == 200
    assert client.get("/api/summary").json()["orders_received"] == 0
    assert client.get("/api/policy").json()["mode"] == "review_all"
    # Same email can be forwarded again after reset (not a duplicate)
    assert state(client, forward(client, "VIDEO-DEMO-001"))["document"]["status"] == "needs_review"
