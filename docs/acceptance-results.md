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

## Vercel rebuild, slice 1 (2026-10-15)
- `cd frontend && npx playwright test e2e/guided-demo.spec.ts` -> 1 passed; its SQLite state was exported with `backend/.venv/bin/python scripts/export_run_state.py <sqlite> frontend/lib/domain/__fixtures__/full-demo-run.json`
- `cd frontend && npm test` -> 8 passed: the full-demo export parses into RunState with nothing dropped or changed; JSON-number money, a malformed decimal, an unknown field and an unknown review state are each rejected; a fresh run starts in Review-all; the run is about 110 KB, well under the sessionStorage limit
- `cd frontend && npm run typecheck && npm run build` -> passed

## Vercel rebuild, slice 2 (2026-10-15)
- `backend/.venv/bin/python scripts/validation_parity.py` -> wrote 41 decimal, 44 normalise and 148 validate cases from the Python prototype (every fixture PDF, the regression sample, 33 edge-case orders, 4 raw model-style results; all 17 issue codes appear)
- `cd frontend && npm test` -> 249 passed; every parity case matches Python byte for byte. Mutation check: changing one issue title failed 23 cases, and switching half-even rounding to half-up failed 5
- `cd frontend && npm run typecheck` -> passed

## Vercel rebuild, slice 3 (2026-10-15)
- `backend/.venv/bin/python scripts/demo_inbox.py` -> wrote the six fictional demo emails as intake keeps them (envelope fields, PDF hash, size, page count, native page text)
- `cd frontend && npm test` -> 308 passed. The guided-demo replay through workflow.ts matches the Python run in all 13 RunState sections, timestamps masked; changing one revoke reason fails it. 38 of the 47 pytest cases are rewritten in Vitest (all 20 workflow cases); 7 wait for slice 4 and 2 repository checks for slice 7 (IMPLEMENTATION_PLAN.md). The new double-retry test retries one delivery twice (lost answer, then reconcile) and ends with exactly one ERP record and one idempotency key; a third retry is refused
- `scripts/verify.sh` -> VERIFY PASSED: 47 backend tests, 308 Vitest tests, typecheck, build, 3 Playwright tests

## Vercel rebuild, slice 4 (2026-10-15)
- `backend/.venv/bin/python scripts/intake_fixtures.py` -> wrote encrypted.pdf, encrypted-no-password.pdf and no-text.pdf (pypdf reports the first two encrypted)
- `cd frontend && npm test` -> 357 passed. For all six demo emails, browser intake gives the same envelope, file name, hash, size and page count as Python; page text is identical apart from pypdf's trailing newline, and extraction with evidence checks gives identical results. Also covered: unsafe inputs, encrypted PDFs (with and without a password), damaged PDF, filename sanitising, unknown demo names, scanned PDF, subject as metadata, a recorded 429 then 200, fallback model, timeouts, logs free of content and key, health without key, and the /api/extract route's input limits
- All 47 pytest cases now have a Vitest counterpart except the two repository checks kept for slice 7 (fixture generator reproducible, no secrets in tracked files)
- Not run yet: pdf.js in a real browser (the UI is wired in slice 5); no live Gemini call was made
- `scripts/verify.sh` -> VERIFY PASSED: 47 backend tests, 357 Vitest tests, typecheck, build (route /api/extract built), 3 Playwright tests

