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

## Slices 3-7 run (2026-10-15)
Single verify command: `scripts/verify.sh` -> VERIFY PASSED
- Backend: `cd backend && .venv/bin/python -m pytest -q` -> 47 passed (adds reference-data import and rule revalidation)
- Frontend: `cd frontend && npm run typecheck && npm run build` -> passed
- End to end: `cd frontend && npx playwright test` -> 3 passed (guided demo, manual review, inbox), rehearsal mode (TEST ADAPTER)
- Browser evidence: headless Chromium screenshots of every guided-demo step in docs/screenshots/demo-01 ... demo-15, plus manual-review-delivered.png and memory-active.png. Headless Chromium cannot render the embedded PDF (D18); the "Evidence in PDF text" view is shown instead.
- Live Gemini during the guided demo: **Not run**. This cloud container has no GEMINI_API_KEY. The live path is unchanged from Slice 2 and the demo offers it when a key is configured.

| Check | Status | Evidence |
|---|---|---|
| P01 typed fields with evidence | Pass | Slice 2 tests; evidence highlighting in UI (e2e slice2-inbox) |
| P02 scanned input blocked | Pass | test_p02_scanned_pdf_is_explicitly_blocked |
| P03 unknown customer never reassigned | Pass | test_p03_unknown_customer_blocks_and_is_never_reassigned |
| P04 unknown item blocks until mapped | Pass | test_regression_sample_produces_three_golden_issues |
| P05 price mismatch, source price kept | Pass | test_regression_sample...; test_video_demo_001... |
| P06 EA-to-CASE with supplied factor | Pass | test_regression_sample... (24 EA -> 2 CASE, both kept) |
| P07 identical file, no second ERP order | Pass | test_p07_...; guided demo step 14 |
| P08 same customer/PO changed content held | Pass | test_p08_same_customer_and_po_with_changed_content_is_held_as_revision |
| P09 edit after approval invalidates | Pass | test_p09_edit_after_approval_invalidates_it |
| P10 failed delivery retry, same key | Pass | test_p10_failed_delivery_retry_uses_same_idempotency_key |
| P11 timeout after create reconciles | Pass | test_p11_...; test_restart_mid_delivery_recovers_without_duplicates; guided demo steps 13-14 |
| P12 missing currency blocks | Pass | test_p12_missing_currency_stays_unknown_and_blocks |
| P13 totals with Decimal | Pass | test_p13_and_p27_...; Slice 1 fixture total tests |
| P14 audit covers extraction to delivery | Pass | test_p23_and_p14_... |
| P15 restart and role checks | Pass | Slice 2 restart tests; test_p24 (viewer 403), test_p22 (reviewer cannot change mode), test_p25_p26 (reviewer cannot activate), test_reset_restores_known_state; e2e manual-review |
| P16 no key/content in logs or files | Pass | Slice 2 tests |
| P17 no credentials means unavailable | Pass | Slice 2 test; demo disables live start without a key |
| P18 email intake auto-starts | Pass | test_p18_...; e2e |
| P19 MOQ held, quantity unchanged | Pass | test_video_demo_001...; test_moq_quantity_is_never_raised_without_authorised_change |
| P20 price: printed and reference kept | Pass | test_video_demo_001... |
| P21 outdated GTIN held; mapping traceable | Pass | test_video_demo_001...; test_p23_and_p14_... |
| P22 Exception-only clean order auto-delivers | Pass | test_p22_...; guided demo step 9 |
| P23 final exception approval starts delivery | Pass | test_p23_...; e2e manual-review; guided demo step 7 |
| P24 Review-all holds clean orders | Pass | guided demo step 12 (VIDEO-DEMO-005 waits for approval) |
| P25 saved correction is only a candidate | Pass | test_p25_p26_... |
| P26 active rule reused; other customer/revoked not | Pass | test_p25_p26_...; guided demo steps 9-11 |
| P27 changed totals keep printed values | Pass | test_p09_... (computed 186.00 vs printed 190.00 needs a recorded resolution) |
| P28 subject is metadata only | Pass | test_p28_subject_is_metadata_only |

Honest gaps: P24 has no dedicated backend unit test (covered end to end only). Live Gemini was not exercised in this run. Demo sign-in is not real authentication.

## Live Gemini rehearsal (2026-10-15)
Command: `cd frontend && npx playwright test -c playwright.live.config.ts` (key read from the git-ignored .env; not part of verify.sh)
Result: 1 passed. All 15 guided-demo steps reached their expected real states with AI extraction. Screenshots: docs/screenshots/live/.
Observed: Google returned frequent 429/503; every extraction succeeded through the retry and fallback path (gemini-3.8-flash), typically 20-60 s per order. The demo showed "waiting" status honestly during these delays.
