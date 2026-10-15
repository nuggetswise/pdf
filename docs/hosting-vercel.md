# Hosting the whole prototype on Vercel

Plain-language steps. Everything stays fictional; the ERP is still a simulator. Two Vercel projects are needed because the screens (Next.js) and the service (Python) are different kinds of project. Both come from the same GitHub repository.

## What runs where
- Project 1, `pdf` (already exists): the screens. Root Directory `frontend`.
- Project 2, new, for example `pdf-api`: the Python service. Root Directory `backend`. It talks to a Postgres database (Neon) and to Gemini.
- The browser only ever talks to Project 1. Project 1 forwards `/api/...` to Project 2.

## One-time setup (about 15 minutes, in the Vercel dashboard)
1. Create Project 2: Add New, Project, import `nuggetswise/pdf`, set Root Directory to `backend`, name it `pdf-api`. Framework: Other (or FastAPI if offered). Deploy once; the first deploy may fail until step 2 is done.
2. Add the database: Project 2, Storage, Create Database, Neon (Postgres). Accept the defaults. This adds `DATABASE_URL` for you. Tables are created automatically on the first request.
3. Add the Gemini settings: Project 2, Settings, Environment Variables. Add `GEMINI_API_KEY` (mark it Sensitive), `GEMINI_MODEL` (for example `gemini-3.5-flash`) and, optionally, `GEMINI_FALLBACK_MODEL`. Tick Production and Preview. Never put the Gemini key in Project 1.
4. Optional but recommended: add `CRON_SECRET` (any long random value) in Project 2 only if you want the "finish stuck documents" endpoint. Leave it out to keep that endpoint switched off.
5. Redeploy Project 2 (Deployments, latest, Redeploy). Open `https://<project-2-domain>/api/health`. You should see `"database": "postgres"` and `"processing": "inline"`.
6. Point Project 1 at Project 2: Project 1, Settings, Environment Variables, add `ORDER_AGENT_BACKEND_URL` = `https://<project-2-domain>` (no trailing slash) and `NEXT_PUBLIC_POLL_FACTOR` = `2`. This value is read at build time, so redeploy Project 1 afterwards.
7. Protect the demo: Project 1 and Project 2, Settings, Deployment Protection. Turn on Vercel Authentication or a password, otherwise anyone with the link can use your Gemini quota. If you protect Project 2, add Protection Bypass for Automation, or keep Project 2 on standard protection and rely on its unguessable name.

## Check it works
- `https://<project-1-domain>` shows the Guided demo.
- "Start in rehearsal mode" works without any Gemini key.
- "Start demo with live AI extraction" needs the Gemini key in Project 2. Gemini can take a minute; the demo shows it is waiting.

## How it differs from running on your laptop
- Documents are stored in the database, not in a folder.
- Each upload is processed during the request (a serverless function cannot keep working after it replies). The upload can therefore wait up to about 100 seconds when Gemini is busy.
- A document left half-processed by a timeout can be finished with `POST /api/internal/sweep` and header `Authorization: Bearer <CRON_SECRET>`, or by using "Retry extraction".
- Upload size is limited by Vercel to about 4.5 MB per request; set `ORDER_AGENT_MAX_UPLOAD_BYTES=4000000` in Project 2.

## Known limits (not hidden)
- The Vercel pieces (vercel.json routing, function duration, the proxy between the two projects) were built to Vercel's documented behaviour but could not be deployed from this environment. First deployment is the real test; see docs/acceptance-results.md.
- Delivery uses several short database transactions. The ERP idempotency key and reconciliation still prevent duplicates; two simultaneous retries of the same order are not serialised beyond that.
