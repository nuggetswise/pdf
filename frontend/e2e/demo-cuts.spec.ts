import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

// Demo-readiness pass: the two cuts of the demo story, clicked through the real screens (TEST ADAPTER, simulated
// ERP and Trading Grid, fictional data). Screenshots go to docs/screenshots/demo-*.
const PACK = (f: string) => join(__dirname, "..", "..", "fixtures", "test-pack", f);
const shot = (page: Page, name: string) => page.screenshot({ path: `../docs/screenshots/demo-${name}.png`, fullPage: true });

async function toShortage(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // The example PO has not arrived yet; the sample inbox is already processed.
  await expect(page.locator("[data-po=\"PO-2026-104587\"]")).toHaveCount(0);
  await shot(page, "01-today-empty");
  const forward = page.getByRole("region", { name: "Forward a purchase order" });
  await forward.getByRole("button", { name: "Forward to agent" }).click();
  const card = page.locator("[data-po=\"PO-2026-104587\"]");
  await card.getByRole("button").click();
  await expect(page.locator(".pdfpage img")).toBeVisible();
  await shot(page, "02-order-pdf");
  await page.getByRole("button", { name: "Approve order" }).click();
  const stock = page.getByRole("region", { name: "Stock and ship date" });
  await expect(stock).toContainText("Needs your choice");
  await shot(page, "03-stock-short");
  return { card, stock };
}

test("retailer CIO cut: steps 1, 2, 4, 6, 7", async ({ page }) => {
  test.setTimeout(120_000);
  const { stock } = await toShortage(page);

  // One shortage, one finding, already detected before the supplier acts.
  await page.getByRole("tab", { name: "Command Center" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  const finding = page.getByRole("article", { name: /Stock short for order/ });
  await expect(finding).toContainText("Unassigned");
  await shot(page, "04-finding-detected");

  // The supplier's confirmation is the action on that finding.
  await finding.getByRole("button", { name: "Open order" }).click();
  await stock.getByLabel("Ship now, backorder the rest").check();
  await stock.getByRole("button", { name: "Confirm to the retailer" }).click();
  await page.getByRole("button", { name: "Back to Command Center" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: /Stock short for order/ })).toContainText("Wait for the retailer's response");
  await shot(page, "05-action-done-unverified");

  // The retailer receives standard messages, then answers.
  await page.getByRole("button", { name: "Retailer", exact: true }).click();
  await expect(page.locator(".rcard[data-kind=ORDRSP]")).toHaveCount(1);
  await shot(page, "06-retailer-received");
  await page.getByRole("tab", { name: "Command Center" }).click();
  const rv = page.getByRole("article", { name: /Revised delivery awaiting retailer/ });
  await expect(rv).toContainText("Simulated retailer response");
  await shot(page, "07-retailer-command-center");
  await rv.getByRole("button", { name: "Accept revision" }).click();

  // Back as the supplier: verified by the retailer's response, not by delivery.
  await page.getByRole("button", { name: "Supplier", exact: true }).click();
  await page.getByRole("tab", { name: "Command Center" }).click();
  await page.getByRole("button", { name: "Verified", exact: true }).click();
  await expect(page.getByRole("article", { name: /Stock short for order/ })).toContainText("Retailer accepted the revised quantities and dates");
  await shot(page, "08-verified");
});

test("supplier cut: steps 1 to 5, then 7, plus the email-text order", async ({ page }) => {
  test.setTimeout(150_000);
  const { card, stock } = await toShortage(page);
  await stock.getByLabel("Ship now, backorder the rest").check();
  await stock.getByRole("button", { name: "Confirm to the retailer" }).click();
  await expect(stock).toContainText(/ship \w{3}, \w{3} \d+ · \d+ backordered to/);

  // Ship and invoice in one step from the confirmed quantities.
  await page.getByRole("tab", { name: "Order operations" }).click();
  await card.getByRole("button").click();
  await stock.getByLabel("Carrier SCAC").fill("UPSN");
  await stock.getByLabel("Tracking number").fill("1ZTEST200001");
  await stock.getByRole("button", { name: "Mark shipped in ERP" }).click();
  await expect(stock).toContainText("Nothing to ship yet");
  await page.getByRole("tab", { name: "Trading Grid outbox" }).click();
  await expect(page.getByRole("region", { name: "Outbound messages" })).toBeVisible();
  await shot(page, "09-outbox");

  // Second beat: an order written in the email body.
  await page.getByRole("tab", { name: "Intake" }).click();
  await page.getByLabel("Upload a purchase order").setInputFiles(PACK("TP-02-email-body.eml"));
  await expect(page.getByRole("complementary", { name: "Inbox" })).toContainText("PO TP-2026-0802");
  await shot(page, "10-email-text-order");

  // Trust controls stay reachable.
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Default for routes without a setting")).toBeVisible();
  await shot(page, "11-settings");
});
