import { expect, test } from "@playwright/test";

// Live check with real Gemini extraction (needs the key; see playwright.live.config.ts). Not run in the cloud
// build environment, which has no key. Adds the cheese PO by hand and checks the result is labelled as AI, is
// evidence-checked and finds the one price difference.
test("a PDF added by hand is read by live AI extraction", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText(/^AI: /)).toBeVisible();
  await page.getByLabel("Add a document").setInputFiles("../fixtures/maple/PO-2026-104633.pdf");
  await page.getByRole("button", { name: "Review order PO-2026-104633" }).click({ timeout: 540_000 });
  await expect(page.locator("section.issue-card")).toContainText("Price differs from agreed price");
  await expect(page.getByText(/^Read by AI \(/)).toBeVisible();
  await page.screenshot({ path: "../docs/screenshots/live/app-live-upload.png", fullPage: true });
});
