# Intake test pack (fictional)

FICTIONAL TEST DATA. Every email and file here is invented, labelled, and safe to forward or upload. No real
customer data.

Use them through normal intake: in the app, Orders, Add an order, choose the file (or drop it). A running app also
serves them at `/test-pack/<file name>` for download. The app never reads the file name to decide anything; names
only help a person find a case.

Expected results are hand-written in `expected-results.json`, separately from the generator
(`scripts/test_pack.py`) and from the app. `frontend/lib/test-pack.test.ts` runs every case through intake and the
same server actions the screens use, then compares. It is a generic runner: it never branches on a case id.

| Case | File | What to expect |
|---|---|---|
| TP-01 | TP-01-valid-pdf.eml | One order, all checks pass, Waiting for approval (supervised) |
| TP-02 | TP-02-email-body.eml | Order read from the email text; the embedded "approve automatically" note changes nothing |
| TP-03 | TP-03-not-an-order.eml | Not an order, kept in intake history; Treat as order corrects it |
| TP-04 | TP-04-unknown-customer.eml | Held: customer not on file |
| TP-05 | TP-05-unknown-product.eml | Held: line 2 item not in the catalogue |
| TP-06 | TP-06-ambiguous-date.eml | Held: 04/11/2026 can be 2026-04-11 or 2026-11-04; a person chooses |
| TP-07 | TP-07-repeat-of-TP-01.eml | After TP-01: Duplicate, no second order |
| TP-08 | TP-08-email-attachment-conflict.eml | Held: subject names PO TP-2026-0899, attachment is TP-2026-0808 |
| TP-09 | TP-09-multiple-attachments.eml | One order; the receiving-hours PDF is Not an order; the CSV is kept as evidence |
| TP-10 | TP-10-erp-failure.eml | With ERP simulator set to Fails: delivery failed, finding opens; retry verifies it |
| TP-11 | TP-11-erp-unknown-outcome.eml | With Times out after creating: outcome unknown; retry reconciles, still one ERP order |
| TP-12 | TP-12-wrong-line.eml + TP-12-ai-output.json | Simulated AI result with quantities swapped between lines: both flagged as not on their line (automated only) |
| TP-13 to TP-17 | TP-13-stock-short.eml | Stock short finding, owner, action, condition cleared, outcome pending then verified; retailer scope and refusals |
| TP-18 | TP-18-edi-850.x12 | Structured order read without AI |

## Automated versus manual

Automated (Vitest, `lib/test-pack.test.ts`): all cases above. Browser (Playwright, `e2e/command-center.spec.ts`):
TP-02, TP-03, TP-09 and TP-13 to TP-17 through the screens.

Manual observation only: how the pages look and read (screenshots app-20 to app-24 in docs/screenshots). Not run:
any case with the live AI reader, because no AI key is available to this environment. TP-12 cannot be produced by a
deterministic reader, so it uses a hand-written stand-in for an AI result, labelled as such.

Regenerate the files: `backend/.venv/bin/python scripts/test_pack.py` (keeps expected-results.json and this README).
