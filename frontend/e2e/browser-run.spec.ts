import { expect, test } from "@playwright/test";

// Rebuild slice 5: the run lives in this browser tab. It survives a reload of the tab, a new tab starts
// empty, and the original PDF (kept in memory only) is shown until the reload and explained after it.
test("the run is kept for the tab's session and nowhere else", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await page.getByLabel("Demo email").selectOption("VIDEO-DEMO-001");
  await page.getByRole("button", { name: "Forward to agent" }).click();
  await expect(page.locator(".issue.open")).toHaveCount(3);
  await page.getByRole("tab", { name: "Original PDF" }).click();
  await expect(page.locator('iframe[title="Source PDF"]')).toHaveAttribute("src", /^blob:/);

  await page.reload();
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await expect(page.locator(".mail")).toHaveCount(1);
  await page.locator(".mail").first().click();
  await expect(page.locator(".issue.open")).toHaveCount(3);
  await expect(page.locator(".kpi b").first()).toHaveText("1");
  await page.getByRole("tab", { name: "Original PDF" }).click();
  await expect(page.getByText("The original PDF is kept only in memory")).toBeVisible();

  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("tab", { name: "Inbox & review" }).click();
  await expect(other.getByText("No forwarded emails yet")).toBeVisible();
});

test("an extraction cut off by a reload is marked for retry, and retry finishes it", async ({ page }) => {
  // Hold the extraction request so the reload happens while it is in flight.
  await page.route("/api/extract", (route) => (route.request().method() === "POST" ? new Promise(() => {}) : route.fallback()));
  await page.goto("/");
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await page.getByLabel("Demo email").selectOption("VIDEO-DEMO-001");
  await page.getByRole("button", { name: "Forward to agent" }).click();
  await expect(page.locator(".mail").first()).toContainText("Reading PDF");
  await page.unroute("/api/extract");
  await page.reload();
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await expect(page.locator(".mail").first()).toContainText("Extraction failed");
  await page.locator(".mail").first().click();
  await expect(page.locator(".order .alert.bad")).toContainText("interrupted when the page reloaded");
  await page.getByRole("button", { name: "Retry extraction" }).click();
  await expect(page.locator(".issue.open")).toHaveCount(3);
});
