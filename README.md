# Trading Grid Portal (prototype)

A supplier portal for orders that arrive as PDF emails. The portal reads each purchase order, checks it against the
supplier's ERP data, asks a person only when a check fails, writes the order to the ERP, and sends the retailer a
confirmation, a ship notice and an invoice as X12 documents. The retailer has its own view of what it received and any
change it must accept.

This build shows one fictional retailer (Maple Retail Group) and one fictional supplier (Northern Foods Manufacturing).
It runs as a test environment: the mailbox, the ERP and Trading Grid are simulated and nothing reaches a real
retailer. See docs/07-demo-scenario.md for the two orders and docs/14-leadership-demo.md for the narrative.

## Start it
`cd frontend && npm ci && npm run dev`, then open http://localhost:3000. One Next.js server runs everything. The run you
build lives in your browser tab and survives a reload; a new tab starts empty. Nothing is stored on the server.

## Use it
Supplier view: Orders, Transactions, Command Center, Rules, Settings. Retailer view: Documents received, Suppliers,
Command Center.
- Orders: the order mailbox shows the supplier's intake address. In production a supplier sets one auto-forward rule on
  the mailbox that receives retailer POs, or retailers send there directly. In the test environment, "Receive sample
  email" brings in the milk and cheese POs; "Add a document by hand" takes a PDF, an .eml or an X12 850.
- An order opens in one review: lifecycle bar (Received, Read, Checked, Decision, In your ERP, Confirmed to retailer,
  Shipped, Invoiced), the PDF beside the structured order, decisions, stock and ship date, ship notice and invoice.
- Rules is read-only: values synced from the ERP (a bundled snapshot in the test environment), the 17 checks, and the
  corrections reviewers saved for reuse.
- Settings: Connections, Company and Team are read-only; Notifications, Approval mode (Review all, or Automatic when
  checks pass with a recorded reason) and Who handles findings can be changed by an administrator. Test controls
  (collapsed, test environment only) make the events a real connection would produce, such as an ERP that does not
  answer.

## Check everything
`scripts/verify.sh` runs the TypeScript tests (including the Maple and intake test packs), the typecheck, the production
build and the browser tests, which save screenshots to docs/screenshots/.

## Configuration
Put `GEMINI_API_KEY`, `GEMINI_MODEL` and optional `GEMINI_FALLBACK_MODEL` in `frontend/.env.local` (never committed) to
read PDFs with AI. The key stays on the server. Without a key the app says reading is unavailable; it never pretends.
The browser tests and `ORDER_AGENT_EXTRACTOR=test` use a labelled scripted reader instead.

## Folders
- `docs/` requirements (01 to 06 are the owner's spec), scenario, X12 mapping, specs, results
- `fixtures/maple/` the Maple purchase orders and hand-written expected results; `fixtures/test-pack/` the intake test pack; `fixtures/onboarding/` an unknown buyer; `fixtures/edi-samples/` X12 output samples; `fixtures/reference-data.v1.json` the ERP snapshot
- `frontend/` the app (screens, server actions, /api/extract)
- `scripts/` fixture generators (Python, `pip install -r tools/requirements.lock`) and `verify.sh`

## What is real and what is simulated
Real: PDF reading (Gemini when a key is set), evidence checks, business rules, decisions, versions, approvals, automatic
delivery, idempotency and reconciliation, approved correction rules, the audit trail, the X12 messages and their rule
checks.
Simulated: the mailbox (sample emails and manual upload), the ERP, Trading Grid delivery and the retailer's answers,
sign-in (the signed-in user is chosen in the header, test environment only), and all data. Time saved is not measured.