## Vercel rebuild, slice 5 (2026-10-15)
- `backend/.venv/bin/python scripts/read_models.py` -> recorded the FastAPI read endpoints after the 15-step guided demo (timestamps masked; two runs give identical files)
- `cd frontend && npm test` -> 381 passed. Every selector gives exactly the FastAPI answer for documents, each document and its text, orders, memory rules, ERP orders (apart from Python's duplicate payload_json string), policy and summary. The guided demo performed through the server action, one action per call, gives the same run as the workflow replay; changing the reviewer's actor label fails it. Refusals come back as values (bad run or action 400, wrong role 403, missing reason 409); a payload claiming evidence that is not in the page text is stored as unverified
- `cd frontend && npx playwright test` -> 5 passed, with one Next.js server and no Python backend. The three existing specs are unchanged, including the 15-step guided demo, whose screenshots in docs/screenshots/ are regenerated as browser evidence; pdf.js read the demo PDFs in Chromium. New browser-run.spec.ts: run survives a reload, a new tab starts empty, an interrupted extraction is marked for retry and the retry completes it
- Client bundle check: `grep -rl "GEMINI\|generativelanguage\|x-goog-api-key" frontend/.next/static` -> nothing
- Not run: the live Gemini rehearsal through the new screens (needs the key)
- `scripts/verify.sh` -> VERIFY PASSED: 47 backend tests, 381 Vitest tests, typecheck, build, 5 Playwright tests


## Real app instead of guided demo (2026-10-15, D44)
- `scripts/verify.sh` -> VERIFY PASSED: 47 backend tests, 381 Vitest tests, typecheck, build, 6 Playwright tests. e2e/app-flow.spec.ts uploads the fictional PDFs through the upload box and clicks the full story through the real screens; screenshots in docs/screenshots/app-*.png. A non-PDF upload is refused with "Attachment is not a PDF"
- Not run: live Gemini upload (e2e-live/app-live.spec.ts needs the key) and the production site (not reachable from this environment)

## Supplier portal: ORDRSP, ASN, invoice (2026-10-15, D45)
- `scripts/verify.sh` -> VERIFY PASSED: 47 backend tests, 403 Vitest tests, typecheck, build, 8 Playwright tests. Parity fixtures (validation-parity, demo-inbox, read-models) regenerated and byte-identical; existing selector and replay checks unchanged and passing.
- New Vitest (lib/domain/portal.test.ts, run-action.test.ts): UNT equals the UNH..UNT segment count for ORDRSP, DESADV and INVOIC; ? ' + : and line breaks in document text are escaped; output is deterministic; GLN check digit; ASN short shipment, over-shipment refused without a reason, bad/negative/zero/partial input refused; invoice uses ASN quantity (4, not ordered 5) and order price with exact totals; mismatched or second invoice refused; EDI held/failed and ERP timeout give honest mixed states and a retry reconciles without a duplicate; strict action schema refuses extra fields and JSON numbers.
- New e2e/supplier-portal.spec.ts: PO approved -> ORDRSP delivered -> ASN ships 10 of 12 (over-shipment button disabled) -> invoice 312.00 from shipped quantities -> EDI tab shows ORDRSP, DESADV (QTY+12:10) and INVOIC (QTY+47:10, MOA+86:312.00), mapping and download; a held EDI message shows Pending and the safe retry delivers it. Screenshots docs/screenshots/app-04-supplier-portal.png, app-05-edi-tab.png.
- Not run: live Gemini; no real EDI or ERP endpoint exists by design.

## Session onboarding for real POs (2026-10-15, D46)
`scripts/verify.sh`: VERIFY PASSED. Backend 47 passed; parity, demo-inbox and read-model fixtures byte-identical; Vitest 411 passed (13 files, incl. 7 new onboarding tests); typecheck and build ok; Playwright 9 passed (incl. new e2e/onboarding.spec.ts: unknown customer + 2 unknown products added, order approved and delivered, repeat PO from same customer has no issues, additions listed on Agent memory). Screenshots: docs/screenshots/app-07-onboarding-held.png, app-08-session-additions.png.
Owner's real sample PO (not committed): its text with a Gemini-like extraction raised 5 issues (Customer not recognised for "Maple Retail Group Inc."; Item not recognised for 4 supplier item codes). After Add as new customer and 4x Add to catalogue, 0 open issues and the order was ready for approval (computed total 10708.16 matched the printed total). Checked locally in a throwaway test; live Gemini on that PDF: Not run.
