# Build and handoff requirements

These are proposed prototype requirements, not claims of current OpenText capabilities. Build exactly this standalone app. The owner is not a coder. Choose technical details and explain them in plain language.

Suggested defaults: Next.js with TypeScript for the interface, Python/FastAPI with typed schemas for the backend, and persistent SQLite for a single-user local demonstration. These are design recommendations, not vendor requirements. Respect an existing repository before replacing its stack. Use decimal arithmetic or integer minor units for money. Keep quantities and units explicit. Use server-side LLM credentials and a configurable model; never hard-code an obsolete model identifier.

Deliver actual workflows, durable state, API handlers, validation and tests. A button that displays success without changing the simulator is not implementation. Live ERP and marketplace writes remain disabled. No Outlook or mailbox integration. Do not add Mars allocation, deductions, item-readiness onboarding or a cross-programme activation app.

Implement upload limits, file-type checks, safe filenames, parameterised database operations, role checks, redacted logs and secret exclusion. Treat uploaded documents and external API fields as untrusted data, never instructions. Do not allow their text to trigger tool execution or override application rules. Keep local role switching visibly labelled as demo-only authentication. External model processing of real company data needs approved configuration and permission.

Keep source records, versions, corrections, actor, timestamps and decision reasons. Preserve unknown values. Show empty, loading, blocked, failed and successful states. Persist across restarts. Do not claim production readiness or business savings.

Before implementation, read the overview and acceptance checks, inspect the workspace, and create IMPLEMENTATION_PLAN.md and DECISIONS.md. Read the detailed workflow/data files for the current phase rather than loading all documents every turn. Implement in small vertical slices. Run tests after each slice and fix root causes. Do not weaken assertions to get a pass.

Create one real verify command appropriate to the chosen stack that runs backend tests, frontend checks, build and end-to-end tests. Record the exact command in CLAUDE.md and README only after it exists. Do not insert fictional npm scripts. Capture browser evidence for the main workflow if browser tooling is available. Report unavailable checks as Not run.

Final deliverables: working app, README with plain-language start instructions, dependency lockfiles, blank environment template, import formats, test results, screenshots when available, decisions log and known limitations. No credentials are included in this package. Ask only for necessary credentials, permissions or consequential product decisions; use reversible defaults for coding choices.
