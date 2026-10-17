# System of record and integration boundaries (v1.2)

Everything external in this prototype is simulated inside the browser tab: the supplier ERP is the ERP simulator,
the retailer's Trading Grid mailbox is the outbox simulator, and the retailer's response is recorded in the retailer
view. No live ERP, marketplace, Trading Grid, Outlook or retailer system is called.

## Who owns each record

| Record | System of record (proposed production) | Created where in the prototype | Receives updates | Duplicate prevention |
|---|---|---|---|---|
| Inbound purchase order (source) | The email or EDI message as received; Order Operations keeps the copy and its hash | Intake (forward .eml, upload PDF or X12) | Nothing downstream changes the source | SHA-256 per document: an identical file is marked Duplicate and makes no order. Same PO with different content is raised as a possible revision. Body and attachment never both make an order |
| Interpreted order (versions, decisions, approval) | Order Operations | Order workspace | ERP on approval | One current version per order; any change creates a new version and withdraws approval |
| Sales order | Supplier ERP | ERP simulator, on approval (automatic delivery, no second Send click) | Order Operations reads back the ERP order number | Idempotency key per approved version (document hash prefix plus version, for example `3f2a…:v1`); an unknown outcome is reconciled against the ERP before any retry |
| Order acknowledgement (855) | Supplier ERP decides what is confirmed; Trading Grid carries it | Order workspace, Stock and ship date: confirm (or automatically when stock covers the order) | Retailer mailbox (855); ERP gets the schedule when a person decides a shortage | Idempotency key `ORDRSP:<ERP order>`; changes after that go as a separate reply message with its own key, never a second original |
| Advance ship notice (856) | Supplier ERP (shipment) | Order workspace, ASN step (or Mark shipped in ERP) | ERP shipment record and retailer mailbox (856), from one submission | Keys `ERP-SHIPMENT:<ASN>` and `DESADV:<ASN>`; ASN numbers are sequential; one submission writes both |
| Invoice (810) | Supplier ERP (accounts receivable) | Order workspace, invoice step, from the ASN's shipped quantities | ERP invoice record and retailer mailbox (810), from one submission | One invoice per ASN (refused if one exists); keys `ERP-INVOICE:<invoice>` and `INVOIC:<invoice>` |
| Retailer response to a changed confirmation | Retailer system | Retailer view, Command Center: Accept or Decline revision | Command Center verification | One response per confirmation (a second is refused) |
| Command Center finding | Order Operations (derived) | Detected from the records above after every action | Owner assignments only | One open finding per condition key; detection is idempotent |

There is one place to edit each record: the order workspace for orders, confirmations, ASNs and invoices. The
Command Center links to it and does not edit orders. The Trading Grid outbox screen shows messages and retries
delivery; it does not edit their content.

## "Three-way match": what is actually compared

The prototype previously labelled its invoice check a "three-way match". It is not one in the accounts-payable
sense, which compares the purchase order, the buyer's goods receipt and the invoice. This prototype has no goods
receipt: the retailer's receiving is not modelled.

What `threeWayMatch` in `frontend/lib/domain/portal.ts` compares, per line, are three supplier-side records:

1. The PO line as approved (quantity and unit price on the current approved order version).
2. The supplier's own ASN line (shipped quantity).
3. The invoice line being drafted (quantity and unit price).

It refuses an invoice quantity different from the shipped quantity, a price different from the order price, and an
invoiced line that did not ship. Short and over shipments are shown with their reason. The UI and error message are
renamed "Order, ASN and invoice check". A real three-way match would need the retailer's receiving advice (for
example an X12 861 or the retailer's portal data), which is out of scope.

## Integration boundaries

| Boundary | In the prototype | Needed for a pilot |
|---|---|---|
| Email intake | The user forwards or uploads an .eml or file into the browser | A dedicated intake mailbox with approved routing and attachment handling; no forwarding that bypasses security controls |
| AI reading | Server route calls Gemini with the key server-side; untested here (no key in this environment) | Model access, data-processing terms, evaluation on representative documents |
| Supplier ERP | ERP simulator with fail and timeout simulation | ERP edition and connector (or file drop) with an idempotent create and a way to look up by key |
| Trading Grid / retailer EDI | Outbox simulator, X12 855/856/810 built and checked against a partner profile | The retailer's MIG and TP Kit; the MIG checks partner format only, never the retailer's own PO decisions |
| Retailer response | Recorded in the retailer view | The retailer's 855 response handling or portal, agreed per partner |
| Command Center | Reads this app's records | Event feed from the systems of record; no CCIM or CCPM integration is claimed |
