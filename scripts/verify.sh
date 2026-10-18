#!/usr/bin/env bash
# Single verify command: frontend unit tests, typecheck, production build, end-to-end tests.
# Usage (from the repository root): scripts/verify.sh
# End-to-end tests use the labelled TEST ADAPTER and throwaway data; no AI key is needed or used.
# Python is only used to regenerate fixtures (tools/requirements.lock); nothing here runs it.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/4 Frontend unit tests (Vitest, incl. the Maple and intake test packs) =="
(cd frontend && npm run -s test)

echo "== 2/4 Frontend typecheck =="
(cd frontend && npm run -s typecheck)

echo "== 3/4 Frontend production build =="
(cd frontend && npm run -s build >/dev/null && echo "build ok")

echo "== 4/4 End-to-end tests (Playwright, test environment, one Next.js server) =="
(cd frontend && npx playwright test)

echo "VERIFY PASSED"
