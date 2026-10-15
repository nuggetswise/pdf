import { defineConfig } from "@playwright/test";

// End-to-end tests run against a fresh browser tab (so a fresh run) using the labelled TEST ADAPTER,
// so they are deterministic and never call a real AI service. One Next.js server; no other backend.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3100", screenshot: "only-on-failure" },
  webServer: {
    command: "npx next build && npx next start -p 3100",
    timeout: 180_000,
    url: "http://127.0.0.1:3100",
    env: { ORDER_AGENT_EXTRACTOR: "test", NEXT_DIST_DIR: ".next-e2e" },
    reuseExistingServer: false,
  },
});
