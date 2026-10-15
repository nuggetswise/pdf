# PDF Order Agent (prototype)

A local prototype showing how a forwarded email with a PDF purchase order can be read, checked against business rules, reviewed only where needed, and delivered to a simulated ERP. All data is fictional. Nothing connects to a real mailbox, marketplace or ERP.

Status: Slices 1-2 of 7 done: forwarded-email inbox, automatic Gemini extraction with source evidence. See IMPLEMENTATION_PLAN.md and DECISIONS.md.

## Start it (two terminal windows)
1. Backend: `python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.lock`, then `backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000`
2. Screen: `cd frontend && npm ci && npm run dev`, then open http://localhost:3000

## Configuration
Copy `.env.example` to `.env`. `GEMINI_API_KEY`, `GEMINI_MODEL` and optional `GEMINI_FALLBACK_MODEL` enable real PDF reading. Without them the app says extraction is unavailable; it never pretends.

## Folders
- `docs/` requirements (Markdown is the source; the .docx has the same content)
- `fixtures/regression/` the original sample order and expected results
- `fixtures/demo/` the video-aligned demo orders, expected results and generated fictional PDFs/emails
- `fixtures/reference-data.v1.json` fictional customers, products, prices, MOQ rules and identifiers
- `backend/` FastAPI service and tests; `frontend/` Next.js screens; `scripts/` fixture generator

## Local API (so far)
- `POST /api/intake/eml` import a forwarded .eml with a PDF attachment
- `POST /api/intake/demo-envelope` demo envelope (sender, subject) plus uploaded PDF
- `POST /api/demo/forward/{name}` "Forward to agent" using a bundled fictional email; nothing is sent over the internet
- `GET /api/documents`, `GET /api/documents/{id}`, `GET /api/documents/{id}/pdf`
- `POST /api/documents/{id}/retry-extraction` after a failed or unavailable extraction
- `GET /api/audit`
