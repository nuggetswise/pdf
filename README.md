# PDF Order Agent (prototype)

A local prototype showing how a forwarded email with a PDF purchase order can be read, checked against business rules, reviewed only where needed, and delivered to a simulated ERP. All data is fictional. Nothing connects to a real mailbox, marketplace or ERP.

Status: the prototype's 7 slices are done; the Vercel rebuild has reached slice 5 of 7 (one Next.js app, run held in the browser tab). See IMPLEMENTATION_PLAN.md, DECISIONS.md and docs/acceptance-results.md.

## Start it
`cd frontend && npm ci && npm run dev`, then open http://localhost:3000. That is the whole app: one Next.js server. The run you build up lives in your browser tab; it survives a reload of that tab, and a new tab starts empty. Nothing is saved on the server.

The Python prototype in `backend/` is kept only for comparison tests until it is retired (rebuild slice 7); the app does not use it.

## Use it
The app opens on "Inbox & review". Upload a PDF purchase order (or a forwarded .eml with the PDF attached) by clicking or dropping it on the upload box. The agent reads it, matches the customer and products, checks MOQ, agreed price and retired product codes, and holds only what needs a person. Decide each held issue with a reason; when nothing is left, the order goes to the ERP simulator by itself, with no Send button. Sample fictional orders are one click away under the upload box.
- Switch role top right. As Administrator you can turn on Exception-only mode (clean orders go straight through), activate or revoke learned rules under "Agent memory", switch rehearsal mode (TEST ADAPTER, labelled "not AI") and make the ERP simulator fail or time out to see the safe retry.
- "ERP records" shows what the simulator holds.
- Supplier portal (simulated EDI): once an order is in the ERP, an order confirmation (EDIFACT ORDRSP) goes to a simulated retailer outbox by itself. On the order, "Create ASN" lets you enter what actually ships (it starts at the ordered quantity; more than ordered needs a reason); Submit sends a shipping notice (DESADV) to the retailer outbox and a shipment record to the ERP simulator. "Create invoice" then bills the shipped quantities at the order's prices; Submit sends an INVOIC and an ERP invoice record. Each message shows its own status (for example "ERP synced, EDI to retailer pending") with a safe retry. The "EDI" tab lists every message with the raw EDIFACT, what each line means, and a download. GLNs are fictional; nothing is sent to a real retailer.
- Retailer EDI rules: messages are EANCOM 2002 (D.01B). Before anything goes to the retailer outbox it is checked against that retailer's rules, and anything that would be rejected is held with the reasons and links to the guide they come from. For a customer added from a real PO, open "EDI setup" on the order and enter your GLN, VAT number and GS1 company prefix, the retailer's GLNs, and pick its rules (EANCOM 2002 baseline or MediaMarktSaturn); then "Check again and send" releases the held confirmation. The ASN form packs goods into cartons and pallets with SSCC numbers; the invoice form shows a three-way match with the PO and ASN, tax per line and discounts or freight. The field-by-field mapping, its sources and what still needs a real retailer test is in docs/08-edi-mapping.md.

## Trading Grid Portal: Orders (17 October 2026, D71, D72)
The app is the Trading Grid Portal; it opens on Orders. The Command Center is a feature of the portal. The retailer view shows one retailer (the retailer of the first order in the run), with no picker. It shows today's counts by state, a "Needs attention" queue (ERP rejections, blocked orders, orders needing review) and every other order with its simulated ERP result. The queue starts with 18 fictional sample emails from four fictional retailers to a fictional supplier, Northwind Beverage Co., read and checked when the tab opens: 13 go to the simulated ERP with no person, and five show the exception cases (a unit recommendation, an ambiguous product, a missing delivery location, an ERP rejection and a price recommendation). Open one with "Review order": the source PDF or email sits beside the structured order, the issue shows the original and proposed values, the recommendation and its evidence, and the actions. Decisions can be undone until the order is sent; "Approve and send to ERP" sends it. Every order has a readable history marking system steps, AI recommendations, people and the simulated ERP. Orders forwarded in the tab join the same queue and open in the same review; "Open in Intake" shows the full workspace. Your ERP, simulated, decides whether to accept or reject an order; the Order Agent records the response and proposes the correction. The app works at phone width. Details: docs/13-order-operations.md.

