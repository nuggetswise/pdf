# Retail Command Center: proposed composition (v1.2)

Status: a thin working slice in the prototype, labelled "Proposed composition" on screen. It reads only this app's
own records (orders, the ERP simulator, the Trading Grid outbox simulator and simulated retailer responses). There
is no connection to CCIM, CCPM or any other OpenText product, and nothing here claims one. Code:
`frontend/lib/domain/command-center.ts` (domain), `frontend/app/CommandCenter.tsx` (screen).

## Loop

**Detect.** After every action the server brings findings up to date from the records (`reconcileFindings`). No AI
is used. One open finding per condition key; running detection twice changes nothing (asserted after every test
pack step). History is kept: detected, changed, condition cleared, assigned, action, verified, reopened.

**Prioritise.** Explicit rules, applied in order, each stating its basis on the finding:
1. High: a deadline the PO itself states falls within 24 hours or has passed.
2. High: the latest ship date (from the PO's dates and configured transit days) is within 2 days.
3. Medium: the condition blocks the order.
4. Low: otherwise ("Waiting on a response; no deadline is established").

**Act.** The suggested action names what to do and where. Open order goes to the order workspace at that section
(stock and ship date, ERP delivery, or retailer documents) and Back to Command Center returns. The authorised action
happens in the order workspace, so there is no second place to edit an order. The Command Center itself only assigns
owners (supplier) and records the retailer's response to a changed confirmation (retailer view).

**Verify.** Each type defines its resolution condition and the evidence required before evaluation. Verification is
separate from action status: an action can be complete while verification is pending. Missing evidence keeps it
pending. Sending is never treated as acceptance.

## Finding types in this slice

| Type | Detected when | Visibility | Resolution condition | Evidence that verifies it |
|---|---|---|---|---|
| Stock short for order (first scenario) | ERP stock check needs a person's decision | Supplier only (rests on ERP stock) | Shipping decision recorded and the order confirmation delivered to the retailer mailbox | Fulfilment decision with person and time; 855 status delivered with a receiver reference |
| Revised delivery awaiting retailer | A delivered confirmation ships less, later or cancels part of the PO | Shared with that retailer | Retailer accepted the revised quantities and dates | Retailer response recorded as accepted. Delivery of the confirmation alone does not resolve it. The supplier sees this as evidence on its Stock short finding, not as a second finding (D69) |
| ERP order not confirmed | ERP delivery failed or its outcome is unknown | Supplier only | The ERP holds an order record for the approved version | ERP order number found for the idempotency key |
| Document not delivered to retailer | A retailer-bound document is held or refused by the outbox | Supplier only | The retailer's mailbox holds the document | Message status delivered with a receiver reference |

Promised-date issues are covered by "Revised delivery" (a confirmation later than the PO's dates) and by the
ship-by priority rule. A standalone late-shipment finding without a confirmation is not built.

## Fields on every finding

Partner, PO and lines; observed issue with its source and time ("Time not recorded" when the record has none); rule
with its source; deadline with its source, or "Not established"; priority with its basis; owner, or "Unassigned";
suggested action; Open order; action history; resolution condition and evidence required; verification status and
evidence. Financial exposure always shows "Not available" and root cause "Not established": neither is computed and
neither is invented. No chargebacks, OTIF impact or deadlines are inferred.

## Ownership

Settings, Ownership sets a default owner per finding type and for order review issues (Rita, order desk; Alex,
operations lead; or Unassigned). A reviewer or administrator can assign each finding; a shared finding may also be
assigned to the retailer buyer. A viewer cannot assign (403).

## Permissions

| Viewer | Sees | Never sees |
|---|---|---|
| Supplier reviewer or administrator | All findings | |
| Supplier viewer | All findings, read-only | Assignment controls |
| Retailer (Viewing as one retailer) | Shared findings and documents for its own orders; Accept or Decline revision | Supplier stock, ERP delivery and outbox problems, costs, other retailers' orders and findings |

Enforced in the domain, not only on screen: `retailerFindings` filters by visibility and customer, and
`respondToRevision` refuses another retailer (Forbidden, 403). Because the run is one browser tab with demo
identities, this demonstrates the permission model; it is not access control between real users.

## AI boundary

AI does not detect, rank, declare a root cause, edit records or declare resolution. Findings never quote AI output
as fact; observed evidence comes from ERP stock, delivery attempts, outbox messages and retailer responses.

## Journey verified in the browser

e2e/command-center.spec.ts: upload the stock-short PO through normal intake, approve, open Command Center, see the
high-priority finding with the PO's own deadline note, Unassigned, Not available and Not established; assign Rita;
Open order; ship now and backorder; Back to Command Center; the stock finding shows Verified with its evidence and
the revised delivery waits for the retailer; switch to Retailer, Viewing as MAPLE-01 shows only the revised delivery;
Accept revision; Verified. Screenshots app-21 to app-23.

## Not built (proposed next)

Late shipment against the ship-by date without a confirmation; invoice disputes; finding trends per partner (UC-23);
notifications; time-to-verify metrics on screen (exported in the pilot CSV instead); real multi-user ownership.
