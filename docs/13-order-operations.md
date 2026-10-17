# Order Operations upgrade (D71, 2026-10-17)

Built on branch `claude/order-ops-upgrade-an6w93`, on top of the v1.2 work (`claude/project-thread-qjo9d5`, unmerged at the time). Everything below is fictional data and a simulated ERP.

## 1. Assessment of the prototype before this change

**Foundation.** One Next.js 16 app (`frontend/`), React 19, TypeScript, zod-validated `RunState` held in sessionStorage per browser tab, a stateless server that only runs checks and the Gemini call. Styling is one global stylesheet with OpenText colour tokens (`app/globals.css`). Icons from lucide-react. Tests: Vitest for `lib/` (520 tests before this change) and Playwright for the screens (16 tests), all on the labelled test adapter.

**Routes and screens.** A single page with a Supplier/Retailer toggle and side navigation: Today (forward box, flow ribbon, "Needs you", "Handled by the agent"), Orders (intake list plus the full order workspace), Command Center (proposed composition, findings on stock and revised dates), Agent memory, ERP records, Trading Grid outbox, Settings; retailer side: Documents received, Suppliers, Command Center.

**Order model and email/PDF handling.** Real intake of .eml, PDF and X12 850; PDF text and page images; extraction by Gemini or the test adapter; matching and validation ported from the Python prototype (`lib/domain/workflow.ts`, `validation.ts`, `checks.ts`). Issues carry codes, printed and reference values, evidence and allowed actions. Decisions are append-only and create new order versions. Delivery to the ERP simulator is idempotent with reconciliation. A rich value-box PDF page view exists for real PDFs.

**Exception handling.** Strong for the video's MOQ, price and GTIN cases, but every issue is "blocking" and the screen presents all issue types the same way. There is no explicit distinction between a recommendation, a genuine ambiguity and a blocked order. Decisions cannot be undone. The ERP simulator only fails technically (`fail_next`, `timeout_next`); it never rejects an order for a business reason.

**Command Center.** Exists as a proposed composition with findings, ownership and verification. Findings deep-link to the order workspace.

**Accessibility and responsive.** Visible focus, labelled controls and semantic tabs are present. The shell collapses at 900 px. Dense order screens overflow at phone width.

## 2. Gap analysis against the brief

| Requirement | Status before | What was done |
|---|---|---|
| Home starts with operational state and attention first | Present but weak (Today had a flow ribbon and two lists, no counts by state) | Replaced by Order operations home |
| Order states (processed, recommendation, judgement, blocked, downstream rejection) | Missing as explicit states | Added `OrderState` and `IssueType` |
| Recommendation with original → proposed, accept, keep original | Present but weak (actions per issue code; no "keep original" with recorded consequence) | Added |
| Genuine ambiguity with comparison and no automatic answer | Missing (unknown item offered every product) | Added |
| Blocked with honest unresolved state and no AI fix | Present but weak | Added, with defer and buyer-confirmed correction |
| Downstream rejection distinct from extraction or validation | Missing | Added deterministic ERP business rules |
| Field-level states (accepted, changed, uncertain, missing, invalid) | Missing | Added |
| Reverse a decision before final processing | Missing | Added undo |
| Source-versus-structured layout with highlight | Present for real PDFs (value boxes), weak for linkage to issues | Added for Order Operations, with "Show in source" |
| History distinguishing system, AI, person, ERP | Present but weak (raw event names) | Added business-readable history with actor labels |
| Command Center deep-links into the review | Present for findings | Added order exceptions list with deep links |
| Deterministic fixtures for six scenarios | Missing (one example PO and test pack) | Added an 18-order sample inbox |
| Confidence scores | Not used | Kept out |
| Narrow-width use | Weak | Review stacks with the decision first; tested at 390 px |

Conflicting: the brief's "home view" overlaps the existing Today screen. Today was replaced; its forward box moved to the home side panel. Unclear: whether sample orders should mix with orders forwarded in the session. Decision: one queue for both (see D71).

## 3. Change plan as implemented

Retained: the whole intake, validation, approval, ERP, portal, EDI, Command Center and settings code; the shell, toggle and design tokens; every existing test (updated only where a label or the home screen changed).

