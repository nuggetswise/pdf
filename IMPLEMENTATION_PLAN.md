# Implementation Plan: PDF Order Agent (leadership demo prototype)

Status: Slices 1-7 complete (2026-10-15). Live Gemini run during the guided demo still pending a key in the cloud environment. Requirements source: Markdown docs (v3.0, identical to functional-specification.docx).
Goal: a working, honest prototype that shows leadership how the forwarded-email/PDF order use case is achieved end to end, aligned to the reference video (0:19 to 1:10).

## Video-to-demo map

| Video moment | What leadership sees in our app | Acceptance checks |
|---|---|---|
| 0:19-0:31 Automated extraction and entry | Forwarded .eml arrives in the local inbox; timeline runs Received > Extracting > Matching with PDF evidence beside each field | P01, P17, P18, P28 |
| 0:34-0:38 Business rule validation | Validating step runs deterministic checks against versioned reference data | P03, P04, P06, P12, P13 |
| 0:36-0:44 MOQ check | Line A held: 5 CASE vs minimum 10 CASE; quantity never raised | P19 |
| 0:45-0:53 Price verification | Line B held: printed 26.00 vs reference 24.00; both preserved | P05, P20 |
| 0:54-1:04 Outdated GTIN | Line C held: OLD-DEMO-003 with proposed NEW-DEMO-003 | P21 |
| 1:05-1:10 Learning from corrections | Correction saved to agent memory as a candidate; administrator activates; second order is fixed automatically with provenance shown | P25, P26 |
| (beyond video) Delivery | Approval of the last exception delivers to the ERP simulator with no Send click; clean orders auto-deliver in Exception-only mode | P22, P23, P24 |

## Stack (reversible, see DECISIONS.md)
Python 3.13 + FastAPI + Pydantic backend, SQLite file storage, Next.js + TypeScript UI, pytest and Playwright for tests. Extraction through a provider-neutral interface with a Gemini adapter (key supplied later) and a labelled test adapter used only by automated tests.

---

## Slice 1: Housekeeping, fixtures and skeleton
Outcome: correct folder layout, complete fictional demo data, and an app that starts.

Tasks
- [x] Move docs into `docs/` and data files into `fixtures/` so CLAUDE.md paths resolve
- [x] Add a version line (v3.0) to `docs/01-overview.md`
- [x] Create `fixtures/reference-data.v1.json`: customers DEMO-CUST-01 and DEMO-CUST-02 (second fictional customer), ship-tos, currency, products, aliases, unit conversions, reference prices, MOQ rule (product A, 10 CASE), obsolete identifier OLD-DEMO-003, all versioned
- [x] Keep `master-data.json` + `sample-po.txt` + `golden-expected.json` unchanged as the regression set
- [x] Give video demo line A reference price 24.00 so VIDEO-DEMO-001 yields exactly three exceptions
- [x] Add ship-to and dates to VIDEO-DEMO-002 so it can be clean
- [x] Add VIDEO-DEMO-003 for DEMO-CUST-02 using OLD-DEMO-003 (nonmatching-customer case)
- [x] Script that generates fictional PDFs and .eml envelopes, "FICTIONAL TEST DATA" on every page
- [x] Golden expected files for each demo order (decimal strings)
- [x] Backend and frontend skeletons, `.env.example` (blank), `.gitignore` excluding `.env`, databases and uploads
- [x] Record every fixture change in DECISIONS.md

Checklist (done when)
- [x] Backend health endpoint and UI shell start locally
- [x] Generated PDFs open and contain native text
- [x] Fixture totals verified with Decimal in a test
- [x] No secret or real customer data in any committed file

## Slice 2: Email intake and automatic extraction
Outcome: dropping an email into the inbox starts processing with no further clicks.

