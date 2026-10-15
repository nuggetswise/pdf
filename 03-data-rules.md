# Data and rules

Entities: SourceDocument; ExtractedOrderVersion; OrderLine; Customer; ShipTo; Product; CustomerProductAlias; UnitConversion; ReferencePrice; ValidationIssue; ReviewDecision; DeliveryAttempt; MockERPOrder; AuditEvent.

Canonical order fields: schema_version, source_document_id, reviewed_version, customer_id, po_number, currency, order_date, requested_delivery_date, ship_to_id, lines and totals. Each line has source_line_id, supplier_sku, customer_item_code, quantity, unit, unit_price, line_amount and evidence. Represent monetary JSON values as decimal strings; do not use binary floats. Dates missing from source remain null.

Proposed local application interfaces, not vendor APIs: upload document; get processing status; get review version; save correction; resolve issue; approve version; deliver approved order; query delivery outcome; get audit; import master data. Claude chooses routes and records them in the README.

Document hashes detect identical files. Customer + PO number + reviewed version identifies revisions. A revised PO is held for review, not silently treated as a new order. Delivery idempotency uses the approved version, not an attempt identifier. A duplicate retry returns the existing ERP order.

Conversions require a supplied approved factor and unit direction. Preserve original quantity/unit and derived quantity/unit. Do not infer pack size. Reference price differences flag an issue; do not overwrite the printed price automatically. Tax and shipping amounts are source values, not inferred rates. Verify printed totals with decimal arithmetic and a documented rounding rule.

Default prototype policy: unknown customer, item, ship-to, required currency, quantity, unit, conversion, MOQ violation or total inconsistency blocks approval. A price mismatch requires a recorded authorised decision. These policies are proposed defaults, not Procuros's internal policy.

The supplied sample is fictional and explicitly labelled. It includes an unknown item, price mismatch and unit conversion. A full clean pass requires the stated operator resolutions. No source file may contain real customer data.

## Additional contracts and invariants
EmailEnvelope: message_id, sender, received_at, subject_metadata, attachment_ids and intake_mode. AutomationPolicy: mode, version, approver and effective time. MOQRule: customer/product scope, minimum, unit and version. GTINMapping: obsolete identifier, approved replacement, scope, version and active state. CorrectionRule: candidate/active/revoked, scope, source correction, approver and expiry if supplied.
Approval records either the human actor or system policy/version; both bind to the exact reviewed version. Editing after approval invalidates it. A previously delivered order is never silently overwritten; amendments are held for a separately recorded decision. New rule activation affects future eligible orders, not prior ERP records.
