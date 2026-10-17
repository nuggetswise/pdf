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

D44 Owner decision 2026-10-15 (Mandip): no guided demo or video-step walkthrough; the product should feel like a real app. The Guided demo tab, its narration and its 15-step test are removed. The app opens on "Inbox & review" with an upload box that takes a PDF purchase order directly (or a forwarded .eml), by click or drag and drop; the bundled fictional emails stay as one-click samples. An uploaded PDF has no email around it, so it is recorded with intake mode demo_envelope_upload and no sender, and the order header names the file. The story the guided demo covered is now one Playwright test that clicks through the real screens (e2e/app-flow.spec.ts): upload, exception review, automatic delivery, Exception-only, memory reuse and scope, revocation, Review-all, ERP timeout and safe retry, duplicate. The workflow-level replay of the same 15 steps (Vitest) still compares with the Python run. Reverse: restore app/GuidedDemo.tsx from git history.

D45 Owner decision 2026-10-15 (Mandip): long-tail supplier portal after Step 1. On ERP delivery the agent also generates a simulated EDIFACT ORDRSP to the retailer. Step 2: a reviewer creates one ASN per delivered order, editing shipped quantities (default = ordered); shipping more than ordered is refused unless an override reason is given. Submit creates an EDIFACT DESADV for a simulated "Retailer EDI outbox" and a shipment record in the supplier ERP simulator. Step 3: one invoice per ASN; quantities from the ASN, prices from the order, totals with the exact decimal module (half-up to cents, tax not calculated); an invoice whose lines do not match its ASN is refused. Every outbound message has its own status (pending, delivered, failed), idempotency key and a safe retry that first checks whether the receiver already holds the key; the screen shows each status separately ("ERP synced, EDI to retailer pending"). Submit is the only click. EDIFACT (D.96A) is deterministic and escapes ? ' + : in document text; control characters become spaces; text is cut before escaping so no dangling "?". GLNs use the GS1 restricted-circulation prefix 02 and are labelled fictional. State lives in an optional RunState.portal (runs saved earlier and the Python exports load unchanged; Python parity fixtures and existing read models are untouched; ORDRSP adds no audit rows so the replay still matches the Python run). An administrator can make the next EDI message stay pending or fail; the existing ERP failure setting also applies to ERP shipment/invoice records. Nothing is sent anywhere real. Reverse: remove lib/domain/portal.ts, edifact.ts, app/Portal.tsx and the confirmOrder calls in workflow.ts.

