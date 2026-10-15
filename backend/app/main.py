"""PDF Order Agent backend (prototype). Local only; no live ERP, marketplace or mailbox."""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .config import ROOT, Settings, load_settings
from .db import Database, row
from .intake import Attachment, IntakeRejected, parse_eml, store_intake
from .pipeline import process_document, reset_for_retry, resume_pending

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
DEMO_EMAILS = ROOT / "fixtures" / "demo" / "generated"
INTAKE_ACTOR = "intake:local-demo-inbox"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    db = Database(settings.data_dir / "order_agent.sqlite3")

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
        return {"document": doc, "envelope": envelope, "latest_version": version, "timeline": timeline}

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

    return app


app = create_app()
