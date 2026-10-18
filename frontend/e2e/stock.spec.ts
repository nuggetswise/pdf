import { expect, test } from "@playwright/test";

// D60/D61: the example PO through the real screens. Its page shows with a box on each value; ERP stock is short on
// one line, so the order waits for the supplier's choice before the retailer is told; a split ships what is there
// and backorders the rest with dates. TEST ADAPTER only; ERP stock and EDI are simulated.
test("the example PO: page view, stock check, split shipment and backorder dates", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const forward = page.getByRole("region", { name: "Forward a purchase order" });
  await expect(forward).toContainText("Maple Retail Group · PO-2026-104587");
  await forward.getByRole("button", { name: "Forward Maple Retail Group · PO-2026-104587" }).click();
  const card = page.locator("[data-po=\"PO-2026-104587\"]");
  await expect(card).toContainText("waiting for one approval");
  await card.getByRole("button").click();

  // The PDF as printed, with the values the agent read boxed; the PO's terms and notes, word for word.
  await expect(page.locator(".pdfpage img")).toBeVisible();
  await expect(page.locator(".vbox").first()).toBeVisible();
  const terms = page.getByRole("region", { name: "Order terms" });
  await expect(terms).toContainText("Nov 17, 2026");
  await expect(terms).toContainText("Ship complete whenever possible.");
  await page.screenshot({ path: "../docs/screenshots/app-14-example-po-page.png", fullPage: true });

  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  const stock = page.getByRole("region", { name: "Stock and ship date" });
  await expect(stock).toContainText("Needs your choice");
  await expect(stock.locator("tr.short")).toHaveCount(1);
  await expect(stock.locator("tr.short")).toContainText("Cheese Snack Mix");
  await expect(stock).toContainText("Latest ship date Tue, Nov 17");
  await page.screenshot({ path: "../docs/screenshots/app-15-stock-short.png", fullPage: true });

  // Nothing has gone to the retailer yet.
  await page.getByRole("button", { name: "Retailer", exact: true }).click();
  await expect(page.locator(".rcard[data-kind=ORDRSP]")).toHaveCount(0);
  await page.getByRole("button", { name: "Supplier", exact: true }).click();
  await page.getByRole("tab", { name: "Orders", exact: true }).click();
  await expect(card).toContainText("Stock is short on 1 line");
  await card.getByRole("button").click();

  await stock.getByLabel("Ship now, backorder the rest").check();
  await stock.getByRole("button", { name: "Confirm to the retailer" }).click();
  // Dates come from today and ERP stock, so only their shape is checked here (fixed dates are in the unit tests).
  await expect(stock).toContainText(/60 ship \w{3}, \w{3} \d+ · 25 backordered to \w{3}, \w{3} \d+/);

  await page.getByRole("button", { name: "Retailer", exact: true }).click();
  const ack = page.locator(".rcard[data-kind=ORDRSP]");
  await expect(ack).toContainText(/Cheese Snack Mix 500g: 60 ship \w{3}, \w{3} \d+ · 25 backordered to/);
  await ack.getByRole("button", { name: "Show EDI" }).click();
  await expect(ack.locator(".raw")).toContainText(/ACK\*IB\*25\*CA\*068\*\d{8}~/);
  await page.screenshot({ path: "../docs/screenshots/app-16-retailer-backorder.png", fullPage: true });

  // Ship what is in stock; ERP stock goes down.
  await page.getByRole("button", { name: "Supplier", exact: true }).click();
  await page.getByRole("tab", { name: "Orders", exact: true }).click();
  await card.getByRole("button").click();
  await stock.getByLabel("Carrier SCAC").fill("UPSN");
  await stock.getByLabel("Tracking number").fill("1ZTEST200001");
  await stock.getByRole("button", { name: "Mark shipped in ERP" }).click();
  await expect(stock).toContainText("Nothing to ship yet");
  await page.getByRole("tab", { name: "Sent" }).click();
  await expect(page.getByRole("region", { name: "Stock" }).locator("tr", { hasText: "NF-SNP-017" })).toContainText("SUP-PO-77120");
});
