# PDF Order Agent (prototype)

A local prototype showing how a forwarded email with a PDF purchase order can be read, checked against business rules, reviewed only where needed, and delivered to a simulated ERP. All data is fictional. Nothing connects to a real mailbox, marketplace or ERP.

Status: the prototype's 7 slices are done; the Vercel rebuild has reached slice 5 of 7 (one Next.js app, run held in the browser tab). See IMPLEMENTATION_PLAN.md, DECISIONS.md and docs/acceptance-results.md.

## Start it
`cd frontend && npm ci && npm run dev`, then open http://localhost:3000. That is the whole app: one Next.js server. The run you build up lives in your browser tab; it survives a reload of that tab, and a new tab starts empty. Nothing is saved on the server.

The Python prototype in `backend/` is kept only for comparison tests until it is retired (rebuild slice 7); the app does not use it.

## Run the guided demo
Open http://localhost:3000. The "Guided demo" tab walks through the full story in 15 steps. Click the blue button once to perform a step (it waits for the real result), and again to move on. Play runs it by itself; arrow keys and space also work. Starting resets the run in this tab.
- "Start demo with live AI extraction" needs a Gemini key (below). Gemini can take over a minute when busy; the demo says so and offers Retry or rehearsal mode.
- "Start in rehearsal mode" uses a fixture parser called the TEST ADAPTER. It is labelled "not AI" everywhere.

Other tabs: "Inbox & review" (forward emails and decide issues yourself; switch role top right), "Agent memory" (activate or revoke learned rules as Administrator), "ERP records" (what the simulator holds).

## Check everything
`scripts/verify.sh` runs the Python comparison tests, the TypeScript tests, the typecheck, the production build and the browser tests (which save screenshots to docs/screenshots/).

## Configuration
Put `GEMINI_API_KEY`, `GEMINI_MODEL` and optional `GEMINI_FALLBACK_MODEL` in `frontend/.env.local` (never committed) to enable real PDF reading; the live browser test reads the same lines from the repo-root `.env`. The key stays on the server. Without them the app says extraction is unavailable; it never pretends.

## Folders
- `docs/` requirements (Markdown is the source; the .docx has the same content)
- `fixtures/regression/` the original sample order and expected results
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
Simulated: email arrives from local .eml files (no Outlook); the ERP is a simulator held in the browser tab; sign-in is demo-only; all data is fictional. Time saved is not measured.
