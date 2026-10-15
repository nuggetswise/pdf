# Revised fictional demo scenario

Keep the earlier sample-po.txt as a regression fixture for price, unknown item and unit conversion. Add a video-aligned scenario during setup, using fictional identifiers, not real customer data.

Order VIDEO-DEMO-001, currency CAD, customer DEMO-CUST-01: line A quantity 5 CASE at 24.00 = 120.00, approved MOQ 10 CASE; line B quantity 2 CASE at 26.00 = 52.00, reference price 24.00; line C quantity 1 CASE at 18.00 = 18.00, source GTIN OLD-DEMO-003, proposed supplier mapping to NEW-DEMO-003. These GTIN labels are intentionally fictional non-GS1 identifiers; do not pass them off as valid GTINs. Printed subtotal/total 190.00, tax/shipping 0.00.

Golden resolution: authorised one-off MOQ override for A; authorised acceptance of printed price for B; approved scoped identifier mapping for C. Quantity, price and total remain unchanged at 190.00. No reusable price/MOQ exception is created. Activate only the GTIN mapping with an administrator decision.

Second order VIDEO-DEMO-002: A quantity 10 CASE at 24.00 = 240.00; B quantity 2 CASE at 24.00 = 48.00; C quantity 1 CASE at 18.00 = 18.00 using OLD-DEMO-003. Printed total 306.00. The active mapping resolves C. Under Exception-only policy this order auto-delivers. All records and authorisations are fictional test fixtures, not customer evidence. Generate the PDFs and local .eml envelopes from these values and label them fictional on every page. Check totals with decimal arithmetic.
