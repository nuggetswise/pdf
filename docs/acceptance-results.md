# Acceptance results

Updated after each slice. "Not run" means the check is not yet implemented.

## Slice 2 run (2026-10-15)
Commands:
- `cd backend && .venv/bin/python -m pytest -q` -> 27 passed
- `cd frontend && npm run typecheck && npm run build` -> passed
- `cd frontend && npx playwright test` -> 1 passed (test adapter, screenshot docs/screenshots/slice2-inbox.png)
- Live Gemini (manual, not part of automated tests): VIDEO-DEMO-001 and DEMO-PO-001 extracted with every field verified against the PDF text. Google returned overload errors; extraction succeeded through the fallback model after retries.

| Check | Status | Evidence |
|---|---|---|
| P01 typed fields with evidence | Pass | test_p01_typed_fields_with_traceable_evidence; live Gemini run |
| P02 scanned input blocked | Pass | test_p02_scanned_pdf_is_explicitly_blocked |
| P15 restart preserves records | Partial pass | test_p15_restart_preserves_records; role checks Not run (Slice 4) |
| P16 no key/content in logs or files | Pass | test_p16_logs_contain_no_document_content_or_key; test_no_secrets_in_tracked_files |
| P17 no credentials means unavailable | Pass | test_p17_no_credentials_means_unavailable_not_simulated |
| P18 email intake persists and auto-starts | Pass | test_p18_...; e2e slice2-inbox |
| P28 subject is metadata only | Pass | test_p28_subject_is_metadata_only |
| P07 identical file | Partial | duplicate flagged at intake; ERP check Not run (Slice 5) |
| All other checks | Not run | Slices 3-7 |
