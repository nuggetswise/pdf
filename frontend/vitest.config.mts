import { defineConfig } from "vitest/config";

// Unit tests for the pure domain code in lib/. Playwright (e2e/) stays separate.
export default defineConfig({
  test: { include: ["lib/**/*.test.ts"], environment: "node" },
});
