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

D29 Vercel rebuild, RunState naming: the run's own records use camelCase; payloads the Python code produces (extraction payload, validation result including its rules snapshot, ERP order payload, reference data) keep their snake_case keys so rebuild slice 2 can compare outputs byte for byte. Records are strict (an unknown field is an error); imported reference data allows extra keys.

D30 RunState holds page text, never PDF bytes or server file paths. Money and quantities are strings; computed values must match a decimal pattern, and printed values stay as untrusted text. Role moves into RunState.settings (still demo-only, D22).

D31 Vitest 4.1.11 instead of 5.x: npm 10 cannot add Vitest 5 to this project (an npm resolver crash), and the lockfile was written with npm 11. `npm ci` on npm 10 installs it fine. @types/node moved from 22.10.7 to 22.19.1 because Vitest's Vite needs at least 22.12. Reverse: bump the versions in frontend/package.json.

D32 Money in TypeScript uses our own small exact decimal (frontend/lib/domain/money.ts, BigInt coefficient plus exponent) instead of decimal.js, which was removed. decimal.js drops trailing zeros ("2.50" becomes "2.5") and does not follow Python's division and precision rules, so its output could not match the Python prototype character for character. The class mirrors Python's default decimal context: 28 significant digits, ROUND_HALF_EVEN for arithmetic and bare quantize, and money() rounds cents with ROUND_HALF_UP (D07).

D33 Known, deliberate differences from Python in the port: NaN and Infinity in a document are treated as unreadable (Python kept them and would then crash in a comparison); a number that cannot be represented is never guessed. A model answer that returns a JSON float such as 24.0 instead of a string would print as "24" here and "24.0" in Python; the extraction schema requires strings, so this does not arise.

D34 Kept for parity, flagged for review: the agreed-price check rounds the printed unit price half-even (Python's bare quantize), while the order records it rounded half-up. A printed 24.005 against an agreed 24.00 passes the price check but is recorded as 24.01. Changing this is a business-rule decision, to be made after the cutover.

D35 Rebuild slice 3: every workflow action is a pure function (current run in, next run out). It copies the run, changes the copy and throws Forbidden (wrong role) or Conflict (not allowed now), so a refused action leaves the run exactly as it was. Intake and extraction are split into state changes (receive, startExtraction, recordExtraction, failExtraction, retryExtraction); reading the email and PDF moves to the browser in slice 4. The labelled TEST ADAPTER was pulled forward from slice 4 so the workflow can be tested end to end. The clock is passed in, so tests are reproducible.

D36 "Restart" now means reopening a saved run in the tab. recoverDeliveries() does what the Python restart did: any delivery left queued, submitting or unknown is reconciled with the ERP simulator before anything is resubmitted. The bundled reference data is a byte-identical copy (frontend/lib/domain/reference-data.v1.json, checked by a test) because the Next.js build must not import from outside frontend/.

D37 Rebuild slice 4, intake: the browser reads the email and PDF (postal-mime, pdf.js) and keeps only page text and the SHA-256 in the run. The checks match the prototype (size, "%PDF-" start, encryption, 1 to 50 pages) with the same messages. One addition: a PDF encrypted with an empty password opens in pdf.js without asking, so it is refused by its permissions entry, as pypdf's is_encrypted refused it. pdf.js text equals pypdf's except that pypdf ends each page with a newline; evidence checks squash whitespace, so nothing changes. Email dates keep the sender's offset as Python did; the rare "-0000" (offset unknown) is recorded as +00:00 because the run requires an offset.

D38 Rebuild slice 4, server: extraction is one route, /api/extract (POST page text, GET availability). The prototype's /api/health and other /api paths stay with FastAPI until slice 5 removes the rewrite, because a Next.js route on the same path would take over from FastAPI. The Gemini key is read only in lib/server/, whose modules start with import "server-only" (package server-only 0.0.1) so a browser bundle that imports them fails to build. The route allows 300 seconds (maxDuration) because a live call with retries and the fallback model ran past a minute on 2026-10-15; slice 6 confirms this against the Vercel plan. Request bodies over 4 MB are refused before Vercel's 4.5 MB limit.


D39 Rebuild slice 5: every screen action is one server action (app/actions/run.ts). The browser sends the whole run and a typed action; the server checks both against strict schemas, runs the workflow function and returns the next run, or the refusal (400 bad input, 403 wrong role, 409 not allowed now) as a value, because Next.js hides the message of an error thrown from a server action in production. Actions run one at a time, each on the newest run. The role picked on screen decides the actor ("reviewer:rita", "administrator:alex"), as the X-Demo headers did (D22, demo-only). The action body limit is raised to 4 MB, under Vercel's 4.5 MB request limit.

D40 Limits of the server checks: the run lives in the browser, so the server can check that a run and an action are well formed and allowed by the workflow, not that the browser told the truth about earlier steps. Extraction results are checked again against the page text the run holds (normalise is run a second time; it changes nothing for an honest result), so a value whose evidence is not in that text is stored as unverified whatever the browser claims. Intake (email, PDF hash and page text) is trusted from the browser, as D37 decided.

D41 Reload and tabs: the run is saved to sessionStorage after every change, so it survives a reload of the same tab and a new tab starts empty. Extraction cannot resume after a reload, so a document caught mid-extraction is marked "Extraction failed" with "Use Retry extraction". The original PDF bytes are kept in memory only (never in the run, D30); after a reload the "Original PDF" tab says so and the PDF text with evidence is still shown. A result arriving after a reset is dropped rather than applied to a new document with the same number.

D42 The old e2e specs still call POST /api/demo/reset and PUT /api/demo/rehearsal-mode; those paths no longer exist and answer 404, which the specs ignore. The specs are kept unchanged on purpose (they are the parity gate); every test starts in a fresh browser tab, so it starts from an empty run, and the test server runs the labelled TEST ADAPTER (ORDER_AGENT_EXTRACTOR=test). The FastAPI-only endpoints with no screen (reference-data import, demo-envelope PDF upload, audit list) are not exposed as actions; the workflow functions exist (importReference, intakeUpload) for when a screen needs them.

D43 Local Gemini key: Next.js reads frontend/.env.local, not the repo-root .env, so for `npm run dev` the GEMINI_* lines go in frontend/.env.local (git-ignored). The live Playwright config reads only the GEMINI_* lines of the repo-root .env and passes them to the Next.js server process; the key never reaches the browser bundle (checked: no Gemini name or URL in .next/static).
