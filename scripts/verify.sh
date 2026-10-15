#!/usr/bin/env bash
# Single verify command: backend tests, frontend unit tests, typecheck, production build, end-to-end tests.
# Usage (from the repository root): scripts/verify.sh
# End-to-end tests use the labelled TEST ADAPTER and throwaway data; no AI key is needed or used.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/5 Backend tests =="
(cd backend && .venv/bin/python -m pytest -q)

echo "== 2/5 Frontend unit tests (Vitest) =="
(cd frontend && npm run -s test)

echo "== 3/5 Frontend typecheck =="
(cd frontend && npm run -s typecheck)

echo "== 4/5 Frontend production build =="
(cd frontend && npm run -s build >/dev/null && echo "build ok")

echo "== 5/5 End-to-end tests (Playwright, rehearsal mode) =="
(cd frontend && npx playwright test)

echo "VERIFY PASSED"
