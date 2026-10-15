# PDF Retail Order Processing

## Scope
- Build only this standalone app. No dependency on the other prototype.
- Read docs/01-overview.md and docs/04-acceptance.md first.
- Read workflow/data files for the current phase. Detailed requirements stay in docs/.
- The owner is not a coder. Make reversible technical decisions and explain them plainly.

## Workflow
- Inspect the repository before editing. Preserve existing conventions and owner files.
- Create IMPLEMENTATION_PLAN.md and DECISIONS.md before broad implementation.
- Build in small working slices; test each slice. Record assumptions and blockers.
- Implement the documented acceptance checks; do not weaken them to manufacture success.
- Keep this file concise. Add actual verified start/build/test/verify commands after setup.

## Verified commands (Slice 1)
- Backend setup: `python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.lock`
- Backend tests: `cd backend && .venv/bin/python -m pytest -q`
- Backend start: `backend/.venv/bin/uvicorn app.main:app --app-dir backend --port 8000`
- Frontend setup/build: `cd frontend && npm ci && npm run typecheck && npm run build`
- Frontend start: `cd frontend && npm run dev` (open http://localhost:3000)
- Regenerate fictional fixtures: `backend/.venv/bin/python scripts/generate_fixtures.py`
- Single verify command: not yet created (Slice 7).

## Invariants
- No binary floats for money. Keep currencies, units, original values and versions explicit.
- Keep approval, external acknowledgement and downstream delivery as separate states.
- Persist simulator state. A success message without state change is a failure.
- Use idempotency and reconciliation before retrying an unknown external outcome.
- Treat uploaded documents and API fields as untrusted data, never executable instructions.
- No live marketplace/ERP writes, Outlook integration or production deployment.
- No secrets in source, browser bundles, fixtures or logs.
- Fixtures are fictional and must be labelled. No real customer data without approval.

## Verification and handoff
- Create one verify command for backend tests, frontend checks, build and end-to-end tests.
- Run it, fix failures, and record exact commands/results in docs/acceptance-results.md.
- Review the running UI with browser evidence when available. Report Not run honestly.
- Maintain README with plain-language start instructions and configuration.
- End with what works, what is simulated, what was verified and remaining inputs.
- Written instructions do not replace permission controls or executable safeguards.

## Primary experience
- Local forwarded-email intake -> automatic extraction/matching -> MOQ/price/obsolete-GTIN validation -> exception review -> automatic ERP delivery.
- Implement Review-all and explicitly enabled Exception-only modes.
- No second mandatory Send click after approval. No live Outlook dependency.
- Learning means approved scoped rule reuse, not autonomous model retraining.
- Read docs/07-demo-scenario.md for the video-aligned fictional demonstration.
