import { expect, test } from "@playwright/test";

// Live rehearsal with real Gemini extraction (needs the key; see playwright.live.config.ts). Uploads a fictional
// PDF the way a user would and checks the AI result is labelled as AI and evidence-checked.
test("an uploaded PDF is read by live AI extraction", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText(/^AI extraction: /)).toBeVisible();
  await page.getByLabel("Upload a purchase order").setInputFiles("../fixtures/demo/generated/VIDEO-DEMO-001.pdf");
  await expect(page.locator(".issue")).toHaveCount(3, { timeout: 540_000 });
  await expect(page.getByText(/^Read by AI: /)).toBeVisible();
  await page.screenshot({ path: "../docs/screenshots/live/app-live-upload.png", fullPage: true });
});
