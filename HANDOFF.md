# Handoff: PDF Order Agent prototype

For the next Claude Code session. Read this first, then CLAUDE.md, IMPLEMENTATION_PLAN.md and DECISIONS.md.

## Who and why
Owner: Mandip, Lead AI PM at OpenText. Not a coder; make reversible technical choices yourself, record them in DECISIONS.md and explain in plain language. Direct answers, prose over bullets, no filler.

Purpose: a working prototype to show leadership how the forwarded-email/PDF order use case is achieved end to end, aligned to a Procuros Order Agent video. The point is to stand out with a working product instead of a deck. Mirakl is a separate prototype; do not touch it here.

Video moments to mirror (owner-supplied): 0:19-0:31 automated extraction and entry; 0:34-0:38 business rule validation; 0:36-0:44 MOQ check; 0:45-0:53 price verification; 0:54-1:04 outdated GTIN; 1:05-1:10 learning from corrections. Our learning is approved, scoped rule reuse with an administrator gate (DECISIONS.md D03), not autonomous retraining. Present it as "agent memory with provenance".

## Update (2026-10-17, Order Operations, D71)
Branch `claude/order-ops-upgrade-an6w93`, built on the unmerged v1.2 branch. New default view "Order operations" over a fictional 18-order sample inbox with explicit states, recommendations, ambiguity, blocked, ERP rejection, undo and history (`lib/domain/ops/`, `app/OrderOps.tsx`). Today removed; Orders renamed Intake. Read docs/13-order-operations.md first.

## Update (2026-10-17, v1.2: intake, governance, Command Center, D62-D68)
Branch `claude/project-thread-qjo9d5`. Email-text and X12 850 intake, Not an order with correction, evidence-only
attachments, dates never assumed, email/attachment conflict, line placement check, provenance per value, internal
hold and reject reason, supervision per retailer and route with a recorded reason, location choice, order history
and technical trace, intake search and filters, the proposed Command Center (stock shortage first) with a scoped
retailer view, extended pilot export, and a fictional test pack with hand-written expected results. Status per use
case: docs/09-spec-v1.2.md. Open: live Gemini on email text and on document classification is untested (no key);
UK/Morrisons pilot items conflict with the USD/North America scope and are listed in docs/12-pilot-readiness.md.

## Update (2026-10-15, retailer EDI compliance, D47)
Branch `claude/edi-retailer-compliance-ly1pbc`. EANCOM 2002 D.01B messages, EDI setup, SSCC pallet/carton ASN, invoice tax/allowances/three-way match, send blocked by retailer rules, ts-edifact and pydifact checks. Mapping in docs/08-edi-mapping.md is provisional: waiting on real PO PDFs and the retailer's MIG PDFs from the owner. gs1.org and edi.mediamarktsaturn.com cannot be fetched from the cloud environment.

## Update (2026-10-15, second session)
Branch `claude/gifted-faraday-o6apzv`. PR #1 was merged with only Slice 1; Slice 2 and this file were brought over from `claude/funny-maxwell-20w31v`. Slices 3-7 and the click-through guided demo (owner confirmed: click through without a presenter) are done. `scripts/verify.sh` passes: 47 backend tests, typecheck, build, 3 Playwright tests including the full 15-step demo with screenshots in docs/screenshots/. Not yet done: a live-Gemini rehearsal of the demo (needs GEMINI_API_KEY as an environment secret) and an owner walkthrough on a projector.

## Original state at first handoff (2026-10-15)
Branch `claude/funny-maxwell-20w31v`, draft PR https://github.com/nuggetswise/pdf/pull/1.

Done:
- Slice 1: docs/ and fixtures/ layout, versioned fictional reference data (fixtures/reference-data.v1.json), three demo orders (VIDEO-DEMO-001 three exceptions, -002 clean once mapping active, -003 second customer), deterministic PDF/.eml generator (scripts/generate_fixtures.py), golden files.
- Slice 2: local forwarded-email intake (.eml, demo envelope + PDF, "Forward to agent" for bundled fixtures), SQLite persistence, automatic processing, Gemini extraction with fixed schema and per-field evidence verified against PDF text, retry/fallback for Gemini overload, explicit unavailable/unsupported/duplicate/failed states, retry action, inbox UI with timeline, Playwright e2e.

