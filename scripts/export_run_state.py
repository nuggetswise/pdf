"""Export the Python prototype's SQLite state as a RunState JSON file (frontend/lib/domain/run-state.ts).

Migration aid for the Vercel rebuild. It proves the browser-held RunState can carry everything today's
twelve tables hold. Server file paths are dropped (the PDF never leaves the browser in the new design);
page text is read from the stored PDF the same way the backend reads it.

Usage (from the repository root):
  backend/.venv/bin/python scripts/export_run_state.py <order_agent.sqlite3> <out.json>
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.extraction import read_pdf_pages  # noqa: E402


def rows(conn: sqlite3.Connection, sql: str) -> list[dict]:
    return [dict(r) for r in conn.execute(sql)]


def export(db_path: Path) -> dict:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    settings = {r["key"]: r["value"] for r in rows(conn, "SELECT * FROM settings")}
    return {
        "schemaVersion": "run-state-v1",
        "envelopes": [{
            "id": r["id"], "messageId": r["message_id"], "sender": r["sender"], "receivedAt": r["received_at"],
            "subjectMetadata": r["subject_metadata"], "intakeMode": r["intake_mode"], "rawSha256": r["raw_sha256"],
            "createdAt": r["created_at"],
        } for r in rows(conn, "SELECT * FROM email_envelopes ORDER BY id")],
        "documents": [{
            "id": r["id"], "envelopeId": r["envelope_id"], "originalFilename": r["original_filename"],
            "sha256": r["sha256"], "sizeBytes": r["size_bytes"], "pageCount": r["page_count"],
            "pageText": read_pdf_pages(Path(r["stored_path"]).read_bytes()), "status": r["status"],
            "statusDetail": r["status_detail"], "duplicateOf": r["duplicate_of"], "createdAt": r["created_at"],
            "updatedAt": r["updated_at"],
        } for r in rows(conn, "SELECT * FROM source_documents ORDER BY id")],
        "versions": [{
            "id": r["id"], "documentId": r["document_id"], "version": r["version"], "origin": r["origin"],
            "extractor": r["extractor"], "payload": json.loads(r["payload_json"]), "createdBy": r["created_by"],
            "createdAt": r["created_at"],
        } for r in rows(conn, "SELECT * FROM order_versions ORDER BY id")],
        "orders": [{
            "documentId": r["document_id"], "customerId": r["customer_id"], "poNumber": r["po_number"],
            "currentVersion": r["current_version"], "reviewState": r["review_state"],
            "deliveryState": r["delivery_state"], "erpOrderId": r["erp_order_id"],
            "validation": json.loads(r["validation_json"]), "updatedAt": r["updated_at"],
        } for r in rows(conn, "SELECT * FROM orders ORDER BY document_id")],
        "decisions": [{
            "id": r["id"], "documentId": r["document_id"], "issueKey": r["issue_key"], "fingerprint": r["fingerprint"],
            "action": r["action"], "params": json.loads(r["params_json"]), "reason": r["reason"], "actor": r["actor"],
            "role": r["role"], "versionCreated": r["version_created"], "createdAt": r["created_at"],
        } for r in rows(conn, "SELECT * FROM decisions ORDER BY id")],
        "approvals": [{
            "id": r["id"], "documentId": r["document_id"], "version": r["version"], "kind": r["kind"],
            "actor": r["actor"], "policyMode": r["policy_mode"], "policyVersion": r["policy_version"],
            "createdAt": r["created_at"], "invalidatedAt": r["invalidated_at"],
            "invalidatedReason": r["invalidated_reason"],
        } for r in rows(conn, "SELECT * FROM approvals ORDER BY id")],
        "policyHistory": [{
            "id": r["id"], "mode": r["mode"], "setBy": r["set_by"], "effectiveAt": r["effective_at"],
        } for r in rows(conn, "SELECT * FROM automation_policy ORDER BY id")],
        "memoryRules": [{
            "id": r["id"], "kind": r["kind"], "customerId": r["customer_id"],
            "obsoleteIdentifier": r["obsolete_identifier"], "replacementIdentifier": r["replacement_identifier"],
            "replacementSku": r["replacement_sku"], "referenceVersion": r["reference_version"], "state": r["state"],
            "sourceDocumentId": r["source_document_id"], "sourceDecisionId": r["source_decision_id"],
            "evidence": r["evidence"], "createdBy": r["created_by"], "createdAt": r["created_at"],
            "activatedBy": r["activated_by"], "activatedAt": r["activated_at"], "revokedBy": r["revoked_by"],
            "revokedAt": r["revoked_at"], "revokeReason": r["revoke_reason"],
        } for r in rows(conn, "SELECT * FROM memory_rules ORDER BY id")],
        "deliveries": [{
            "id": r["id"], "documentId": r["document_id"], "version": r["version"],
            "idempotencyKey": r["idempotency_key"], "state": r["state"], "detail": r["detail"],
            "erpOrderId": r["erp_order_id"], "createdAt": r["created_at"], "updatedAt": r["updated_at"],
        } for r in rows(conn, "SELECT * FROM delivery_attempts ORDER BY id")],
        "erpOrders": [{
            "erpOrderId": r["erp_order_id"], "idempotencyKey": r["idempotency_key"],
            "payload": json.loads(r["payload_json"]), "createdAt": r["created_at"],
        } for r in rows(conn, "SELECT * FROM erp_sim_orders ORDER BY erp_order_id")],
        "audit": [{
            "id": r["id"], "entityType": r["entity_type"], "entityId": r["entity_id"], "event": r["event"],
            "actor": r["actor"], "detail": json.loads(r["detail_json"] or "{}"), "createdAt": r["created_at"],
        } for r in rows(conn, "SELECT * FROM audit_events ORDER BY id")],
        "settings": {
            "role": "viewer",
            "rehearsalMode": settings.get("rehearsal_mode") == "on",
            "erpFailureMode": settings.get("erp_failure_mode", "none"),
            "referenceData": json.loads(settings["reference_data"]) if "reference_data" in settings else None,
        },
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    Path(sys.argv[2]).write_text(json.dumps(export(Path(sys.argv[1])), indent=1, ensure_ascii=False) + "\n")
