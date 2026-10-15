import { expect, test } from "@playwright/test";

test("forwarded email is processed automatically and shows evidence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Extraction: available (TEST ADAPTER)")).toBeVisible();
  await expect(page.getByText("No forwarded emails yet")).toBeVisible();

  await page.getByLabel("Demo email").selectOption("VIDEO-DEMO-001");
  await page.getByRole("button", { name: "Forward to agent" }).click();

  // No Extract button: processing reaches the Matching step on its own.
  await expect(page.locator(".mail").first()).toContainText("Extracted");
  await expect(page.locator(".step.done", { hasText: "Extracting" })).toBeVisible();
  await expect(page.getByText("<video-demo-001@demo.invalid>")).toBeVisible();
  await expect(page.getByText("TEST ADAPTER (fixture parser, not AI extraction)").first()).toBeVisible();
  await expect(page.getByText("(AI extraction)")).toHaveCount(0);
  await expect(page.locator("td", { hasText: "OLD-DEMO-003" })).toBeVisible();
  await expect(page.locator("tr", { has: page.locator("th", { hasText: /^Total$/ }) })).toContainText("190.00");
  await expect(page.getByText("not found in PDF")).toHaveCount(0);
  await page.screenshot({ path: "../docs/screenshots/slice2-inbox.png", fullPage: true });

  // Identical file again is flagged as a duplicate, not reprocessed.
  await page.getByRole("button", { name: "Forward to agent" }).click();
  await expect(page.locator(".mail").first()).toContainText("Duplicate file");
});
