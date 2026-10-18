import { expect, test } from "@playwright/test";

// The two stories the product is shown with, end to end through the screens (scripted reader, not AI; fictional
// Maple Retail Group and Northern Foods data). Screenshots go to docs/screenshots and are reviewed by a person.
const SHOT = (n: string) => `../docs/screenshots/${n}.png`;
const receive = (page: import("@playwright/test").Page, po: string) =>
  page.getByRole("button", { name: new RegExp(`Receive sample email .*${po}`) }).click();

test("supplier story: milk is approved and shipped, cheese needs a price decision and a stock choice", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByText("Test environment", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: SHOT("01-orders-empty"), fullPage: true });

  // Milk: every check passes, one approval, then it is in the ERP and confirmed.
  await receive(page, "104620");
  await expect(page.getByRole("button", { name: "Review order PO-2026-104620" })).toBeVisible();
  await page.screenshot({ path: SHOT("02-orders-milk-waiting"), fullPage: true });
  await page.getByRole("button", { name: "Review order PO-2026-104620" }).click();
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  await expect(page.locator(".outcome")).toContainText("Accepted by your ERP as SIM-ERP-100001");
  const lifecycle = page.getByRole("navigation", { name: "Order lifecycle" });
  await expect(lifecycle.locator("li.done", { hasText: "Confirmed to retailer" })).toBeVisible();
  await page.screenshot({ path: SHOT("03-milk-in-erp"), fullPage: true });

  // Ship notice and invoice are steps in the order, not another screen.
  await page.getByRole("button", { name: "Create ship notice" }).click();
  await page.getByRole("button", { name: "Send ship notice" }).click();
  await expect(lifecycle.locator("li.done", { hasText: "Shipped" })).toBeVisible();
  await page.getByRole("button", { name: "Create invoice" }).click();
  await page.getByRole("button", { name: "Send invoice" }).click();
  await expect(lifecycle.locator("li.done", { hasText: "Invoiced" })).toBeVisible();
  await page.screenshot({ path: SHOT("04-milk-shipped-invoiced"), fullPage: true });

  // Cheese: one printed price differs from the agreed price. A person decides and the reason is recorded.
  await page.getByRole("button", { name: /Back to orders/ }).click();
  await receive(page, "104633");
  await page.getByRole("button", { name: "Review order PO-2026-104633" }).click();
  await expect(page.locator("section.issue-card")).toHaveCount(1);
  await expect(page.locator("section.issue-card")).toContainText("Price differs from agreed price");
  await page.screenshot({ path: SHOT("05-cheese-price-decision"), fullPage: true });
  await page.getByLabel("Reason").fill("Retailer confirmed the new Cheddar price by phone");
  await page.getByRole("button", { name: "Accept printed price" }).click();
  await expect(page.getByText("Stock is short.")).toBeVisible();
  await page.getByRole("radio", { name: /Ship now, backorder the rest/ }).check();
  await page.getByRole("button", { name: "Confirm to the retailer" }).click();
  await expect(lifecycle.locator("li.done", { hasText: "Confirmed to retailer" })).toBeVisible();
  await page.screenshot({ path: SHOT("06-cheese-stock-split"), fullPage: true });

  // Transactions lists every document in and out.
  await page.getByRole("tab", { name: "Transactions" }).click();
  await expect(page.locator("tr[data-type='Purchase order']")).toHaveCount(2);
  await expect(page.locator("tr[data-type='Order confirmation']")).toHaveCount(2);
  await expect(page.locator("tr[data-type='Ship notice']")).toHaveCount(1);
  await expect(page.locator("tr[data-type='Invoice']")).toHaveCount(1);
  await page.getByLabel("Document type").selectOption("Invoice");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.screenshot({ path: SHOT("07-transactions"), fullPage: true });

  // Rules are read from the ERP and cannot be edited.
  await page.getByRole("tab", { name: "Rules" }).click();
  await expect(page.getByText("Synced from your ERP.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Rules" }).locator("input, select, textarea")).toHaveCount(0);
  await page.screenshot({ path: SHOT("08-rules-read-only"), fullPage: true });

  // Settings explain each part; test controls are collapsed.
  await page.getByRole("tab", { name: "Settings" }).click();
  for (const h of ["Connections", "Company", "Team", "Notifications", "Approval mode", "Who handles findings"]) {
    await expect(page.getByRole("heading", { name: h, exact: true })).toBeVisible();
  }
  await expect(page.locator("details.test-controls")).not.toHaveAttribute("open", "");
  await page.screenshot({ path: SHOT("09-settings"), fullPage: true });
});

test("retailer story: Maple sees the confirmation, the backorder and answers the revised delivery", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await receive(page, "104633");
  await page.getByRole("button", { name: "Review order PO-2026-104633" }).click();
  await page.getByLabel("Reason").fill("Retailer confirmed the new Cheddar price by phone");
  await page.getByRole("button", { name: "Accept printed price" }).click();
  await page.getByRole("radio", { name: /Ship now, backorder the rest/ }).check();
  await page.getByRole("button", { name: "Confirm to the retailer" }).click();

  await page.getByRole("button", { name: "Retailer", exact: true }).click();
  await expect(page.getByText("Maple Retail Group Inc.").first()).toBeVisible();
  await expect(page.locator("article.rcard")).toHaveCount(1);
  await expect(page.locator("article.rcard")).toContainText("Order confirmation");
  await page.screenshot({ path: SHOT("10-retailer-documents"), fullPage: true });
  await page.getByRole("tab", { name: "Suppliers" }).click();
  await page.screenshot({ path: SHOT("11-retailer-suppliers"), fullPage: true });
  await page.getByRole("tab", { name: "Command Center" }).click();
  await page.screenshot({ path: SHOT("12-retailer-command-center"), fullPage: true });
  await page.getByRole("button", { name: "Accept revision" }).click();
  await page.getByRole("button", { name: "Verified" }).click();
  await expect(page.locator("article.finding.verified").first()).toBeVisible();
  await page.screenshot({ path: SHOT("13-retailer-accepted"), fullPage: true });
});
