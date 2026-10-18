# Handoff: Trading Grid Portal prototype

For the next Claude Code session. Read this, then CLAUDE.md, docs/01-overview.md and docs/04-acceptance.md.

## Who and why
Owner: Mandip, Lead AI PM at OpenText. Not a coder; make reversible technical choices, record them in DECISIONS.md
and explain them plainly. Direct answers, prose over bullets, no filler. Purpose: a working prototype for leadership
showing how email PDF purchase orders reach a supplier's ERP and come back as standard documents, in the style of the
Procuros Order Agent. Mirakl is a separate prototype; do not touch it here.

## State (18 October 2026, D75)
Branch `claude/portal-unit-retailer`, draft PR #24. One retailer (Maple Retail Group), one supplier (Northern Foods),
two sample POs (milk, cheese). Python backend, Northfield and other fictional retailers, EANCOM/EDIFACT, the
plain-words reply box, order policies and the manual-cost model were removed; they stay in git history (last commit
before the removal: 39c879e). `scripts/verify.sh` passes: 230 Vitest tests, typecheck, build, 11 Playwright tests.

Read first: docs/14-leadership-demo.md (narrative, requirements register, copy review), docs/07-demo-scenario.md,
DECISIONS.md D75, docs/acceptance-results.md.

## Rules the owner set (keep following them)
- One retailer, one supplier, no other name in product data or screens (the unknown buyer Birchwood Test Market exists only in test fixtures).
- ERP-owned values are synced and read-only in the portal.
- No demo-world words in screens: test environment, test controls, order mailbox. Check every screen against the register in docs/14.
- Review screenshots against the requirements, not code in isolation. Apply enterprise product writing to visible strings.
- Update the plan as you execute; do not decide during implementation what should be decided in the plan.

## Not done
Live AI reading was not run (no key in the cloud container). The X12 mapping is untested with a real retailer.
Finding names in `lib/domain/command-center.ts` and the mapping text beside raw EDI are technical and need a pass with
a supplier user. Printed money keeps its thousands separator in stored values ("6,815.00"); checks compare decimals.
An owner walkthrough on a projector is Not run.

## Environment notes
- Gemini key: `frontend/.env.local` (git-ignored) or an environment secret; never commit or echo it.
- Playwright uses the preinstalled Chromium at /opt/pw-browsers (@playwright/test 1.56.0); do not run `playwright install`. Headless Chromium cannot render the embedded PDF page, so the source panel shows "Opening the PDF…" in screenshots.
- Commands are in CLAUDE.md. Fixture generators need `pip install -r tools/requirements.lock`.
