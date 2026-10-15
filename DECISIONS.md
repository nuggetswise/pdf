# Decisions Log

Each entry: decision, why, how to reverse.

D01 Stack: FastAPI + SQLite backend, Next.js UI. Suggested by docs/05; nothing existing to preserve. Reverse: swap layers behind the same local API.

D02 LLM provider: Gemini, via a provider-neutral extractor interface with a configurable model name. Owner will supply the key later. Reverse: add another adapter; no other code changes.

D03 Learning model: the video describes the agent "learning from every correction". The spec (docs/01, docs/02) requires approved, scoped rule reuse, not autonomous retraining. We present it as agent memory: corrections become candidate rules, an administrator activates them, later orders show provenance. Reverse: an auto-activate policy flag could be added later, but is deliberately off.

D04 Separate demo reference data (fixtures/reference-data.v1.json) with product A at 24.00, because master-data.json prices OAT-CASE at 23.00, which would add a fourth exception to VIDEO-DEMO-001. master-data.json stays unchanged for the sample-po regression.

D05 Fixture additions: MOQ rule (A, 10 CASE), obsolete identifier OLD-DEMO-003 and proposed NEW-DEMO-003, second fictional customer DEMO-CUST-02, ship-to and dates on VIDEO-DEMO-002, new VIDEO-DEMO-003 for the nonmatching-customer case. All fictional.

D06 Unit conversion converts unit price with quantity (24 EA at 2.00 = 2 CASE at 24.00), matching golden-expected.json.

D07 Rounding: Decimal, ROUND_HALF_UP, 2 places for money.

D08 Folder layout: docs/ and fixtures/ to match CLAUDE.md references.

D09 Demo order lines are identified by fictional identifiers (DEMO-GTIN-A01, DEMO-GTIN-B02, OLD-DEMO-003) mapped to DEMO-SKU-A/B/C in reference-data.v1.json. The proposed OLD-DEMO-003 -> NEW-DEMO-003 mapping is stored as "proposed" and cannot be used until a reviewer approves it.

D10 Generated PDFs print each table row as one pipe-separated text run so native text extraction keeps rows intact, matching sample-po.txt. The generator is deterministic (fixed timestamps, fixed MIME boundaries) and a test checks it.

D11 UI framework pinned to Next.js 16.3.8 / React 19.3.1 after npm audit flagged the 15.x line; audit reports 0 production vulnerabilities. Backend dependencies pinned in backend/requirements.lock. Python 3.13 (what the environment provides).

D12 The UI calls the backend through a same-origin /api rewrite, so no backend URL or secret is placed in the browser bundle.

D13 Gemini model: GEMINI_MODEL=gemini-3.5-flash with GEMINI_FALLBACK_MODEL=gemini-3.8-flash. Busy responses (429/500/503) and timeouts retry up to four times, then switch to the fallback. Extraction is read-only so retrying is safe. gemini-2.5-flash was tried and is no longer offered to this key. Reverse: change the two .env values.

D14 Extraction honesty: every extracted value is checked against the PDF text. Values not found are kept but flagged "not found in PDF" for validation to block, rather than silently dropped. The model is told the document is untrusted data and must answer in a fixed JSON schema.

D15 The fixture TEST ADAPTER runs only when ORDER_AGENT_EXTRACTOR=test (automated tests and the deterministic e2e run). It is labelled in the API, the UI and the stored version, and is_ai is false.

D16 Identical files (same SHA-256) are stored as "duplicate" linked to the original and are not reprocessed. ERP-level duplicate protection follows in Slice 5.

D17 Storage: original .eml and PDFs are stored by content hash under data/files; the uploaded filename is display-only and sanitised. Limits: 10 MB PDF, 20 MB email, 50 pages.

D18 Headless browser screenshots do not render the embedded PDF (headless Chromium has no PDF viewer). In a normal browser the PDF shows beside the fields.

D19 Validation is deterministic code (backend/app/validation.py) with a policy table: every issue code blocks approval until a recorded decision resolves it. A decision resolves an issue only while the issue's printed and reference values are unchanged (fingerprint), so an edit re-opens checks. Reverse: change POLICY in validation.py.

D20 Each decision creates a new order version; approval binds to one version and any later version invalidates it. Printed values are never changed; edits are stored as overrides and derived totals are recalculated, with printed totals kept and differences raised as issues.

D21 Resolving the final exception counts as the reviewer's approval of that version, and delivery starts automatically (no Send button). This applies in both modes. In Review-all mode a clean order needs an explicit "Approve order" click; in Exception-only mode a clean order with no human decisions is approved by the system, recording the policy version.

D22 Demo roles are a request header chosen in the UI (Reviewer, Administrator, Viewer), labelled "demo-only sign-in". Only Administrator may change the mode, activate or revoke memory, change simulator toggles, import reference data or reset. Not real security.

D23 ERP simulator lives in the same SQLite file but in its own tables (erp_sim_orders) with its own IDs (SIM-ERP-100001...). Idempotency key = first 16 characters of the document hash + approved version. Before every submission, and on every retry or restart, the agent first looks the key up in the ERP (reconciliation). Toggles "fail next" and "time out after creating" simulate outages.

D24 Agent memory holds identifier mappings only (candidate, active, revoked), scoped to one customer and the reference version it was approved against. A rule is applied when an order is first validated; activation never changes orders already processed. If reference data gets a new version, the rule is not reused until revalidated. Price and MOQ exceptions are never offered as reusable.

D25 Added fictional fixtures VIDEO-DEMO-004 (Northfield, OLD-DEMO-003, used after revocation) and VIDEO-DEMO-005 (clean order for Review-all and safe retry), because the acceptance demo needs a new order after revocation and a clean order in Review-all mode, and re-sending an identical file is correctly a duplicate.

D26 Guided demo: owner confirmed "click through without a presenter". Each step's first click performs the real action and waits for the real state; the next click moves on. Play/Pause autoplays the same steps. Starting the demo resets the prototype. Live AI start is offered only when a Gemini key is configured; rehearsal mode is an administrator setting that switches extraction to the TEST ADAPTER, labelled "not AI" in the top bar, on the order and in the start button.

D27 The review screen shows the PDF's own text with the extraction evidence highlighted, next to a tab with the original PDF. This works in every browser, including headless test browsers (D18), and makes evidence easy to see on a projector.

D28 Reference data can be replaced by an administrator via POST /api/reference-data; it must carry a new reference_version. It is stored in the database; reset returns to fixtures/reference-data.v1.json.