Tasks
- [x] Data model: EmailEnvelope, SourceDocument (SHA-256 hash), ExtractedOrderVersion, OrderLine, AuditEvent
- [x] Intake routes: import .eml; demo envelope + uploaded PDF (secondary path)
- [x] Input safety: size limit, PDF type check by content, encrypted/unreadable rejection, safe filenames
- [x] Subject stored as metadata only, never used for fields
- [x] Background job runs automatically after intake
- [x] Native PDF text extraction with page references
- [x] Extractor interface; Gemini adapter (model name configurable, server-side key); labelled test adapter for fixtures
- [x] No key: status "Extraction unavailable", never simulated as real
- [x] Scans/no text: explicit "Unsupported, no OCR adapter configured" state
- [x] Typed output with per-field evidence; unknown fields null
- [x] Prompt hardening: document text treated as data, schema-constrained output
- [x] Redacted logging

Checklist
- [x] P01, P02, P16, P17, P18, P28 tests pass
- [x] Restart keeps envelopes and documents (part of P15)

## Slice 3: Matching and business rule validation
Outcome: every order receives deterministic issues with evidence.

Tasks
- [x] Reference data import route with versions
- [x] Customer and ship-to matching; unknown blocks (never reassigned)
- [x] Item matching via customer alias and GTIN
- [x] Unit conversion only with supplied factor; preserve original and derived quantity/unit
- [x] MOQ check in rule unit; quantity never changed
- [x] Price check against customer reference; both values preserved
- [x] Outdated GTIN check; replacement shown only when a scoped mapping exists
- [x] Currency, totals (Decimal, documented ROUND_HALF_UP to 2 places), tax/shipping as source values
- [x] Duplicate detection by hash; revision detection by customer + PO
- [x] Policy table marking which issues block approval

Checklist
- [x] P03, P04, P05, P06, P08, P12, P13, P19, P20, P21 tests pass
- [x] sample-po.txt regression produces exactly the three golden issues
- [x] VIDEO-DEMO-001 produces exactly MOQ, price and GTIN issues

## Slice 4: Exception review and approval modes
Outcome: a reviewer clears exceptions with recorded decisions; modes behave as specified.

Tasks
- [x] Demo roles (Reviewer, Administrator) with a visible "demo-only authentication" label
- [x] AutomationPolicy: Review-all default; Exception-only enabled by Administrator only; mode badge on every screen
- [x] Exception queue: issue, original value, expected reference, proposed action, evidence, reason
- [x] Side-by-side PDF and order view
- [x] Decisions: MOQ (request correction, authorised one-off exception, authorised quantity change); price (accept printed with reason, or correct); GTIN (apply mapping; printed value preserved); reject order
- [x] Each decision records actor, time, reason; creates a new order version
- [x] Recalculate derived totals on edits; printed totals stay intact and differences flagged
- [x] Approval binds to exact version; any edit invalidates it
- [x] System approval under Exception-only policy for clean orders, recording policy and version

Checklist
- [x] P09, P14 (corrections and approval), P15 role checks, P24, P27 tests pass
- [x] Reviewer cannot change mode or activate rules

## Slice 5: ERP simulator and automatic delivery
Outcome: approved orders reach a persistent simulated ERP exactly once.

Tasks
- [x] Mock ERP with its own persistent tables and order IDs
- [x] Auto-enqueue delivery on final approval (no Send button)
- [x] Idempotency key = approved version; duplicate returns existing ERP order
- [x] Simulated failure and timeout-after-create modes (demo toggles)
- [x] Reconciliation query before any retry
- [x] Delivery states kept separate from approval states: Queued, Submitting, ERP created, Failed, Unknown
- [x] Amendments to delivered orders held for a separate decision
- [x] Delivery history and ERP record screens

Checklist
- [x] P07, P10, P11, P14 (delivery), P22, P23 tests pass
- [x] Restart mid-delivery recovers without duplicates

## Slice 6: Agent memory (reusable approved corrections)
Outcome: the video's learning moment, done with an approval gate.

Tasks
- [x] "Save for future matching orders" after an approved correction
- [x] CorrectionRule / GTINMapping with candidate, active, revoked states, scope, version, evidence, approver
- [x] Administrator activation and revocation screens
- [x] Apply only active rules matching customer/product/unit; show provenance ("Resolved by memory rule #N, approved by ...")
- [x] One-off MOQ and price exceptions never offered as reusable by default
- [x] Revalidation flag when reference or policy versions change
- [x] Activation affects future orders only

