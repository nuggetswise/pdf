# Acceptance results

Run on 18 October 2026 after D75. Earlier results (Python backend, guided demo, EDIFACT checks) were removed with the code
they described; they stay in git history.

## Command
`scripts/verify.sh` -> VERIFY PASSED
- `cd frontend && npm test` -> 19 files, 230 tests passed (scripted reader; no AI key used)
- `cd frontend && npm run typecheck && npm run build` -> passed
- `cd frontend && npx playwright test` -> 11 passed (supplier story, retailer story, approval modes, notifications, onboarding, intake edge cases, filters, phone width). Screenshots are in docs/screenshots/ (01 to 18) and were opened and read against the requirements register in docs/14-leadership-demo.md.

## Acceptance checks (docs/04-acceptance.md)
Test names are in `frontend/lib/domain/workflow.test.ts` unless stated. "Maple pack" is `lib/maple-pack.test.ts` with the hand-written `fixtures/maple/expected-results.json`; "Test pack" is `lib/test-pack.test.ts`.

| Check | Status | Evidence |
|---|---|---|
| P01 typed fields with evidence | Pass | P01 typed fields with traceable evidence; `maple-po.test.ts` |
| P02 scanned input blocked | Pass | P02 scanned PDF; e2e `intake.spec.ts` (no-text PDF) |
| P03 unknown customer not reassigned | Pass | P03 unknown customer; Test pack TP-04; `onboarding.test.ts` |
| P04 unknown item blocks | Pass | P04 unknown item; Test pack TP-05 |
| P05 price mismatch visible, printed price kept | Pass | the cheese PO has exactly one price issue; Maple pack M-02 |
| P06 EA to CASE with supplied factor | Pass | P06 milk ordered in each; Maple pack M-06 |
| P07 identical file, no second ERP order | Pass | P07 re-uploading an identical file; Maple pack M-07; Test pack TP-07 |
| P08 changed content held as revision | Pass | P08 same customer and PO number; Maple pack M-07 (accepted revision updates the one ERP order) |
| P09 edit after approval invalidates it | Pass | P09 an edit after approval |
| P10 failed delivery, same idempotency key on retry | Pass | P10 a failed delivery retry; Test pack TP-10 |
| P11 timeout reconciles to one ERP order | Pass | P11 a timeout after create; Test pack TP-11 |
| P12 missing currency blocks | Pass | P12 missing currency |
| P13 totals use decimal arithmetic | Pass | P13 and P27 totals; hand-computed totals in `workflow.test.ts` slice 1 |
| P14 audit history | Pass | P23 and P14 approving the final exception; history shown in e2e screenshots 03 to 06 |
| P15 reload preserves records; roles block | Pass | P15 reload; `governance.test.ts`; e2e `approval-modes.spec.ts` (viewer) |
| P16 no key or content in logs or files | Pass | `lib/server/extract.test.ts` (log content check) |
| P17 no credentials means unavailable | Pass | P17 no credentials; `route.test.ts` |
| P18 mailbox intake persists and starts processing | Pass | P18 eml intake; `intake.test.ts` |
| P19 MOQ held, quantity not raised | Pass | P19 a quantity below the minimum; Maple pack M-03 |
| P20 price mismatch keeps printed and reference | Pass | as P05 |
| P21 retired GTIN held; approved mapping traceable | Pass | P21 mapping a retired GTIN; Maple pack M-04 |
| P22 Exception-only: clean order, no approval or Send | Pass | P22 exception-only; Maple pack M-08; e2e `approval-modes.spec.ts` |
| P23 final exception starts delivery | Pass | P23 and P14; Maple pack M-02 |
| P24 Review-all holds clean orders | Pass | P24 a clean order in review-all; Maple pack M-01 |
| P25 saved correction is a candidate until activated | Pass | P25 memory rule lifecycle; Maple pack M-04 |
| P26 later order uses active rule; other buyer or revoked rule does not | Pass | P26 lifecycle; Maple pack M-04 and M-05 |
| P27 changed totals keep printed values | Pass | P09 (recomputed 6,432.00 against printed 6,540.00) |
| P28 subject is metadata only | Pass | P28 subject is metadata only; `intake.test.ts` |

## Claims check (docs/14, requirements register)
| # | Claim | Result |
|---|---|---|
| 1 | One retailer, one supplier in product data and screens | Pass: reference data and screenshots; Birchwood Test Market only in test fixtures |
| 3 | ERP rules read-only | Pass: e2e asserts no input, select or textarea on Rules |
| 5 | Ship notice and invoice are order steps | Pass: e2e creates both from the order and sees the lifecycle bar advance |
| 6 | Tiles clickable | Pass: e2e `intake.spec.ts` |
| 9 | No demo-world wording | Pass by text search of `frontend/app`; the word "forward" remains only in the mailbox explanation |
| 10 | Copy review | Done; two files of technical text left for a user pass (see docs/14) |

## Not run
Live AI reading (no key in this environment); a projector or owner walkthrough; any test against a real mailbox, ERP,
Trading Grid or retailer; an independent X12 validator (the Python EDIFACT validator was removed with EDIFACT).
