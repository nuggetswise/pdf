# Five-step experience

## 1. Forward to the agent
Inbox screen accepts an .eml with a PDF attachment or a local demo envelope and uploaded PDF. Persist the original message, attachment hash and received timestamp. The subject is metadata, not an extraction input or a required order classifier. Read order details from the PDF. Reject unsafe, encrypted, oversized or unreadable input. No live Outlook dependency.

## 2. Process automatically
After receipt, start processing without an Extract button. Show a timeline: Received, Extracting, Matching, Validating, Needs review or Ready, Submitting, ERP created. Read native PDF text and call the configured LLM for typed extraction. Fields include customer, PO, ship-to, dates, currency, GTIN/item references, quantities, units, prices and printed totals. Show source page/text evidence. Unknown fields remain null. No LLM credentials means extraction unavailable; a labelled test adapter can run fixture tests, not impersonate a real extractor.

## 3. Validate business rules
Use supplied versioned customer/product references. MOQ: compare quantity in the rule's unit after any supplied approved conversion; never raise quantity automatically. Price: compare printed price with the applicable supplied customer price; preserve both. Outdated GTIN: show the supplied obsolete identifier and candidate replacement only when a scoped mapping exists. Missing mappings remain unresolved. Also validate customer, ship-to, currency, units, totals and duplicates. AI can explain and propose; exact comparisons are deterministic.

## 4. Review only where required
Exception queue shows issue, original value, expected reference, proposed action, evidence and reason. Side-by-side PDF/order view supports correction, approved override or rejection. MOQ options: request customer correction, record an authorised exception, or enter an explicitly authorised quantity change. A changed quantity/price recalculates derived totals and flags differences from printed totals; original totals remain intact. Never invent customer authorisation. Accepting a replacement GTIN does not imply changing the printed order.

## 5. Submit and reuse safely
Once all blocking issues are resolved and the current version is approved, enqueue ERP delivery automatically. No second mandatory Send button. In Exception-only mode, a clean validated order is system-approved under the active policy and auto-delivered. In Review-all mode, human approval is required for clean orders too. Persist the actual ERP simulator order ID. Failed/unknown outcomes are reconciled with the same idempotency key before retry.

## Learning interaction
After an approved correction, offer Save for future matching orders. Show scope, proposed mapping/rule, version, evidence and approver. Administrator activates it separately. Store candidate, active and revoked states. Apply an active rule only to the matching customer/product/unit/context and show its provenance on the later order. One-off price/MOQ exceptions are not automatically generalised. This is rule/mapping reuse, not model training. Revocation prevents future use. Revalidation is required when source references or policy versions change.

## Screens
Inbox and processing timeline; exception queue; PDF/order review; approved rules and correction history; ERP delivery history and persistent ERP record. Distinguish document processing, approval and delivery states. Manual fallback is labelled and cannot count as successful extraction.
