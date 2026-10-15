# PDF Order Agent: exception-first working app

Version 3.0 (matches docs/functional-specification.docx).

## Outcome and primary flow
Forwarded email with PDF order -> automatic extraction and matching -> business-rule validation -> clean order automatically submitted to ERP; exceptions held for review -> approve correction -> automatic ERP submission -> approved reusable correction applied to a later matching order.

## Evidence boundary
The user supplied the video walkthrough and timestamps. Official Procuros documentation independently confirms forwarding PDF order emails, extraction, matching, configured business rules, review holds and ERP delivery. It also describes a manual-review onboarding phase before straight-through processing. It does not establish autonomous model retraining from every correction. Our learning design below is explicit, approved reusable rules, not a claim about Procuros internals.

## Prototype intake versus real forwarding
Keep Outlook integration out of scope as previously requested. Reproduce the forwarded-email experience using a local demo inbox: import an .eml file with a PDF attachment or use a clearly labelled demo email envelope plus an uploaded PDF. Show sender, received time, message identifier and attachment. The local intake adapter must actually persist and enqueue the message. A Forward to agent demo action must not claim an email was sent over the internet. PDF-only upload remains a secondary intake path, not the primary narrative. Live email receipt is a future separately authorised adapter; no forwarding rules are changed by this package.

## Automation modes
Default safe mode: Review all, with every order held before ERP delivery. Demonstration mode: Exception-only, enabled explicitly by the administrator, with clean orders auto-submitted. Both modes must work. Exceptions never bypass their required review. Show the active mode prominently.

## Scope
PDF purchase orders, matching, MOQ/price/outdated GTIN rules, correction review, reusable approved rules and persistent local ERP delivery. No Mirakl, Outlook, invoices, shipping notices, portal scraping or production ERP. No silent OCR or invented extraction. Native-text PDFs work; scans need an approved configured adapter or a clear unsupported state.
