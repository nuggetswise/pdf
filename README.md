# PDF Order Agent (prototype)

A local prototype showing how a forwarded email with a PDF purchase order can be read, checked against business rules, reviewed only where needed, and delivered to a simulated ERP. All data is fictional. Nothing connects to a real mailbox, marketplace or ERP.

Status: all 7 slices done, including a click-through guided demo for leadership. See IMPLEMENTATION_PLAN.md, DECISIONS.md and docs/acceptance-results.md.

## Start it (two terminal windows)
1. Backend: `python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.lock`, then `backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000`
2. Screen: `cd frontend && npm ci && npm run dev`, then open http://localhost:3000

## Run the guided demo
Open http://localhost:3000. The "Guided demo" tab walks through the full story in 15 steps. Click the blue button once to perform a step (it waits for the real result), and again to move on. Play runs it by itself; arrow keys and space also work. Starting resets the prototype.
- "Start demo with live AI extraction" needs a Gemini key (below). Gemini can take over a minute when busy; the demo says so and offers Retry or rehearsal mode.
- "Start in rehearsal mode" uses a fixture parser called the TEST ADAPTER. It is labelled "not AI" everywhere.

Other tabs: "Inbox & review" (forward emails and decide issues yourself; switch role top right), "Agent memory" (activate or revoke learned rules as Administrator), "ERP records" (what the simulator holds).

## Check everything
`scripts/verify.sh` runs backend tests, the typecheck, the production build and the browser tests (which save screenshots to docs/screenshots/).

## Host it on Vercel
See docs/hosting-vercel.md. In short: the screens and the Python service are two Vercel projects from this repository, the service uses Neon Postgres, and the Gemini key lives only on the service project. Locally nothing changes: SQLite is still the default.

## Configuration
Copy `.env.example` to `.env`. `GEMINI_API_KEY`, `GEMINI_MODEL` and optional `GEMINI_FALLBACK_MODEL` enable real PDF reading. Without them the app says extraction is unavailable; it never pretends.

## Folders
- `docs/` requirements (Markdown is the source; the .docx has the same content)
- `fixtures/regression/` the original sample order and expected results
- `fixtures/demo/` the video-aligned demo orders, expected results and generated fictional PDFs/emails
- `fixtures/reference-data.v1.json` fictional customers, products, prices, MOQ rules and identifiers
- `backend/` FastAPI service and tests (`backend/runtime_data/` is a copy of the fixtures the service reads, kept in step by `scripts/sync_runtime_data.py`); `frontend/` Next.js screens; `scripts/` fixture generator

## Local API
- `POST /api/intake/eml` import a forwarded .eml with a PDF attachment
- `POST /api/intake/demo-envelope` demo envelope (sender, subject) plus uploaded PDF
- `POST /api/demo/forward/{name}` "Forward to agent" using a bundled fictional email; nothing is sent over the internet
- `GET /api/documents`, `GET /api/documents/{id}`, `GET /api/documents/{id}/pdf`
- `POST /api/documents/{id}/retry-extraction` after a failed or unavailable extraction
- `GET /api/audit`
- `GET /api/orders`, `GET /api/summary` order states and executive summary
- `POST /api/documents/{id}/decisions` record a decision on an issue (role header required)
- `POST /api/documents/{id}/approve` approve a clean order in Review-all mode; delivery starts automatically
- `POST /api/documents/{id}/retry-delivery` reconcile with the ERP, then retry with the same key
- `GET/PUT /api/policy` automation mode (Administrator to change)
- `GET /api/memory-rules`, `POST /api/memory-rules/{id}/state` activate or revoke (Administrator)
- `GET /api/erp/orders` ERP simulator records
- `GET/POST /api/reference-data` versioned reference data (Administrator to import)
- `PUT /api/demo/rehearsal-mode`, `PUT /api/demo/erp-failure-mode`, `POST /api/demo/reset` demo controls (Administrator)

Demo roles travel as `X-Demo-Role` (reviewer, administrator) and `X-Demo-User` headers. This is demo-only, not authentication.

## What is real and what is simulated
Real: PDF reading (Gemini when a key is set), evidence checks, business rules, decisions, versions, approvals, automatic delivery, idempotency and reconciliation, memory rules, audit trail, persistence across restarts.
Simulated: email arrives from local .eml files (no Outlook); the ERP is a local simulator; sign-in is demo-only; all data is fictional. Time saved is not measured.
