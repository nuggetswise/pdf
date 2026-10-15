# Decisions Log

Each entry: decision, why, how to reverse.

D01 Stack: FastAPI + SQLite backend, Next.js UI. Suggested by docs/05; nothing existing to preserve. Reverse: swap layers behind the same local API.

D02 LLM provider: Gemini, via a provider-neutral extractor interface with a configurable model name. Owner will supply the key later. Reverse: add another adapter; no other code changes.

D03 Learning model: the video describes the agent "learning from every correction". The spec (docs/01, docs/02) requires approved, scoped rule reuse, not autonomous retraining. We present it as agent memory: corrections become candidate rules, an administrator activates them, later orders show provenance. Reverse: an auto-activate policy flag could be added later, but is deliberately off.

D04 Separate demo reference data (fixtures/reference-data.v1.json) with product A at 24.00, because master-data.json prices OAT-CASE at 23.00, which would add a fourth exception to VIDEO-DEMO-001. master-data.json stays unchanged for the sample-po regression.

D05 Fixture additions: MOQ rule (A, 10 CASE), obsolete identifier OLD-DEMO-003 and proposed NEW-DEMO-003, second fictional customer DEMO-CUST-02, ship-to and dates on VIDEO-DEMO-002, new VIDEO-DEMO-003 for the nonmatching-customer case. All fictional.

D06 Unit conversion converts unit price with quantity (24 EA at 2.00 = 2 CASE at 24.00), matching golden-expected.json.

D07 Rounding: Decimal, ROUND_HALF_UP, 2 places for money.

D08 Folder layout: docs/ and fixtures/ to match CLAUDE.md references.
