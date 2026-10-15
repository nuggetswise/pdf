import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Live rehearsal: the Next.js server reads the real Gemini key from the git-ignored repo-root .env.
// Not part of scripts/verify.sh (needs a key and network). Run: npx playwright test -c playwright.live.config.ts
// The key goes only into the server's environment; it is never printed and never reaches the browser.
function dotenv(path: string): Record<string, string> {
  try {
    return Object.fromEntries(readFileSync(path, "utf8").split("\n")
      .map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
      .filter(([k, v]) => k.startsWith("GEMINI_") && v));
  } catch {
    return {};
  }
}

export default defineConfig({
  testDir: "./e2e-live",
  timeout: 900_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3200" },
  webServer: {
    command: "npx next build && npx next start -p 3200",
    timeout: 180_000,
    url: "http://127.0.0.1:3200",
    env: { ...dotenv("../.env"), NEXT_DIST_DIR: ".next-live" },
    reuseExistingServer: false,
  },
});
