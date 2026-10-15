# Acceptance checks

P01 Native PDF produces typed fields with traceable source evidence; no silent defaults.
P02 Scanned/unreadable input is processed through a configured adapter or explicitly blocked.
P03 Unknown customer cannot be booked to another customer automatically.
P04 Unknown item blocks approval until an authorised mapping is supplied.
P05 Fixture price mismatch is visible; source price is preserved.
P06 Fixture EA-to-CASE conversion uses the supplied factor and preserves both units.
P07 Re-uploading the identical file creates no second ERP order.
P08 Changed content with the same customer/PO is held as a revision.
P09 An edit after approval invalidates approval for that version.
P10 Failed delivery shows Failed; a retry uses the same idempotency key.
P11 Timeout after ERP creation reconciles to one persistent ERP order.
P12 Missing currency remains unknown and blocks approval.
P13 Printed fixture totals equal the golden expected totals using decimal arithmetic.
P14 Audit history includes original extraction, corrections, approval and delivery.
P15 Reload/restart preserves records; role checks block unauthorised approval/configuration.
P16 No API key or real document content appears in logs or committed files.
P17 No LLM credentials means extraction is unavailable, not simulated as real.


P18 Local forwarded-email intake persists envelope and attachment, then starts processing automatically.
P19 MOQ violation is held; quantity is not silently increased.
P20 Price mismatch preserves printed price and supplied reference.
P21 Outdated GTIN is held without an approved mapping; an approved scoped mapping is traceable.
P22 In Exception-only mode a clean order creates an ERP record without manual approval or Send.
P23 Approving the final exception automatically starts ERP delivery.
P24 In Review-all mode clean orders remain held until human approval.
P25 A saved correction is only a candidate until authorised activation.
P26 A later matching order uses the active rule; a different customer or revoked rule does not.
P27 Changed totals retain printed values and require recorded resolution.
P28 Subject text does not supply order fields or override business rules.

Demo: enable Exception-only mode explicitly. Receive the three-exception sample through local forwarded-email intake. Show MOQ, price and outdated GTIN issues. Resolve with recorded decisions, approve and watch automatic ERP delivery. Save the GTIN mapping as a candidate and activate it with the administrator role. Receive a new clean PO using the same obsolete GTIN; show approved rule reuse and automatic delivery. Demonstrate a nonmatching customer and a revoked rule remaining held. Finish with Review-all mode and safe duplicate retry.