## What v1.2 adds (17 October 2026)
- Orders: add a PDF, a forwarded email (.eml) or an X12 850 file. An email without a PDF is read from its text. Messages that are not orders are kept in the intake list as "Not an order" with the reason; "Treat as order" corrects a wrong call. Search and filter the list by partner, issue, outcome and age.
- On an order: route and supervision chips, "Put on hold" with a reason, "Reject order" with an optional reason, value sources (how each value was read and checked), order history and a technical trace.
- Command Center (supplier and retailer views): findings such as a stock shortage, with owner, rule, deadline source, priority basis, suggested action, and verification that stays pending until the records show the outcome. Labelled "Proposed composition".
- Settings: supervision per retailer and route; automatic needs a reason. Ownership per finding type.
- Test files: `fixtures/test-pack/` (also downloadable at `/test-pack/<file>` from the running app), with expected results in `expected-results.json`.
- Storage: the run lives in this browser tab (sessionStorage, about 5 MB) and ends when the tab closes; PDFs are kept in this browser's IndexedDB. A new tab is a new run. Nothing is stored on the server.

## Real purchase orders from new customers
The bundled reference data only knows fictional demo customers and products, so a real PO first shows "Customer not recognised" and "Item not recognised". As a reviewer, click "Add as new customer" (or pick a customer and "Assign to existing customer"), then "Add to catalogue" on each line: the printed unit price becomes that customer's agreed price and the minimum order quantity starts at 1 (you can change it). The order then clears for approval, and later POs from that customer are checked against what you added. Additions last for this browser tab only, are listed on the Agent memory tab under "Added in this session" with who added them, and Reset demo removes them (DECISIONS.md D46).

## Check everything
`scripts/verify.sh` runs the Python comparison tests, the TypeScript tests, the typecheck, the production build and two independent EDIFACT validators (ts-edifact and pydifact) and the browser tests (which save screenshots to docs/screenshots/).

## Configuration
Put `GEMINI_API_KEY`, `GEMINI_MODEL` and optional `GEMINI_FALLBACK_MODEL` in `frontend/.env.local` (never committed) to enable real PDF reading; the live browser test reads the same lines from the repo-root `.env`. The key stays on the server. Without them the app says extraction is unavailable; it never pretends.

## Folders
- `docs/` requirements (Markdown is the source; the .docx has the same content)
- `fixtures/regression/` the original sample order and expected results
- `fixtures/example/` the one example purchase order the app offers (fictional, USD); ERP stock is in `frontend/lib/domain/erp-stock.v1.json` (fictional)
- `fixtures/demo/` the video-aligned demo orders, expected results and generated fictional PDFs/emails
- `fixtures/reference-data.v1.json` fictional customers, products, prices, MOQ rules and identifiers
- `frontend/` the app (screens, server actions, /api/extract); `backend/` the Python prototype, kept for comparison tests; `scripts/` fixture generators and verify

## Server
- Every screen action (decide, approve, retry, policy, memory rules, demo settings, reset) is a server action: the browser sends its run and the action, the server checks both, applies the business rules and returns the next run. Nothing is stored on the server.
- `POST /api/extract` page text in, evidence-checked extraction out (TEST ADAPTER in rehearsal mode, Gemini otherwise). `GET /api/extract` says whether extraction is available, without showing the key.
- Emails and PDFs are read in the browser; only page text is sent to the server.

Demo roles are picked top right and travel with each action. This is demo-only, not authentication.

## What is real and what is simulated
Real: PDF reading (Gemini when a key is set), evidence checks, business rules, decisions, versions, approvals, automatic delivery, idempotency and reconciliation, memory rules, audit trail, the run kept for the browser tab's session.
Simulated: email arrives from local .eml files (no Outlook); the ERP and the retailer EDI outbox are simulators held in the browser tab (EDIFACT messages are generated but never sent); sign-in is demo-only; all data is fictional. Time saved is not measured.
