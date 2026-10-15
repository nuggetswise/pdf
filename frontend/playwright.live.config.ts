import { defineConfig } from "@playwright/test";

// Live rehearsal: the backend reads the real Gemini key from the git-ignored .env.
// Not part of scripts/verify.sh (needs a key and network). Run: npx playwright test -c playwright.live.config.ts
const dataDir = `/tmp/order-agent-live-${Date.now()}`;

export default defineConfig({
  testDir: "./e2e-live",
  timeout: 900_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3200" },
  webServer: [
    {
      command: "../backend/.venv/bin/uvicorn app.main:app --app-dir ../backend --port 8200",
      url: "http://127.0.0.1:8200/api/health",
      env: { ORDER_AGENT_DATA_DIR: dataDir },
      reuseExistingServer: false,
    },
    {
      command: "npx next build && npx next start -p 3200",
      timeout: 180_000,
      url: "http://127.0.0.1:3200",
      env: { ORDER_AGENT_BACKEND_URL: "http://127.0.0.1:8200", NEXT_DIST_DIR: ".next-live" },
      reuseExistingServer: false,
    },
  ],
});
