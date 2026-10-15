import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the pure domain, intake and server code in lib/. Playwright (e2e/) stays separate.
export default defineConfig({
  resolve: {
    alias: { "server-only": fileURLToPath(new URL("./lib/server/testing/server-only-stub.ts", import.meta.url)) },
  },
  test: { include: ["lib/**/*.test.ts"], environment: "node" },
});
