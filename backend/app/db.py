"""SQLite storage. All queries are parameterised; no string-built SQL with user data."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS email_envelopes (
    id INTEGER PRIMARY KEY,
    message_id TEXT,
    sender TEXT,
    received_at TEXT,
    subject_metadata TEXT,
    intake_mode TEXT NOT NULL,
    raw_sha256 TEXT,
    raw_path TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_documents (
    id INTEGER PRIMARY KEY,
    envelope_id INTEGER NOT NULL REFERENCES email_envelopes(id),
    original_filename TEXT,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    stored_path TEXT NOT NULL,
    page_count INTEGER,
    status TEXT NOT NULL,
    status_detail TEXT,
    duplicate_of INTEGER REFERENCES source_documents(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_sha ON source_documents(sha256);
CREATE TABLE IF NOT EXISTS order_versions (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES source_documents(id),
    version INTEGER NOT NULL,
    origin TEXT NOT NULL,
    extractor TEXT,
    payload_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(document_id, version)
);
CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    actor TEXT NOT NULL,
    detail_json TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Database:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def audit(self, conn: sqlite3.Connection, entity_type: str, entity_id: int, event: str,
              actor: str, detail: dict[str, Any] | None = None) -> None:
        conn.execute(
            "INSERT INTO audit_events (entity_type, entity_id, event, actor, detail_json, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (entity_type, entity_id, event, actor, json.dumps(detail or {}), now()),
        )


def row(r: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(r) if r is not None else None