Checklist
- [x] P25, P26 tests pass
- [x] VIDEO-DEMO-002 auto-delivers in Exception-only mode via the active rule
- [x] VIDEO-DEMO-003 (other customer) and post-revocation orders stay held

## Slice 7: Demo polish, verification and handoff
Outcome: a rehearsable five-minute demo and honest evidence.

Tasks
- [x] One-click "Reset demo" (Administrator) restoring a known state
- [x] "Forward to agent" demo action that imports a local .eml, clearly labelled as local
- [x] Animated processing timeline; empty, loading, blocked, failed, success states
- [x] Product-grade styling for inbox, queue, review, memory, ERP screens
- [x] Playwright end-to-end test of the full demo script in docs/04-acceptance.md
- [x] Single verify command (backend tests, frontend checks, build, e2e)
- [x] Screenshots of each demo step
- [x] `docs/acceptance-results.md` with exact commands and results, Not run where applicable
- [x] README: plain-language start, configuration (Gemini key), routes, import formats, limitations
- [x] Demo script for the presenter with talking points mapped to video timestamps
- [x] Add verified commands to CLAUDE.md

Checklist
- [x] Verify command passes
- [x] Full demo rehearsed with the test adapter; rehearsed again with Gemini once the key arrives
- [x] All 28 acceptance checks reported with evidence

## Open inputs and risks
- Gemini key supplied for development and stored only in the git-ignored .env. Owner will rotate it and add the production key as a cloud environment secret.
- Demo risk: on 2026-10-15 Google returned frequent 429/503 overload errors; one live extraction took about 85 seconds via the fallback model. Slice 7 must include a rehearsal check shortly before the leadership demo.

## Leadership guided demo (added from HANDOFF.md)
- [x] Click-through guided demo (owner confirmed: click through without a presenter), 15 steps, each a real API action with a real state check
- [x] Narration cards with video timestamps and Real / Simulated statements
- [x] Next/Back, Play/Pause autoplay, step indicator, keyboard (arrows, space), one-click reset on start
- [x] Live Gemini start when a key exists; honest busy/failed handling with Retry or switch to rehearsal mode
- [x] Rehearsal mode uses the TEST ADAPTER and is labelled "not AI" everywhere
- [x] Executive summary tiles (no time-saved claim), mode badge, animated timeline, evidence highlighted in PDF text, plain-language issue cards, ERP record with simulator order ID
- [x] Playwright test runs the full demo and saves one screenshot per step to docs/screenshots/

## Vercel rebuild (plan: https://claude.ai/code/artifact/612c2257-983e-4bf9-8830-cfcda7975be0)
One Next.js app on Vercel, run state held in the browser tab, stateless server. FastAPI keeps serving the demo until rebuild slice 5.

Rebuild slice 1: scaffold and RunState schema
- [x] Add decimal.js, zod, postal-mime, pdfjs-dist and Vitest to frontend/ (exact versions)
- [x] Define RunState in frontend/lib/domain/run-state.ts, one array per SQLite table
- [x] Export the SQLite state of a full guided-demo run (scripts/export_run_state.py) and commit it as a test fixture
- [x] Vitest: the export parses unchanged; JSON-number money, malformed decimals, unknown fields and unknown states are rejected
- [x] Vitest added to scripts/verify.sh

Rebuild slice 2: pure domain port with Python parity
- [x] money.ts: exact decimal that behaves like Python's decimal module (28 digits, kept exponents, half-even context, half-up cents)
- [x] normalise.ts and validation.ts, with POLICY and TITLES copied verbatim
- [x] pyjson.ts: Python json.dumps output, used for issue fingerprints and the parity check
- [x] scripts/validation_parity.py records Python output for every fixture, the regression sample and edge cases (all 17 issue codes)
- [x] Vitest compares TypeScript output with Python byte for byte; verify.sh fails if the Python side is stale
- [x] Guard test: no Number(), parseFloat, toFixed or Math.round in lib/domain

Remaining rebuild slices: 3 workflow port, 4 browser intake and Gemini route, 5 UI switch-over (Playwright parity gate), 6 Vercel deploy, 7 retire Python.
