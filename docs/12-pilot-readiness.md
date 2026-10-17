# Pilot readiness checklist: a UK retailer such as Morrisons (v1.2)

Nothing in this prototype has been verified against Morrisons systems, documents or rules. No Morrisons
compatibility is claimed. The product today is scoped to USD, North America and X12 (project decision of 16 October
2026); a UK pilot needs the decisions below first. Each item names what must be established and who owns it. Every
box is open.

## Order and response routes
- [ ] Which suppliers send which orders by email body, PDF attachment, spreadsheet or the retailer's portal; sample of real messages per route (permissioned).
- [ ] How the retailer expects acknowledgements, ship notices and invoices back: EDI standard and version (EANCOM, Tradacoms or the retailer's own), web portal, or both.
- [ ] Whether the retailer accepts a changed confirmation (short or late) and how it responds; what counts as acceptance.
- [ ] The retailer's MIG and TP Kit for each message, used for partner format only.

## Supplier ERP editions
- [ ] Each pilot supplier's ERP product and edition, and how an order can be created: API, file import or manual entry.
- [ ] Whether the ERP supports lookup by an external idempotency key, so an unknown outcome can be reconciled before retry.
- [ ] Where stock, lead times and incoming deliveries are read from.

## Currency, dates and tax
- [ ] GBP amounts and rounding rules; VAT treatment on invoices (the prototype supports a single sales-tax or VAT rate per line).
- [ ] Date format on real documents (day-first is expected in the UK). The prototype never assumes month-first and asks a person when a date reads two ways; confirm this holds on the samples.
- [ ] Delivery slot and booking rules that change a promised date.

## Reference data
- [ ] Retailer and supplier GLNs, depot and store codes, and the retailer's item codes against supplier SKUs and GTINs.
- [ ] Agreed prices and minimum order quantities per retailer, with versions.
- [ ] Who maintains each table and how changes are approved.

## Permissions
- [ ] Who at the supplier can approve orders, switch a route to automatic, assign findings and see stock and costs.
- [ ] What the retailer may see: shared findings and documents for its own orders only; never supplier stock, costs or other customers.
- [ ] Real authentication. The prototype uses demo identities in one browser tab.

## Support ownership
- [ ] Who monitors the intake mailbox, the ERP connector and the outbox; hours of cover.
- [ ] Escalation path for ERP failures and unknown outcomes.
- [ ] Owners per Command Center finding type.

## Commercial responsibility
- [ ] Who pays for the service (retailer programme or supplier).
- [ ] Liability when a misread order reaches the ERP; supervised operation per route until evidence supports automatic.
- [ ] Data-processing terms for AI reading of supplier and retailer documents.

## Outcome evidence
- [ ] A baseline before the pilot: current time from email to ERP entry, error rate, and retailer compliance outcomes. No saving is claimed without it.
- [ ] Pilot measurements from the export (one row per order): route, supervision mode, minutes from receipt to checked, minutes waiting for a person (elapsed, not effort), values changed by a person, exception reasons, ERP attempts, confirmed outcome, findings with detection time, owner, action, verification and pending count.
- [ ] Retailer-side evidence: acknowledgements and ship notices accepted, chargebacks before and after (from the retailer's own records; the prototype does not compute chargebacks).
- [ ] Supplier interviews confirming the route is less work than today.

## Before supplier referrals
Referrals need, at minimum: live AI reading verified on the supplier's real documents with the error cases recorded;
one ERP edition connected with idempotent create and lookup; the retailer's response route agreed; a baseline; and a
supervised period with its measurements reviewed.
