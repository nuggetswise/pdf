"""Local forwarded-email intake. Persists the envelope and PDF, then hands off for processing.

The subject line is stored as metadata only; it never feeds extraction or rules (P28).
"""
from __future__ import annotations

import email
import email.policy
import hashlib
import io
import logging
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from .db import Database, now

log = logging.getLogger("order_agent.intake")


class IntakeRejected(ValueError):
    """Input refused before anything is stored."""


@dataclass
class Attachment:
    filename: str | None
    data: bytes


def _check_pdf(data: bytes, max_bytes: int) -> int:
    """Return page count, or raise IntakeRejected. Never executes or renders content."""
    if len(data) > max_bytes:
        raise IntakeRejected(f"PDF exceeds {max_bytes} byte limit")
    if not data.startswith(b"%PDF-"):
        raise IntakeRejected("Attachment is not a PDF")
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise IntakeRejected("Encrypted PDFs are not accepted")
        pages = len(reader.pages)
    except IntakeRejected:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError) as exc:
        raise IntakeRejected("PDF could not be read") from exc
    if pages == 0:
        raise IntakeRejected("PDF has no pages")
    if pages > 50:
        raise IntakeRejected("PDF exceeds 50 page limit")
    return pages


def parse_eml(raw: bytes, max_bytes: int) -> tuple[dict, list[Attachment]]:
    if len(raw) > max_bytes * 2:
        raise IntakeRejected("Email exceeds size limit")
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    received_at = None
    if msg["Date"]:
        try:
            received_at = parsedate_to_datetime(str(msg["Date"])).isoformat()
        except (TypeError, ValueError):
            received_at = None
    envelope = {
        "message_id": str(msg["Message-ID"]) if msg["Message-ID"] else None,
        "sender": str(msg["From"]) if msg["From"] else None,
        "received_at": received_at,
        "subject_metadata": str(msg["Subject"]) if msg["Subject"] else None,
    }
    attachments = []
    for part in msg.iter_attachments():
        name = part.get_filename()
        if part.get_content_type() == "application/pdf" or (name or "").lower().endswith(".pdf"):
            attachments.append(Attachment(name, part.get_payload(decode=True) or b""))
    if not attachments:
        raise IntakeRejected("Email has no PDF attachment")
    return envelope, attachments


def safe_display_name(name: str | None) -> str | None:
    """Keep a display-only filename; storage always uses the content hash."""
    if not name:
        return None
    cleaned = "".join(ch for ch in Path(name).name if ch.isalnum() or ch in "._- ")
    return cleaned[:120] or None


def store_intake(db: Database, envelope: dict, attachments: list[Attachment], intake_mode: str,
                 raw: bytes | None, max_bytes: int, actor: str) -> list[int]:
    """Validate every attachment first, then persist atomically. Returns all new document ids, duplicates included.

    PDF and .eml bytes are stored in the database under their content hash, in the same transaction as the rows
    that describe them. The uploaded filename is display-only."""
    checked = [(att, _check_pdf(att.data, max_bytes)) for att in attachments]
    raw_sha = hashlib.sha256(raw).hexdigest() if raw is not None else None
    doc_ids: list[int] = []
    with db.connect() as conn:
        if raw is not None:
            db.put_file(conn, raw_sha, "eml", raw)
        cur = conn.execute(
            "INSERT INTO email_envelopes (message_id, sender, received_at, subject_metadata, intake_mode,"
            " raw_sha256, raw_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (envelope.get("message_id"), envelope.get("sender"), envelope.get("received_at") or now(),
             envelope.get("subject_metadata"), intake_mode, raw_sha, f"db:{raw_sha}" if raw_sha else None, now()),
        )
        envelope_id = cur.lastrowid
        db.audit(conn, "envelope", envelope_id, "received", actor,
                 {"intake_mode": intake_mode, "attachments": len(checked)})
        for att, pages in checked:
            sha = hashlib.sha256(att.data).hexdigest()
            db.put_file(conn, sha, "pdf", att.data)
            original = conn.execute(
                "SELECT id FROM source_documents WHERE sha256 = ? AND duplicate_of IS NULL ORDER BY id LIMIT 1",
                (sha,),
            ).fetchone()
            status = "duplicate" if original else "received"
            detail = f"Identical to document {original['id']}" if original else None
            ts = now()
            cur = conn.execute(
                "INSERT INTO source_documents (envelope_id, original_filename, sha256, size_bytes, stored_path,"
                " page_count, status, status_detail, duplicate_of, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (envelope_id, safe_display_name(att.filename), sha, len(att.data), f"db:{sha}", pages,
                 status, detail, original["id"] if original else None, ts, ts),
            )
            doc_id = cur.lastrowid
            db.audit(conn, "document", doc_id, "received", actor,
                     {"envelope_id": envelope_id, "sha256": sha, "duplicate_of": original["id"] if original else None})
            doc_ids.append(doc_id)
    log.info("intake stored envelope=%s documents=%s mode=%s", envelope_id, doc_ids, intake_mode)
    return doc_ids
