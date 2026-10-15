"""Storage. SQLite for local use and tests; Postgres (for example Neon on Vercel) when a database URL is given.

All queries are parameterised with `?` placeholders; no string-built SQL with user data. Both engines are
reached through the same small connection wrapper, so the rest of the app is engine-agnostic.
Uploaded PDF and .eml bytes are stored in the database (table stored_files), so nothing depends on local disk.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

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
CREATE TABLE IF NOT EXISTS stored_files (
    sha256 TEXT NOT NULL,
    kind TEXT NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (sha256, kind)
);
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

_SERIAL_PK = re.compile(r"(?<![A-Za-z_])id INTEGER PRIMARY KEY")
_SERIAL_TABLE = re.compile(r"CREATE TABLE IF NOT EXISTS (\w+) \(\s*id INTEGER PRIMARY KEY")
_INSERT_TABLE = re.compile(r"^\s*INSERT\s+INTO\s+(\w+)", re.IGNORECASE)
_SCHEMA_LOCK_KEY = 727274


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def is_postgres_url(target: object) -> bool:
    return isinstance(target, str) and target.startswith(("postgres://", "postgresql://"))


class Row(dict):
    """Row that supports both row["name"] and row[0], like sqlite3.Row, for Postgres results."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class _SqliteConn:
    def __init__(self, raw: sqlite3.Connection):
        self.raw = raw

    def execute(self, sql: str, params: Any = ()):
        return self.raw.execute(sql, params)

    def executescript(self, script: str) -> None:
        self.raw.executescript(script)

    def advisory_lock(self, key: int) -> None:  # SQLite serialises writers itself
        return None

    def clear_tables(self, tables: list[str]) -> None:
        for table in tables:
            self.raw.execute(f"DELETE FROM {table}")  # fixed table names, no user input


class _PgCursor:
    def __init__(self, cur, lastrowid: int | None = None):
        self._cur = cur
        self.lastrowid = lastrowid

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def __iter__(self):
        return iter(self._cur.fetchall())


class _PgConn:
    def __init__(self, raw, serial_tables: set[str]):
        self.raw = raw
        self._serial_tables = serial_tables

    def execute(self, sql: str, params: Any = ()):
        text = sql.replace("?", "%s")
        table = _INSERT_TABLE.match(sql)
        wants_id = bool(table) and table.group(1) in self._serial_tables and "RETURNING" not in sql.upper()
        if wants_id:
            text += " RETURNING id"
        cur = self.raw.execute(text, tuple(params))
        if wants_id:
            return _PgCursor(cur, cur.fetchone()["id"])
        return _PgCursor(cur)

    def executescript(self, script: str) -> None:
        for statement in script.split(";"):
            if statement.strip():
                self.raw.execute(_pg_ddl(statement))

    def advisory_lock(self, key: int) -> None:
        self.raw.execute("SELECT pg_advisory_xact_lock(%s)", (key,))

    def clear_tables(self, tables: list[str]) -> None:
        # RESTART IDENTITY keeps ids starting at 1 after a demo reset, like the SQLite behaviour.
        self.raw.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")  # fixed names


def _pg_ddl(sql: str) -> str:
    return _SERIAL_PK.sub("id SERIAL PRIMARY KEY", sql).replace(" BLOB ", " BYTEA ")


def _pg_row_factory(cursor):
    names = [c.name for c in cursor.description] if cursor.description else []
    return lambda values: Row(zip(names, values))


class Database:
    """Lazy: nothing touches the database until the first query, so importing the app never fails or blocks."""

    def __init__(self, target: Path | str):
        self.postgres = is_postgres_url(target)
        self.target = target
        if not self.postgres:
            Path(target).parent.mkdir(parents=True, exist_ok=True)
        self._schemas = [SCHEMA]
        self._init_hooks: list[Callable[[], None]] = []
        self._serial_tables = set(_SERIAL_TABLE.findall(SCHEMA))
        self._ready = False
        self._lock = threading.Lock()

    # ---- setup ----

    def add_schema(self, sql: str) -> None:
        self._schemas.append(sql)
        self._serial_tables |= set(_SERIAL_TABLE.findall(sql))

    def on_ready(self, hook: Callable[[], None]) -> None:
        self._init_hooks.append(hook)

    def _ensure(self) -> None:
        if self._ready:
            return
        with self._lock:
            if self._ready:
                return
            self._ready = True  # hooks use connect(); this stops them recursing
            try:
                with self.connect() as conn:
                    if self.postgres:
                        conn.advisory_lock(_SCHEMA_LOCK_KEY)  # cold starts may race on first deploy
                    for schema in self._schemas:
                        conn.executescript(schema)
                for hook in self._init_hooks:
                    hook()
            except Exception:
                self._ready = False
                raise

    @contextmanager
    def connect(self) -> Iterator[Any]:
        if not self._ready:
            self._ensure()
        with self._raw_connect() as conn:
            yield conn

    @contextmanager
    def _raw_connect(self) -> Iterator[Any]:
        if self.postgres:
            import psycopg  # imported here so SQLite-only installs do not need it

            raw = psycopg.connect(self.target, row_factory=_pg_row_factory, prepare_threshold=None,
                                  connect_timeout=15)
            conn: Any = _PgConn(raw, self._serial_tables)
        else:
            raw = sqlite3.connect(self.target, timeout=30)
            raw.row_factory = sqlite3.Row
            raw.execute("PRAGMA foreign_keys = ON")
            raw.execute("PRAGMA journal_mode = WAL")
            conn = _SqliteConn(raw)
        try:
            yield conn
            raw.commit()
        except Exception:
            raw.rollback()
            raise
        finally:
            raw.close()

    # ---- helpers ----

    def audit(self, conn, entity_type: str, entity_id: int, event: str,
              actor: str, detail: dict[str, Any] | None = None) -> None:
        conn.execute(
            "INSERT INTO audit_events (entity_type, entity_id, event, actor, detail_json, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (entity_type, entity_id, event, actor, json.dumps(detail or {}), now()),
        )

    def put_file(self, conn, sha256: str, kind: str, data: bytes) -> None:
        conn.execute("INSERT INTO stored_files (sha256, kind, data) VALUES (?, ?, ?)"
                     " ON CONFLICT (sha256, kind) DO NOTHING", (sha256, kind, data))

    def document_bytes(self, conn, doc: Any) -> bytes:
        """PDF bytes of a source document. Falls back to a legacy on-disk path from older local databases."""
        r = conn.execute("SELECT data FROM stored_files WHERE sha256 = ? AND kind = 'pdf'",
                         (doc["sha256"],)).fetchone()
        if r is not None:
            return bytes(r["data"])
        legacy = Path(doc["stored_path"]) if doc["stored_path"] and not doc["stored_path"].startswith("db:") else None
        if legacy and legacy.is_file():
            return legacy.read_bytes()
        raise FileNotFoundError("Stored document content is missing")


def row(r: Any) -> dict[str, Any] | None:
    return dict(r) if r is not None else None
