"""Hosting readiness: database-stored files, inline processing, safe claiming, sweep, Gemini time budget."""
from __future__ import annotations

import filecmp
import os
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "backend" / "runtime_data"
ADMIN = {"X-Demo-Role": "administrator", "X-Demo-User": "alex"}


def test_runtime_data_matches_fixtures():
    """backend/runtime_data is a copy so the backend deploys on its own; run scripts/sync_runtime_data.py on drift."""
    assert filecmp.cmp(ROOT / "fixtures" / "reference-data.v1.json", RUNTIME / "reference-data.v1.json", shallow=False)
    sources = {p.name for p in (ROOT / "fixtures" / "demo" / "generated").glob("*.eml")}
    assert sources == {p.name for p in (RUNTIME / "demo").glob("*.eml")}
    for name in sources:
        assert filecmp.cmp(ROOT / "fixtures" / "demo" / "generated" / name, RUNTIME / "demo" / name, shallow=False)


def test_files_live_in_the_database_not_on_disk(make_client, tmp_path):
    client = make_client(data_dir=tmp_path)
    doc_id = client.post("/api/demo/forward/VIDEO-DEMO-001").json()["document_ids"][0]
    pdf = client.get(f"/api/documents/{doc_id}/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF-")
    assert client.get(f"/api/documents/{doc_id}/text").json()["pages"]
    assert not (tmp_path / "files").exists()


def test_reset_clears_stored_files_and_restarts_ids(make_client):
    client = make_client()
    client.post("/api/demo/forward/VIDEO-DEMO-001")
    assert client.post("/api/demo/reset", headers=ADMIN).json() == {"reset": True}
    assert client.get("/api/documents").json() == []
    assert client.post("/api/demo/forward/VIDEO-DEMO-001").json()["document_ids"] == [1]


def test_health_reports_engine_and_processing_mode(make_client, monkeypatch):
    monkeypatch.setenv("ORDER_AGENT_INLINE_PROCESSING", "1")
    health = make_client().get("/api/health").json()
    assert health["database"] == ("postgres" if os.environ.get("ORDER_AGENT_TEST_POSTGRES") else "sqlite")
    assert health["processing"] == "inline"


def test_inline_processing_finishes_inside_the_request(make_client, monkeypatch):
    monkeypatch.setenv("ORDER_AGENT_INLINE_PROCESSING", "1")
    client = make_client()
    body = client.post("/api/demo/forward/VIDEO-DEMO-001").json()
    assert body["processing"] == "completed inline"
    assert client.get(f"/api/documents/{body['document_ids'][0]}").json()["document"]["status"] == "needs_review"


def test_a_document_can_only_be_claimed_once(make_client):
    from app import pipeline
    client = make_client()
    db = client.app.state.db
    doc_id = client.post("/api/demo/forward/VIDEO-DEMO-001").json()["document_ids"][0]
    assert not pipeline._claim(db, doc_id, resume=False)  # already processed; a second worker does nothing
    with db.connect() as conn:
        conn.execute("UPDATE source_documents SET status = 'received' WHERE id = ?", (doc_id,))
    assert pipeline._claim(db, doc_id, resume=False)
    assert not pipeline._claim(db, doc_id, resume=False)  # now 'extracting': only a resume may take it over
    assert pipeline._claim(db, doc_id, resume=True)


def test_sweep_is_disabled_without_a_token_and_needs_it_when_enabled(make_client):
    assert make_client().post("/api/internal/sweep").status_code == 403
    client = make_client(CRON_SECRET="test-secret-not-real")
    assert client.post("/api/internal/sweep").status_code == 403
    assert client.post("/api/internal/sweep", headers={"Authorization": "Bearer wrong"}).status_code == 403
    assert client.post("/api/internal/sweep", headers={"Authorization": "Bearer test-secret-not-real"}).status_code == 200


def test_sweep_finishes_a_document_left_extracting(make_client):
    client = make_client(CRON_SECRET="s")
    doc_id = client.post("/api/demo/forward/VIDEO-DEMO-002").json()["document_ids"][0]
    with client.app.state.db.connect() as conn:  # simulate a function that died mid-processing
        conn.execute("UPDATE source_documents SET status = 'extracting' WHERE id = ?", (doc_id,))
        conn.execute("DELETE FROM orders WHERE document_id = ?", (doc_id,))
        conn.execute("DELETE FROM order_versions WHERE document_id = ?", (doc_id,))
    assert client.post("/api/internal/sweep", headers={"Authorization": "Bearer s"}).status_code == 200
    assert client.get(f"/api/documents/{doc_id}").json()["document"]["status"] != "extracting"


def test_gemini_stops_when_the_time_budget_is_used(monkeypatch):
    from app import extraction
    calls = []

    def slow_busy(*args, **kwargs):
        calls.append(kwargs["timeout"])
        return httpx.Response(503)

    clock = iter([0.0, 0.0, 50.0, 50.0, 200.0, 200.0, 200.0, 200.0])
    monkeypatch.setattr(extraction.httpx, "post", slow_busy)
    monkeypatch.setattr(extraction.time, "sleep", lambda s: None)
    monkeypatch.setattr(extraction.time, "monotonic", lambda: next(clock))
    ex = extraction.GeminiExtractor("k", "m", timeout=25, attempts=5, budget_seconds=60)
    with pytest.raises(extraction.GeminiBusy):
        ex.extract(["page"])
    assert len(calls) < 5 and all(t <= 25 for t in calls)
