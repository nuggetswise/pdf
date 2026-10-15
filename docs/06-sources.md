# Sources and evidence boundaries

Official Claude Code guidance reviewed for this package:
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/memory

Applied: explore/plan/implement; explicit verification; concise project instructions; phase-specific context; evidence rather than asserted success. CLAUDE.md is context, not an enforced security control. The build must enforce invariants through code and tests. No untested hooks or guessed settings are bundled.

PDF reference:
- https://docs.procuros.io/en/general/portal/order-agent

Marketplace references:
- https://www.truecommerce.com/resource/mirakl-platform-integration/
- https://foundry.truecommerce.com/help/TrueCommerce%20Transaction%20Manager/Integrations/MiraklIntegrationDetails1.pdf
- https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or21

Reference scope is distinct from our proposed screens, local APIs, calculations and simulator behaviour. These packages are specifications and fixtures, not implemented apps. They have not been run in Claude Code. Verify live API contracts again before connection. Do not copy claims from previous assistant messages as API documentation.