Modified: `app/page.tsx` (new default view "Order operations", Today removed, Orders renamed "Intake", Command Center shows order exceptions first), `app/LiveView.tsx` (Today removed; its state text is now `supplierState`, reused by the home queue), `app/globals.css` (new styles), ten Playwright specs (tab names and the home queue's row locator).

Added: `lib/domain/ops/` (types, fictional reference data with a separate ERP master, the sample inbox, the engine and its tests), `app/ops/OpsProvider.tsx` (tab storage and actions), `app/OrderOps.tsx` (home, review, source panel, history, ERP panel, Command Center list), `e2e/order-ops.spec.ts`.

Removed: the Today screen, its flow ribbon and its KPI tiles.

Migration risk: the new state lives under its own sessionStorage key (`order-ops-v1`) and never enters `RunState`, so saved runs, the Python parity fixtures and the server action contract are unchanged.

## 4. State model

Order: `received → understanding → validating → needs_review | blocked | ready_to_send → sending → accepted | rejected`. "Processed automatically" is `accepted` with no human decision. `rejected` is entered only from an ERP response; a correction returns the order to `ready_to_send`.

Issue types: `correctable_discrepancy`, `ambiguous_match`, `missing_required_data`, `validation_failure`, `downstream_rejection`. Severity is `blocking` or `warning` (a kept printed price becomes a resolved warning).

Decisions: `accepted_recommendation`, `rejected_recommendation`, `selected_option`, `corrected_value`, `deferred`. Each decision bumps the order version, clears approval, reruns validation and writes history. Undo is allowed until an ERP submission happens after the decision.

Field states: `accepted`, `changed`, `uncertain`, `missing`, `invalid`, computed from the decisions and open issues, never from display text.

Behaviour: sufficient evidence → sent automatically; correctable discrepancy → recommendation; material ambiguity → a person chooses; missing critical information → blocked. An order a person changed needs one approval, which sends it ("Approve and send to ERP"); there is no second send step.

ERP lifecycle: Ready → Sending → Response received → Accepted or Rejected, with an idempotency key per order version. A repeated key returns the earlier response and creates no second order.

## 5. Sample scenarios (fictional supplier Northwind Beverage Co.)

| Scenario | Order | What happens |
|---|---|---|
| 1 Straight-through | 13 orders, e.g. HV-88190 | Matched, validated, sent, accepted; no person |
| 2 Recommended correction | SG-55120 | 24 CASE on an item sold only by the tray (EA); printed price equals the EA price and the buyer used EA on 6 orders; proposal CASE → EA |
| 3 Genuine ambiguity | HV-88213 | "Fizz Zero 24 Pack" fits 330 mL and 500 mL items equally; no proposal |
| 4 Blocked | PF-7731 | No ship-to on the PDF or in the email; two locations on file; no proposal; defer or enter a buyer-confirmed location |
| 5 Downstream rejection | SG-55134 | Passes the agent's checks; the ERP rejects ship-to SG-DC14 (retired in the ERP); recommendation SG-DC14N at the same address; correct and resend |
| 6 Rejected recommendation | LF-20419 | Printed 18.75, price list 18.50 since Oct 1; keeping 18.75 is recorded, the issue becomes a warning, the ERP accepts at 18.75 |

The proportions (13 automatic, 3 review, 1 blocked, 1 rejected) are a fictional sample, not a production rate.

## 6. Tests

Vitest `lib/domain/ops/engine.test.ts` (17): seeded counts and determinism, straight-through trail, each scenario's state and issue type, accept, reject, undo and no-undo-after-send, ambiguity cannot continue without a selection, blocked cannot be sent, defer and confirmed correction, ERP correction and retry, kept price recorded and sent, unique ERP orders.

Playwright `e2e/order-ops.spec.ts` (11): home counts and ordering; one journey per scenario including undo; evidence disclosure and PDF highlight; PDF and email switch; actor labels in history; simulated ERP label; Command Center deep link and return; 390 px layout keeps the decision above the source with no horizontal scroll. Screenshots go to `docs/screenshots/ops-*.png`.

## 7. Capability boundaries

Working prototype capability: the order engine, states, decisions, undo, validation rerun, history, queue counts, Command Center deep link, and for forwarded files the existing intake and reading pipeline.

Simulated: the accept-or-reject decision of the downstream ERP, which belongs to the supplier's own ERP (for example an inactive ship-to in its customer master); the Order Agent records the response, explains it, proposes a correction from the ERP's own data and resends. This assumes an ERP connection that returns errors; no Trading Grid capability is claimed. Also simulated: the sample inbox's reading step (the sample POs are structured fixtures, rendered as a document; no OCR or AI runs on them), the AI recommendation text (generated by deterministic rules from reference data and order history, shown under "Order agent (AI)"), and the downstream ERP (deterministic rules over a fictional customer master).

Proposed future capability: running the same recommendation and ambiguity rules on live-read orders from the existing pipeline, a real mailbox connection, ERP adapters, and recommendation wording from a model with the same evidence constraints.

## 8. Limitations

The two order engines (forwarded files and the sample inbox) share one queue and one review layout (D72) but not one data model: undo and the AI recommendation text exist only for the sample inbox, and forwarded orders keep their own issue types, mapped to the five review types. Sample timestamps are relative to when the tab first opens. Only the delivery location can be corrected by hand. The live AI reading of real files is still unverified in this environment (no key).

## 9. Follow-up (D72)

Forwarded and uploaded orders open in the same review (`app/ForwardedReview.tsx`). Every screen fits a 390 px phone, measured by a browser test. The ERP panel names your ERP as the one that accepts or rejects, and the Order Agent as the one that sends, records the response and proposes the correction.
