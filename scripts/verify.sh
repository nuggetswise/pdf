#!/usr/bin/env bash
# Single verify command: backend tests, frontend unit tests, typecheck, production build, end-to-end tests.
# Usage (from the repository root): scripts/verify.sh
# End-to-end tests use the labelled TEST ADAPTER and throwaway data; no AI key is needed or used.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/5 Backend tests =="
(cd backend && .venv/bin/python -m pytest -q)

echo "== 2/5 Frontend unit tests (Vitest, incl. Python parity and guided-demo replay) =="
# The parity file must still match what the Python prototype produces today.
parity_tmp="$(mktemp)"
backend/.venv/bin/python scripts/validation_parity.py "$parity_tmp"
cmp -s "$parity_tmp" frontend/lib/domain/__fixtures__/validation-parity.json \
  || { echo "validation-parity.json is stale: run backend/.venv/bin/python scripts/validation_parity.py"; exit 1; }
rm -f "$parity_tmp"
# So must the demo inbox the workflow tests forward (rebuild slice 3).
inbox_tmp="$(mktemp)"
backend/.venv/bin/python scripts/demo_inbox.py "$inbox_tmp" >/dev/null
cmp -s "$inbox_tmp" frontend/lib/domain/__fixtures__/demo-inbox.json \
  || { echo "demo-inbox.json is stale: run backend/.venv/bin/python scripts/demo_inbox.py"; exit 1; }
rm -f "$inbox_tmp"
(cd frontend && npm run -s test)

echo "== 3/5 Frontend typecheck =="
(cd frontend && npm run -s typecheck)

echo "== 4/5 Frontend production build =="
(cd frontend && npm run -s build >/dev/null && echo "build ok")

echo "== 5/5 End-to-end tests (Playwright, rehearsal mode) =="
(cd frontend && npx playwright test)

echo "VERIFY PASSED"