D46 Owner request 2026-10-15 (Mandip): session onboarding so a real supplier can process real POs. A real PO (customer not in the fictional reference data) raised "Customer not recognised" with only Reject as a way out, plus "Item not recognised" for every line. A reviewer can now, never automatically: "Add as new customer" (from the printed name, editable; currency from the PO; printed customer ID kept, otherwise SESSION-CUST-NN; printed ship-to kept, and when none is printed, ship-to is not checked for that customer until one is added), "Assign to existing customer" (the printed name or ID becomes an alias of a customer on file), "Add ship-to" for a printed ship-to not on file, and "Add to catalogue" on an unknown line (product from the printed GTIN, or item code as a customer alias; printed description and unit; the printed unit price and order currency become that customer's reference price; minimum order quantity default 1, editable; SKU defaults to the printed identifier and may not clash with an existing one). Products need the customer first because prices and minimums are per customer. Additions live in an optional RunState.referenceOverlay, merged over the reference data for validation only; the reference file is unchanged and the version reads "REF-2026-10-v1 + session additions" (memory rules stay tied to the base version). Each addition is an audit event with the actor, re-runs validation for the current order, and applies to later orders. Additions are not issue decisions, so the issue policy table, read-model shapes and Python parity fixtures are unchanged. An order cleared by onboarding waits for an explicit approval even in Exception-only mode; a repeat order is then handled by the normal policy. The Agent memory tab lists them under "Added in this session"; Reset demo removes them. Reverse: remove lib/domain/onboarding.ts, the four actions in workflow.ts/run-action.ts and the Onboard component.

D47 Owner request 2026-10-15 (Mandip): retailer EDI compliance. Messages move from D.96A to EANCOM 2002 on directory D.01B (UNH ORDRSP EAN009, DESADV EAN007, INVOIC EAN011; syntax UNOC:3), which supersedes the D.96A and GS1 prefix 02 parts of D45. Target retailer: MediaMarktSaturn, the only large retailer found with openly published EANCOM INVOIC and DESADV guides, layered on a GS1 EANCOM 2002 baseline; a retailer's private MIGs were not available and this environment could not open gs1.org or the MMS site, so sources were read through search summaries only and every rule is marked sourced or inferred (docs/08-edi-mapping.md). Fictional identifiers move to GS1 prefix 952 (reserved for demonstrations). A new EDI setup form holds the supplier's GLN, VAT number, GS1 company prefix, tax type and default rate, and per customer the buyer GLN, VAT number, delivery GLN per ship-to, EDI agreement reference and compliance profile (eancom2002 default, mediamarktsaturn, or fictional_demo for the bundled fictional customers only, where an invalid demo GTIN is a warning instead of a block); GLN check digits are validated and each save is audited. The ASN carries a pallet and carton hierarchy (CPS/PAC/PCI+33E/GIN+BJ) with SSCCs built from the company prefix and a per-run serial, despatch date and estimated delivery date. The invoice carries a tax rate per line, discount (DI) and freight (FC) allowances or charges, tax per rate rounded half-up, and a three-way match against the PO and ASN; a mismatch blocks submit. Every outbound message is parsed back and checked against the profile's rules before it may be sent; a blocking finding stops it and the screen shows why with source links. A non-compliant ORDRSP is held (not sent) and can be checked again and sent after setup. Independent checks: ts-edifact 0.0.14 against the D.01B DESADV and INVOIC tables (it ships no ORDRSP table; its undeclared dependencies htmlparser2 9.1.0 and @initics/tsm 1.0.2 are pinned devDependencies) and pydifact 0.2.3 for interchange syntax and counts, on six committed samples in fixtures/edi-samples/. Known limits: SSCC serials can repeat across browser sessions (real use needs ERP or label-printer numbering), one item per carton, only DI and FC codes, tax categories S and Z only, MOA+131 not sent, mapping provisional until checked against real POs and the retailer's full MIGs. Reverse: restore edifact.ts, portal.ts and Portal.tsx from before this change and remove compliance.ts, gs1.ts and partners.ts.

D48 Owner decisions 2026-10-16 (Mandip): the prototype tells a three-act story for US retail (cost of staying on PDF, the Order Agent, outbound documents pre-filled in a simulated Trading Grid web form); USD only; e-invoicing mandates out of scope. Plan and per-screen change list: the review doc "PDF Order Portal: Altitude, Depth, Range review" (Claude Doc). Phase 1 (US data): bundled fictional data moves from CAD to USD and from made-up item codes (DEMO-GTIN-A01 etc.) to valid 12-digit GTINs on GS1's documented example company prefix 0614141 (614141000012, -029, -036 active; 614141000043 retired), so the outdated-GTIN story uses real-format codes and the retailer check raises no GTIN warnings on clean orders. All derived fixtures were regenerated with the existing scripts; full-demo-run.json now has its own generator (scripts/full_demo_run.py, Python run + export_run_state.py). maskTimes also masks the date inside EDI segment descriptions, which made the server-action replay test fail on any day other than the one its fixture was recorded. Reverse: git revert the phase 1 commit.

D49 Phase 2, Act 1 (owner plan 2026-10-16): every order shows "If you retyped this order" above the issues: fields to retype (6 order header + 4 per line, 4 ASN header + 1 per line, 2 invoice header + 1 per line), minutes and labour cost, the errors the agent caught priced as the manual route would carry them (price mismatch = short-pay of the difference times quantity; retired or unknown GTIN = flat ASN mismatch chargeback; MOQ = a loss, not a chargeback; a line fixed from memory counts like a retired GTIN), an expected late-ASN chargeback (order value x penalty % x chance late) and expected keying mistakes. Each issue card adds one "Manual route" line. Two summary tiles total fields not retyped and exposure avoided over orders in the ERP. All inputs are labelled example assumptions in an optional RunState.manualRoute, changed only by an administrator (audited); defaults 20 s per field, USD 30/h, 10% late chance, 2% late-ASN penalty, USD 50 ASN mismatch, 1% keying error, from the sources in the review doc. Exact decimals throughout. Reverse: remove manual-route*.ts, ManualRoute.tsx and the three call sites.

## D50 Trading Grid web form sends ANSI X12 for US retailers (2026-10-16)
- Scope is USD and North America, so the default retailer rules profile is now "US retail X12 baseline" (x12_retail): 855 acknowledgement, 856 ship notice with SSCCs (MAN*GM), 810 invoice with TDS in cents, ISA15 = T (test). EANCOM 2002 and the MediaMarktSaturn profile stay selectable per retailer; the old fictional_demo relaxed profile is removed.
- The portal is labelled as the Trading Grid supplier web form, pre-filled by the Order Agent (simulated). The EDI tab is the "Trading Grid outbox"; downloads use .x12.
- The fictional US supplier uses tax type SALES at 0% (wholesale for resale). EANCOM output maps SALES to UNCL 5153 "LOC".
- Setup form: VAT numbers, tax type and EDI agreement reference show only for EANCOM profiles; a new optional vendor number goes out as REF*IA.
- X12 rules are our own reading of 004010 (basis "inferred"). No independent X12 parser is installed (only the owner may name packages), so verification is structural tests in x12.test.ts plus committed samples in fixtures/edi-samples/*.x12. Reversible: switch a retailer back to EANCOM in its EDI setup.

## D51 Carton labels, carrier details and the ASN clock (2026-10-16)
- After an ASN is sent, "Print GS1-128 labels" opens a print-ready page with one 4x6 label per pallet and carton: supplier, PO, ASN, carrier, contents and a GS1-128 barcode of (00) + SSCC. Code 128 set C with FNC1; the bar table is copied from ReportLab and a test checks our symbol values against ReportLab's encoder for GS1's published SSCC example. Labels are marked fictional.
- The ASN form takes an optional carrier SCAC (2-4 letters), bill of lading and tracking (PRO) number; they go on the 856 as TD5, REF*BM and REF*CN and into the ERP shipment record.
- ASN clock (inferred rules, not one retailer's routing guide): "late" when the goods left before the day the ASN goes out; a warning when estimated delivery is after the PO's delivery date or missing. Shown while filling the ASN and on the sent ASN. The PO's requested delivery date is the only date PDFs carry today, so a separate ship window is not modelled.

## D52 Partial shipments, backorders and payment terms (2026-10-16)
- An order can ship in several ASNs. Each ASN may ship only what is still open (ordered, less earlier ASNs, less cancellations); shipping more needs an override reason as before. Each ASN gets its own invoice, billed from that ASN's quantities.
- After a short shipment the portal shows a backorder with two choices: ship the rest on a next ASN, or cancel the rest with a reason. Cancelling is recorded, audited and sent to the ERP simulator as an order change (ERP_ORDER_CHANGE); it is refused before anything has shipped (reject the order in review instead).
- Payment terms live in the supplier's EDI setup (fictional default "2% 10, net 30"). Each invoice stores its terms and due date (invoice date + net days) and the 810 carries ITD and DTM*814; BIG now carries the PO date.
- Deferred: an 855 that confirms less than ordered before shipping (the 855 still acknowledges the order as received); telling the retailer about a cancelled backorder by EDI.

## D53 Pilot measurement export (2026-10-16)
- "Export pilot measurements (CSV)" under the summary tiles downloads one row per order, built only from what the run records: received, approved by (person or policy), in ERP, minutes PDF to ERP, first ASN and minutes ERP to ASN, ASN count, first invoice, values extracted, values a person edited after extraction, issues caught, lines fixed by memory, decisions by a person, and the Act 1 estimate (fields, minutes, exposure). Durations are calendar time between recorded events.
- The CSV defuses spreadsheet formulas (a leading apostrophe on cells starting with = + - @ that are not numbers) because PO numbers and customer IDs come from uploaded documents.
- Nothing is sent anywhere; the file is made in the browser. A pilot compares these rows with the supplier's own timing of the manual route.

## D54 Suppliers who stay on email; the retailer gets EDI (2026-10-16)
- Mandip reframed the product: some suppliers refuse the Trading Grid portal because it is not connected to their ERP, so the agent goes where they are. The supplier keeps email and their ERP; the retailer receives standard X12 as from any connected supplier.
- New default screen "Supplier and retailer": supplier's inbox on the left (forward a PO, decide exceptions, reply in plain words, mark shipped in ERP), the retailer's EDI inbox on the right.
- A plain-language reply ("we can only do 10 not 12 on line A, ships Monday") is read by Gemini (or the labelled rehearsal reader) into per-line changes. Every change must quote words found in the reply, name a PO line and differ from the PO; anything else is listed as unclear. A person confirms before anything is sent.
- Confirming sends a changed 855 (BAK AC; ACK IQ/IP/IC; DTM*068 ship date), an ERP order change, and closes the quantity that will not ship so the ASN and invoice follow the confirmed amount. Increases over the PO and replies after shipping are refused. Quoted price changes go on the 855 for the retailer to accept; the invoice stays at the PO price.
- "Mark shipped in ERP" builds the ASN from open quantities and the invoice from the ASN, with the usual compliance checks.
- Supplier scorecard as a paid retailer product was dropped: no public evidence retailers pay for one (search 2026-10-16).

## D55 Enterprise shell in OpenText colours (2026-10-16)
- A Supplier/Retailer toggle at the top replaces the split screen. Supplier workspace: Today, Orders, Agent memory, ERP records, Trading Grid outbox, Settings. Retailer workspace: Documents received, Suppliers.
- Today shows a live flow ribbon (forwarded, read, checked, in ERP, sent to retailer), what needs a person, and what the agent handled alone.
- Colours: Cobalt Blue #001889 and Electric Blue #0075FC, from public brand listings (not verified against brandcentral.opentext.com). Icons from lucide-react.

## D56 — Real product only, no demo controls (2026-10-16)
Mandip: no demo mode. Removed from the screen: the Exception-only/Review-all badge, the retype-cost panel and
risk lines, the chargeback KPI, the prefilled reply and the hardcoded carrier/tracking (the supplier now enters both
when marking shipped). Automation stays as one plain Settings choice ("When an order passes every check"), since
both modes are acceptance requirements. Rehearsal, ERP-failure simulation and clearing the tab show only when the
server runs the test adapter, never with the AI, so the acceptance tests keep exercising them. Each order now shows
who emailed it, when, and that it was forwarded to the agent address. Retype-cost figures move to talking points.

## D57 OpenText palette on every screen (2026-10-16)
Cobalt #001889 as the accent everywhere, neutral card borders with a thin coloured left bar for state, sticky
header and side menu. Only the landing screen matched before.

## D58 The PO page as printed, with boxes (2026-10-16)
The order screen draws each PDF page (pdf.js, scripts and forms off) and boxes every value the agent read; issues
box amber. Clicking a box, an issue or an order line selects the others. The PDF is kept in this browser
(IndexedDB, by hash) so the page survives a reload; it never leaves the browser except to the AI. The text tab is
removed. pdf.js 6 needs Map.getOrInsertComputed, polyfilled for browsers without it.

## D59 Any layout: terms, dates and the PDF itself to the AI (2026-10-16)
The AI now receives the PDF (up to about 2.6 MB) with its text, or page images for a scan, and a wider schema:
supplier SKU, payment and freight terms, ship-not-before / ship-no-later-than, delivery window, ship complete and
the buyer's notes word for word. Terms sit outside the Python parity payload, so the parity gates are unchanged.
Lines match by GTIN, retailer item, then supplier SKU; units compare case-insensitively. A scan's transcription
becomes its page text and a scanned order always waits for a person. Printed dates are read US month-first; a date
that cannot be read is never guessed. Not done: saving per-retailer reading corrections after admin approval.

## D60 One example PO (2026-10-16)
The product offers one fictional example, PO-2026-104587 from Maple Retail Group (FreshMart Markets) in USD,
modelled on the owner's sample (scripts/example_po.py). The VIDEO-DEMO samples stay for tests only. The test
adapter reads both fictional layouts; real uploads go to the AI.

## D61 Stock check, ship date and short stock (2026-10-16)
When an order reaches the ERP the agent checks each line against ERP stock (on hand less what other open orders
hold; incoming deliveries; lead time). Ship date follows available-to-promise practice: ready date plus packing
working days, never before the ship window; latest ship date is the earlier of the window end and delivery date
less transit days. If stock is short, the confirmation waits for a person: hold and ship complete (recommended when
on time or the PO asks to ship complete), ship now and backorder, or ship now and cancel. The 855 then carries one
ACK per part (IA/IB/IR with 068 and its date) and the ERP gets the schedule. Shipping takes what stock covers and
lowers stock. Settings: packing days, transit days, short-stock rule. Lateness is a warning, never a hold.

## D62 Email-body orders, non-orders and evidence-only attachments (2026-10-17)
An email is never refused for having no PDF. Every attachment is listed with its hash and handling. PDFs and X12
files are read as possible orders; spreadsheets, images and unreadable files are kept as evidence with a note. When
no attachment can carry an order, the email text becomes the document the agent reads, so body and attachment never
both make an order. A reading with neither a PO number nor lines is classed Not an order (a deterministic floor the
AI cannot lower), kept in intake history with its reason, and Treat as order corrects it. An X12 850 is read from
its segments without AI. The email subject or text naming a different PO than the attachment is a blocking
"Email and attachment disagree" issue.

## D63 Dates are never assumed (2026-10-17)
Supersedes the US month-first reading in D59. A numeric date reads only when one reading is possible (a part above
12). 04/11/2026 offers 2026-04-11 and 2026-11-04; a weekday or relative date takes a date input. Both block the
order. The person's choice is stored in resolved_dates beside the printed value and is what ship dates, the ERP
and EDI use.

## D64 Supervision per retailer and route, internal hold, reject reason (2026-10-17)
Supervision is set per retailer and route (email attachment, email text, upload, EDI). Routes without a setting use
the default, which starts supervised. Automatic needs an administrator and a recorded reason (also for the default).
Blocking issues stop an order in both modes. Internal hold (reason from a short list) is separate from Waiting on
customer; it withdraws approval and nothing is sent while held. Reject needs no typed explanation and takes an
optional reason choice. Hold and reject apply before the ERP only.

## D65 Provenance and line placement, no confidence numbers (2026-10-17)
Each value shows separate statements: how it was read (AI, structured EDI reader, test adapter), whether its text is
in the source, whether it sits on the row of the line it was read for (the identifier's row and up to two more,
stopping at another line's identifier, matched as a whole number), what reference data matched, and what a person
confirmed. A value on another line blocks with "Value is not on the line it was read for". No confidence numbers are
shown or invented. An unknown ship-to offers the locations on file; the choice replaces the code on the order and
the printed code is kept.

## D66 Retail Command Center as a proposed composition (2026-10-17)
A thin working slice: Detect, Prioritise, Act, Verify over this app's records, recomputed by the server after every
action without AI. Four finding types (stock short, revised delivery, ERP order not confirmed, document not delivered).
One open finding per condition; history kept; action status separate from verification; each type states its
resolution condition and required evidence first; missing evidence keeps verification pending; sending is not
acceptance. Financial exposure shows Not available and root cause Not established. Supplier-private findings never
reach the retailer view, which is scoped to one retailer. Labelled "Proposed composition"; no CCIM or CCPM link.
Spec: docs/10-command-center.md.

## D67 Pilot export extended, no savings claimed (2026-10-17)
Adds route, supervision mode, minutes from receipt to checked, minutes waiting for a person (elapsed, not effort),
exception reasons, ERP attempts, confirmed outcome and per-order findings (types, first detection, owners, action,
verified count and time, pending count). chargeback_exposure_avoided is renamed chargeback_exposure_assumed: it comes
from the administrator's manual-route assumptions and is not a measured saving.

## D68 Intake test pack with independent expected results (2026-10-17)
fixtures/test-pack holds fictional emails, PDFs and an X12 850 made by scripts/test_pack.py, and hand-written
expected results. lib/test-pack.test.ts runs each case through intake and the server actions and never branches on a
case id or file name. The wrong-line case uses a hand-written stand-in for an AI result, labelled as such, because a
deterministic reader cannot produce it. The invoice check formerly called a three-way match is renamed "Order, ASN
and invoice check": it compares the supplier's PO line, ASN and invoice; there is no goods receipt
(docs/11-system-of-record.md).

## D69 One shortage, one finding; acceptance verifies (2026-10-17)
The stock shortage used to produce two findings for one condition: the supplier's "Stock short" finding, verified when
the confirmation was delivered, and a shared "Revised delivery" finding verified by the retailer's response. Delivery
was being counted as verification. Now the supplier's confirmation is the action on the shortage finding, and when the
confirmation ships less or later than the PO asked, only the retailer's recorded acceptance verifies it (delivery stays
as outcome evidence). The shared finding still exists so the retailer can respond without seeing supplier stock; the
supplier's list hides it while its shortage finding exists. A confirmation that changes nothing is still verified on
delivery. The acceptance is a simulated retailer response and is labelled so beside the buttons.
Demo-readiness changes in the same pass: the signed-in user switch shows only with the test adapter; the header chip for
the test adapter reads "Scripted reader, not live AI" and stays until live AI reading is verified; the disabled
"Invite to Trading Grid EDI" button is replaced by "Onboarding is outside this concept"; the Today tiles are hidden
until an order exists. Currency, dates and retailer profile are unchanged (no decision yet).

## D70 The shortage deadline starts at receipt by the agent (2026-10-17)
The PO note "report shortages within 24 hours of order receipt" is now measured from when the order agent's mailbox
received the order (the envelope's intake time), not from the sender's Date header. In production the two differ by
seconds; for a forwarded example email dated in the past, the Date header made the deadline read "passed" before the
demo began. No clock control or reset is added: the deadline counts down in real time. The Today flow bar now has six
columns (it had five for six steps) and the forward box keeps its button on its own line.

## D71 Order Operations: explicit order states over a sample inbox (2026-10-17)
Mandip's brief asks the prototype to test one hypothesis: an emailed PDF order can become a trustworthy transaction
with a person needed only for meaningful judgement. The app now opens on "Order operations": counts by state, a
"Needs attention" queue first, and every other order with its simulated ERP result. Today is removed (its forward box
moved to the home side panel) and "Orders" is renamed "Intake".
- New domain `lib/domain/ops/` with explicit order states (received to accepted or rejected), issue types
  (correctable discrepancy, ambiguous match, missing required data, validation failure, downstream rejection),
  decision outcomes (accepted or rejected recommendation, selected option, corrected value, deferred) and field states
  (accepted, changed, uncertain, missing, invalid). State is computed from decisions and issues, never display text.
- Kept separate from RunState (own sessionStorage key) so saved runs, Python parity fixtures and the server action
  contract do not change. Reversible: the module can later be fed by the live reading pipeline.
- Eighteen fictional sample emails are read by the same rules each time the tab opens. The reading step of samples is
  simulated (structured fixtures rendered as a document, no OCR or AI); the recommendation text is rule-generated from
  reference data and order history and shown under "Order agent (AI)". The ERP is simulated with its own customer
  master, so a downstream rejection can happen after the agent's checks pass.
- Behaviour: enough evidence sends automatically; a correctable discrepancy gets a recommendation with evidence; an
  ambiguity lists options with no recommendation; missing critical data blocks with no proposed fix. A person's change
  requires one approval, which sends (no separate send step). Decisions can be undone until an ERP submission follows.
- No confidence scores. Orders forwarded in the session appear in the same queue and open in Intake.
Details, gap analysis and capability boundaries: docs/13-order-operations.md.

## D72 Forwarded orders in the order review, phone layout, and who rejects an order (2026-10-17)
Mandip's follow-up to D71: close the gaps, fix the phone view, and say where an ERP rejection comes from.
- Forwarded and uploaded orders now open in the same order review as the sample inbox (`app/ForwardedReview.tsx`):
  source beside the structured order, decision first, field states, your ERP (simulated), and a history that names
  System, AI agent, Person and ERP. Decisions still run on the reading pipeline's workflow (MOQ, price, GTIN, stock,
  shipping, invoicing unchanged); "Open in Intake" keeps the full workspace one click away. The two engines remain
  (one queue, one review layout, two data models); undo exists only on the sample inbox.
- Phone width: the header no longer sticks (it took a quarter of the screen), the section strip scrolls in one
  line, tables marked `.stack-table` become one card per row, fieldsets and long selects no longer widen the page.
  A browser test measures every screen at 390 px.
- Who rejects: the accept-or-reject decision belongs to the supplier's own ERP (for example an inactive ship-to in
  its customer master). The Order Agent's part is to send once, record the ERP's response, explain it and propose a
  correction from the ERP's own data, then resend with the same idempotency rules. The ERP panel says so, and the
  ERP is named "Your ERP (simulated)". This assumes an ERP connection that returns errors; no Trading Grid capability
  is claimed for it.

