"""PDF Order Agent backend (prototype). Local only; no live ERP, marketplace or mailbox."""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel
from fastapi.responses import FileResponse

from .config import ROOT, Settings, load_settings
from .db import Database, row
from .intake import Attachment, IntakeRejected, parse_eml, store_intake
from . import workflow
from .pipeline import process_document, reset_for_retry, resume_pending

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
DEMO_EMAILS = ROOT / "fixtures" / "demo" / "generated"
INTAKE_ACTOR = "intake:local-demo-inbox"


class Decision(BaseModel):
    issue_key: str
    action: str
    reason: str | None = None
    params: dict = {}

class PolicyIn(BaseModel):
    mode: str

class RuleIn(BaseModel):
    state: str
    reason: str | None = None

class ToggleIn(BaseModel):
    value: str


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    db = Database(settings.data_dir / "order_agent.sqlite3")
    workflow.init(db)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        resume_pending(db, settings)
        yield

    app = FastAPI(title="PDF Order Agent (prototype)", lifespan=lifespan)
    app.state.db = db
    app.state.settings = settings

    def schedule(tasks: BackgroundTasks, doc_ids: list[int]) -> None:
        for doc_id in doc_ids:
            tasks.add_task(process_document, db, settings, doc_id)

    async def read_limited(upload: UploadFile, limit: int) -> bytes:
        data = await upload.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(413, "Upload exceeds size limit")
        return data

    def intake(tasks: BackgroundTasks, envelope: dict, attachments: list[Attachment], mode: str,
               raw: bytes | None) -> dict:
        try:
            doc_ids = store_intake(db, settings.data_dir, envelope, attachments, mode, raw,
                                   settings.max_upload_bytes, INTAKE_ACTOR)
        except IntakeRejected as exc:
            raise HTTPException(422, str(exc)) from exc
        schedule(tasks, doc_ids)
        return {"document_ids": doc_ids, "processing": "started automatically"}

    @app.get("/api/health")
    def health() -> dict:
        return {
            "status": "ok",
            "extraction": "available" if settings.extraction_available else "unavailable",
            "extractor_mode": settings.extractor_mode,
            "model": settings.gemini_model if settings.extractor_mode == "gemini" else None,
            "erp": "local simulator",
            "rehearsal_mode": workflow.get_setting(db, "rehearsal_mode") == "on",
            "erp_failure_mode": workflow.get_setting(db, "erp_failure_mode", "none"),
            "policy": workflow.current_policy(db),
        }

    @app.post("/api/intake/eml", status_code=202)
    async def intake_eml(tasks: BackgroundTasks, file: UploadFile = File(...)) -> dict:
        raw = await read_limited(file, settings.max_upload_bytes * 2)
        try:
            envelope, attachments = parse_eml(raw, settings.max_upload_bytes)
        except IntakeRejected as exc:
            raise HTTPException(422, str(exc)) from exc
        return intake(tasks, envelope, attachments, "eml_import", raw)

    @app.post("/api/intake/demo-envelope", status_code=202)
    async def intake_demo_envelope(tasks: BackgroundTasks, sender: str = Form(...), subject: str = Form(""),
                                   file: UploadFile = File(...)) -> dict:
        data = await read_limited(file, settings.max_upload_bytes)
        envelope = {"message_id": None, "sender": sender[:200], "received_at": None,
                    "subject_metadata": subject[:300] or None}
        return intake(tasks, envelope, [Attachment(file.filename, data)], "demo_envelope_upload", None)

    @app.get("/api/demo/emails")
    def list_demo_emails() -> list[str]:
        return sorted(p.stem for p in DEMO_EMAILS.glob("*.eml"))

    @app.post("/api/demo/forward/{name}", status_code=202)
    def forward_demo(name: str, tasks: BackgroundTasks) -> dict:
        """Local 'Forward to agent': imports a bundled fictional .eml. Nothing is sent over the internet."""
        allowed = {p.stem: p for p in DEMO_EMAILS.glob("*.eml")}
        if name not in allowed:
            raise HTTPException(404, "Unknown demo email")
        raw = allowed[name].read_bytes()
        envelope, attachments = parse_eml(raw, settings.max_upload_bytes)
        return intake(tasks, envelope, attachments, "local_forward_demo", raw)

    @app.get("/api/documents")
    def list_documents() -> list[dict]:
        with db.connect() as conn:
            rows = conn.execute(
                "SELECT d.id, d.status, d.status_detail, d.original_filename, d.duplicate_of, d.created_at,"
                " e.sender, e.received_at, e.message_id, e.intake_mode, e.subject_metadata"
                " FROM source_documents d JOIN email_envelopes e ON e.id = d.envelope_id ORDER BY d.id DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    @app.get("/api/documents/{doc_id}")
    def get_document(doc_id: int) -> dict:
        with db.connect() as conn:
            doc = row(conn.execute("SELECT * FROM source_documents WHERE id = ?", (doc_id,)).fetchone())
            if doc is None:
                raise HTTPException(404, "Document not found")
            envelope = row(conn.execute("SELECT id, message_id, sender, received_at, subject_metadata, intake_mode,"
                                        " raw_sha256, created_at FROM email_envelopes WHERE id = ?",
                                        (doc["envelope_id"],)).fetchone())
            version = row(conn.execute("SELECT * FROM order_versions WHERE document_id = ? ORDER BY version DESC"
                                       " LIMIT 1", (doc_id,)).fetchone())
            timeline = [dict(r) for r in conn.execute(
                "SELECT event, actor, detail_json, created_at FROM audit_events"
                " WHERE entity_type = 'document' AND entity_id = ? ORDER BY id", (doc_id,))]
        doc.pop("stored_path", None)
        if version:
            version["payload"] = json.loads(version.pop("payload_json"))
        for t in timeline:
            t["detail"] = json.loads(t.pop("detail_json") or "{}")
        return {"document": doc, "envelope": envelope, "latest_version": version, "timeline": timeline,
                "order": workflow.get_state(db, doc_id)}

    @app.post("/api/documents/{doc_id}/retry-extraction", status_code=202)
    def retry_extraction(doc_id: int, tasks: BackgroundTasks) -> dict:
        if not reset_for_retry(db, doc_id, "user:demo-operator"):
            raise HTTPException(409, "Only failed or unavailable extraction can be retried")
        schedule(tasks, [doc_id])
        return {"document_ids": [doc_id], "processing": "restarted"}

    @app.get("/api/documents/{doc_id}/pdf")
    def get_pdf(doc_id: int) -> FileResponse:
        with db.connect() as conn:
            doc = conn.execute("SELECT stored_path FROM source_documents WHERE id = ?", (doc_id,)).fetchone()
        if doc is None:
            raise HTTPException(404, "Document not found")
        return FileResponse(Path(doc["stored_path"]), media_type="application/pdf")

    @app.get("/api/audit")
    def audit(entity_type: str | None = None, entity_id: int | None = None) -> list[dict]:
        query, args = "SELECT * FROM audit_events", []
        if entity_type and entity_id is not None:
            query, args = query + " WHERE entity_type = ? AND entity_id = ?", [entity_type, entity_id]
        with db.connect() as conn:
            return [dict(r) for r in conn.execute(query + " ORDER BY id", args)]

    # ---------- Slices 3-7: review, policy, memory, ERP simulator, demo ----------
    # Demo-only authentication: the role is a request header chosen in the UI. Not real security.

    def who(role: str | None, user: str | None) -> tuple[str, str]:
        role = (role or "viewer").lower()
        return f"{role}:{(user or 'demo-' + role)[:60]}", role

    def guard(fn, *args):
        try:
            return fn(*args)
        except workflow.Forbidden as exc:
            raise HTTPException(403, str(exc)) from exc
        except workflow.Conflict as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.get("/api/orders")
    def list_orders() -> list[dict]:
        with db.connect() as conn:
            ids = [r["document_id"] for r in conn.execute("SELECT document_id FROM orders ORDER BY document_id DESC")]
        return [workflow.get_state(db, i) for i in ids]

    @app.post("/api/documents/{doc_id}/decisions")
    def decide(doc_id: int, body: Decision, x_demo_role: str | None = Header(None),
               x_demo_user: str | None = Header(None)) -> dict:
        actor, role = who(x_demo_role, x_demo_user)
        return guard(workflow.decide, db, doc_id, body.issue_key, body.action, body.params, body.reason, actor,
                     role)

    @app.post("/api/documents/{doc_id}/approve")
    def approve(doc_id: int, x_demo_role: str | None = Header(None), x_demo_user: str | None = Header(None)) -> dict:
        actor, role = who(x_demo_role, x_demo_user)
        return guard(workflow.approve, db, doc_id, actor, role)

    @app.post("/api/documents/{doc_id}/retry-delivery")
    def retry_delivery(doc_id: int, x_demo_role: str | None = Header(None),
                       x_demo_user: str | None = Header(None)) -> dict:
        actor, role = who(x_demo_role, x_demo_user)
        return guard(workflow.retry_delivery, db, doc_id, actor, role)

    @app.get("/api/policy")
    def get_policy() -> dict:
        return workflow.current_policy(db)

    @app.put("/api/policy")
    def put_policy(body: PolicyIn, x_demo_role: str | None = Header(None),
                   x_demo_user: str | None = Header(None)) -> dict:
        actor, role = who(x_demo_role, x_demo_user)
        return guard(workflow.set_policy, db, body.mode, actor, role)

    @app.get("/api/memory-rules")
    def memory_rules() -> list[dict]:
        return workflow.list_rules(db)

    @app.post("/api/memory-rules/{rule_id}/state")
    def rule_state(rule_id: int, body: RuleIn, x_demo_role: str | None = Header(None),
                   x_demo_user: str | None = Header(None)) -> dict:
        actor, role = who(x_demo_role, x_demo_user)
        if body.state not in ("active", "revoked"):
            raise HTTPException(422, "state must be active or revoked")
        return guard(workflow.set_rule_state, db, rule_id, body.state, actor, role, body.reason)

    @app.get("/api/erp/orders")
    def erp_list() -> list[dict]:
        return workflow.erp_orders(db)

    @app.get("/api/summary")
    def get_summary() -> dict:
        return workflow.summary(db)

    def admin_toggle(key: str, value: str | None, allowed: set[str], role: str, actor: str) -> dict:
        if role != "administrator":
            raise HTTPException(403, "Only an administrator can change demo settings")
        if value not in allowed:
            raise HTTPException(422, f"value must be one of {sorted(allowed)}")
        workflow.set_setting(db, key, None if value in ("none", "off") else value)
        with db.connect() as conn:
            db.audit(conn, "system", 0, "demo_setting_changed", actor, {"key": key, "value": value})
        return health()

    @app.put("/api/demo/erp-failure-mode")
    def erp_failure_mode(body: ToggleIn, x_demo_role: str | None = Header(None),
                         x_demo_user: str | None = Header(None)) -> dict:
        actor, role = who(x_demo_role, x_demo_user)
        return admin_toggle("erp_failure_mode", body.value, {"none", "fail_next", "timeout_next"}, role, actor)

    @app.put("/api/demo/rehearsal-mode")
    def rehearsal_mode(body: ToggleIn, x_demo_role: str | None = Header(None),
                       x_demo_user: str | None = Header(None)) -> dict:
        actor, role = who(x_demo_role, x_demo_user)
        return admin_toggle("rehearsal_mode", body.value, {"on", "off"}, role, actor)

    @app.post("/api/demo/reset")
    def reset(x_demo_role: str | None = Header(None), x_demo_user: str | None = Header(None)) -> dict:
        actor, role = who(x_demo_role, x_demo_user)
        guard(workflow.reset_demo, db, settings.data_dir, actor, role)
        return {"reset": True}

    return app


app = create_app()
