import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "/home/user/pdf/frontend/e2e", testMatch: /zz-probe/, workers: 1, timeout: 120000 });
