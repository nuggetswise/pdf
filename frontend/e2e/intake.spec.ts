import { expect, test } from "@playwright/test";

// Intake edge cases through the screens: a message that is not an order, a repeat, a scan with no text, and the
// filters on Orders. Files are the fictional test pack (fixtures/test-pack) and the intake edge-case PDFs.
const PACK = (f: string) => `../fixtures/test-pack/${f}`;

test("not an order is kept and can be treated as an order; a repeat is a duplicate", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Add a document").setInputFiles(PACK("TP-03-not-an-order.eml"));
  const closed = page.getByRole("region", { name: /Not an order, and duplicates/ }).or(page.locator("section", { hasText: "Not an order, and duplicates" }));
  await expect(closed).toContainText("Not an order");
  await page.screenshot({ path: "../docs/screenshots/17-not-an-order.png", fullPage: true });
  await page.getByRole("button", { name: /Treat .* as an order/ }).click();
  await expect(page.getByText("Not an order, and duplicates")).toHaveCount(0);

  await page.getByLabel("Add a document").setInputFiles(PACK("TP-01-valid-pdf.eml"));
  await page.getByLabel("Add a document").setInputFiles(PACK("TP-07-repeat-of-TP-01.eml"));
  await expect(closed).toContainText("Duplicate");
});

test("a PDF with no text is blocked, not guessed", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Add a document").setInputFiles("lib/intake/__fixtures__/no-text.pdf");
  await expect(page.getByText("No OCR adapter", { exact: false }).first()).toBeVisible();
});

test("the tiles and the search box filter the orders", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Receive sample email .*104620/ }).click();
  await page.getByRole("button", { name: /Receive sample email .*104633/ }).click();
  await expect(page.getByRole("button", { name: "Orders received: 2" })).toBeVisible();
  await page.getByRole("button", { name: "Need a person: 2" }).click();
  await expect(page.getByText("Showing 2 of 2 orders.")).toBeVisible();
  await page.getByLabel("Search orders").fill("104633");
  await expect(page.getByText("Showing 1 of 2 orders.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review order PO-2026-104620" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show all" }).click();
  await expect(page.getByRole("button", { name: "Review order PO-2026-104620" })).toBeVisible();
});
