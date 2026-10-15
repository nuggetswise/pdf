import { defineConfig } from "@playwright/test";

// End-to-end tests run against fresh, throwaway data using the labelled TEST ADAPTER,
// so they are deterministic and never call a real AI service.
const dataDir = `/tmp/order-agent-e2e-${Date.now()}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3100", screenshot: "only-on-failure" },
  webServer: [
    {
      command: "../backend/.venv/bin/uvicorn app.main:app --app-dir ../backend --port 8100",
      url: "http://127.0.0.1:8100/api/health",
      env: { ORDER_AGENT_EXTRACTOR: "test", ORDER_AGENT_DATA_DIR: dataDir, ORDER_AGENT_LOAD_DOTENV: "0" },
      reuseExistingServer: false,
    },
    {
      command: "npx next build && npx next start -p 3100",
      timeout: 180_000,
      url: "http://127.0.0.1:3100",
      env: { ORDER_AGENT_BACKEND_URL: "http://127.0.0.1:8100", NEXT_DIST_DIR: ".next-e2e" },
      reuseExistingServer: false,
    },
  ],
});