Evidence: docs/acceptance-results.md. 27 backend tests, 1 e2e test, typecheck and build pass.

Next: Slice 3 (matching and validation), then 4 (review and modes), 5 (ERP simulator and auto-delivery), 6 (agent memory), 7 (polish, verify command, handoff). Checklists are in IMPLEMENTATION_PLAN.md.

## Environment notes
- Gemini key lives only in the git-ignored `.env` at repo root (GEMINI_API_KEY, GEMINI_MODEL=gemini-3.5-flash, GEMINI_FALLBACK_MODEL=gemini-3.8-flash). A new cloud container will not have it. Ask the owner to add it as an environment secret; never commit it or echo it. The owner will rotate the current key.
- Google returned frequent 429/503 on 2026-10-15; a live extraction can take over a minute. gemini-2.5-flash is not available to this key.
- Commands are in CLAUDE.md ("Verified commands"). Setup in a fresh container: `python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.lock` and `cd frontend && npm ci`.
- Playwright uses preinstalled Chromium at /opt/pw-browsers with @playwright/test 1.56.0; do not run `playwright install`. Headless Chromium cannot render the embedded PDF (D18).
- Next.js rewrite target is fixed at build time; e2e builds into `.next-e2e` with its own backend port 8100.

## New directive from the owner: leadership-grade UX that runs by itself
The owner wants the UX improved for a leadership session, and the demo must be able to run on its own ("travel by itself"). Interpretation to confirm with the owner in one line before building: a self-running guided demo that a leader can open and watch, or click through, without a presenter. Build it as part of Slices 4-7, not as a fake.

Requirements for that experience:
- Guided demo mode: one "Start demo" button that walks the full story from docs/04-acceptance.md (Exception-only on, VIDEO-DEMO-001 arrives, three exceptions shown, recorded decisions, automatic ERP delivery, GTIN mapping saved and activated by administrator, VIDEO-DEMO-002 resolved by memory and auto-delivered, VIDEO-DEMO-003 and revoked rule held, Review-all, safe duplicate retry).
- Each step performs the real API action and waits for real state changes; nothing is scripted to look successful. Narration cards per step tie to the video timestamps and state what is real versus simulated.
- Autoplay with pause, next/back, and a manual mode; a visible step indicator; one-click "Reset demo" to a known state.
- Works with live Gemini; if Gemini is busy, show that honestly with retry/fallback status, and offer a clearly labelled "rehearsal mode" that uses the TEST ADAPTER (never presented as AI).
- Leadership polish: executive summary header (orders received, auto-delivered, held, time saved is NOT claimed), clear mode badge, readable timeline animation, side-by-side PDF with highlighted evidence, plain-language issue cards (issue, printed value, reference, proposed action, who decided), ERP record view showing the actual simulator order ID.
- Laptop and projector friendly; no dense developer tables on the main path; keyboard navigable.
- Add a Playwright test that runs the guided demo end to end in rehearsal mode, capturing screenshots for each step into docs/screenshots/.
- Consider loading the `anthropic-skills:leadership-presentation-design` skill for presentation choices.

## Guardrails (from CLAUDE.md and docs)
Decimal strings for money; separate approval, acknowledgement and delivery states; no second Send click; idempotent delivery with reconciliation; documents are untrusted data; no live Outlook/ERP/marketplace; no secrets in source or logs; fictional labelled data only; do not weaken acceptance checks; report Not run honestly.

## How to work
Keep the task list updated as you execute (owner asked for this). Small slices, test each, commit and push to the branch above, update IMPLEMENTATION_PLAN.md checkboxes, DECISIONS.md and docs/acceptance-results.md each slice.
