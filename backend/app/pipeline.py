"""Automatic processing after intake. No Extract button: intake schedules this directly."""
from __future__ import annotations

import json
import logging
from pathlib import Path

from .config import Settings
from .db import Database, now
from . import workflow
from .extraction import Extractor, GeminiBusy, FixtureTestExtractor, GeminiExtractor, normalise, read_pdf_pages

log = logging.getLogger("order_agent.pipeline")
SYSTEM = "system:order-agent"


def get_extractor(settings: Settings, db: Database | None = None) -> Extractor | None:
    # Rehearsal mode (set by an administrator in the demo) uses the labelled TEST ADAPTER, never presented as AI.
    rehearsal = db is not None and workflow.get_setting(db, "rehearsal_mode") == "on"
    if settings.extractor_mode == "test" or rehearsal:
        return FixtureTestExtractor()
    if settings.gemini_api_key and settings.gemini_model:
        return GeminiExtractor(settings.gemini_api_key, settings.gemini_model,
                               fallback_model=settings.gemini_fallback_model)
    return None


def _set_status(db: Database, doc_id: int, status: str, detail: str | None = None,
                audit_detail: dict | None = None) -> None:
    with db.connect() as conn:
        conn.execute("UPDATE source_documents SET status = ?, status_detail = ?, updated_at = ? WHERE id = ?",
                     (status, detail, now(), doc_id))
        db.audit(conn, "document", doc_id, status, SYSTEM, audit_detail or ({"detail": detail} if detail else {}))


def process_document(db: Database, settings: Settings, doc_id: int) -> None:
    with db.connect() as conn:
        doc = conn.execute("SELECT * FROM source_documents WHERE id = ?", (doc_id,)).fetchone()
    if doc is None or doc["status"] not in ("received", "extracting"):
        return
    _set_status(db, doc_id, "extracting")
    pages = read_pdf_pages(Path(doc["stored_path"]).read_bytes())
    if not any(p.strip() for p in pages):
        _set_status(db, doc_id, "unsupported",
                    "No native text found (scanned or image-only PDF). No OCR adapter is configured.")
        return
    extractor = get_extractor(settings, db)
    if extractor is None:
        _set_status(db, doc_id, "extraction_unavailable",
                    "Extraction unavailable: no LLM credentials configured. Nothing was simulated.")
        return
    try:
        result = normalise(extractor.extract(pages), pages, extractor)
    except Exception as exc:  # keep content and secrets out of logs
        log.warning("extraction failed document=%s error=%s", doc_id, type(exc).__name__)
        # Our own RuntimeError messages hold only status codes, never document content.
        reason = ("the AI service is busy" if isinstance(exc, GeminiBusy)
                  else str(exc) if type(exc) is RuntimeError else type(exc).__name__)
        _set_status(db, doc_id, "extraction_failed", f"Extraction failed ({reason}). Use Retry extraction.")
        return
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO order_versions (document_id, version, origin, extractor, payload_json, created_by, created_at)"
            " VALUES (?, 1, 'extraction', ?, ?, ?, ?)",
            (doc_id, extractor.name, json.dumps(result), SYSTEM, now()),
        )
        conn.execute("UPDATE source_documents SET status = 'extracted', status_detail = NULL, updated_at = ?"
                     " WHERE id = ?", (now(), doc_id))
        db.audit(conn, "document", doc_id, "extracted", SYSTEM,
                 {"extractor": extractor.name, "is_ai": extractor.is_ai, "lines": len(result["lines"])})
    log.info("extracted document=%s lines=%s extractor_ai=%s", doc_id, len(result["lines"]), extractor.is_ai)
    workflow.process_after_extraction(db, doc_id)


def reset_for_retry(db: Database, doc_id: int, actor: str) -> bool:
    """Retry is only offered for failed or unavailable extraction; it never discards a version."""
    with db.connect() as conn:
        cur = conn.execute(
            "UPDATE source_documents SET status = 'received', status_detail = NULL, updated_at = ?"
            " WHERE id = ? AND status IN ('extraction_failed', 'extraction_unavailable')", (now(), doc_id))
        if cur.rowcount:
            db.audit(conn, "document", doc_id, "extraction_retry_requested", actor, {})
        return bool(cur.rowcount)


def resume_pending(db: Database, settings: Settings) -> None:
    """After a restart, finish documents that were received but not yet processed."""
    with db.connect() as conn:
        ids = [r["id"] for r in conn.execute(
            "SELECT id FROM source_documents WHERE status IN ('received', 'extracting') ORDER BY id")]
    for doc_id in ids:
        process_document(db, settings, doc_id)
    with db.connect() as conn:
        stalled = [r["id"] for r in conn.execute(
            "SELECT d.id FROM source_documents d LEFT JOIN orders o ON o.document_id = d.id"
            " WHERE d.status IN ('extracted', 'matching', 'validating') AND o.document_id IS NULL ORDER BY d.id")]
    for doc_id in stalled:
        workflow.process_after_extraction(db, doc_id)
    workflow.recover_deliveries(db)
