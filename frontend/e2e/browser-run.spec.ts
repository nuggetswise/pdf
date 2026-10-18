import { expect, test } from "@playwright/test";

// Rebuild slice 5: the run lives in this browser tab. It survives a reload of the tab, a new tab starts
// empty, and the original PDF (kept in this browser) is still shown after the reload.
test("the run is kept for the tab's session and nowhere else", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Orders", exact: true }).click(); await page.getByRole("button", { name: "All documents" }).click();
  await page.getByRole("tab", { name: "Orders", exact: true }).click(); await page.getByRole("button", { name: "All documents" }).click();
  await page.getByLabel("Upload a purchase order").setInputFiles("../fixtures/demo/generated/VIDEO-DEMO-001.pdf");
  await expect(page.locator(".issue.open")).toHaveCount(3);
  await expect(page.locator(".pdfpage img")).toBeVisible();

  await page.reload();
  // 18 sample orders plus the uploaded one.
  await expect(page.locator(".kpi b").first()).toHaveText("19");
  await page.getByRole("tab", { name: "Orders", exact: true }).click(); await page.getByRole("button", { name: "All documents" }).click();
  await expect(page.locator(".mail")).toHaveCount(1);
  await page.locator(".mail").first().click();
  await expect(page.locator(".issue.open")).toHaveCount(3);
  // The PDF itself is kept in this browser, so the page still shows after a reload.
  await expect(page.locator(".pdfpage img")).toBeVisible();

  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "All documents" }).click();
  await expect(other.getByText("No orders yet")).toBeVisible();
});

test("an extraction cut off by a reload is marked for retry, and retry finishes it", async ({ page }) => {
  // Hold the extraction request so the reload happens while it is in flight.
  // Wait until the request is actually held before releasing the route; "Reading PDF" shows before it is sent.
  let held!: () => void;
  const isHeld = new Promise<void>((r) => { held = r; });
  await page.route("/api/extract", (route) => (route.request().method() === "POST" ? (held(), new Promise(() => {})) : route.fallback()));
  await page.goto("/");
  await page.getByRole("button", { name: "All documents" }).click();
  await page.getByLabel("Upload a purchase order").setInputFiles("../fixtures/demo/generated/VIDEO-DEMO-001.pdf");
  await expect(page.locator(".mail").first()).toContainText("Reading PDF");
  await isHeld;
  await page.unroute("/api/extract");
  await page.reload();
  await page.getByRole("tab", { name: "Orders", exact: true }).click(); await page.getByRole("button", { name: "All documents" }).click();
  await expect(page.locator(".mail").first()).toContainText("Extraction failed");
  await page.locator(".mail").first().click();
  await expect(page.locator(".order .alert.bad")).toContainText("interrupted when the page reloaded");
  await page.getByRole("button", { name: "Retry extraction" }).click();
  await expect(page.locator(".issue.open")).toHaveCount(3);
});
