import { expect, test } from "@playwright/test";
import { asRole } from "./helpers";
import { readFileSync } from "node:fs";

// D45 supplier portal through the real screens: PO -> order confirmation -> ASN with a short shipment ->
// invoice with the shipped quantity -> EDI tab shows the DESADV and INVOIC. TEST ADAPTER only; all EDI simulated.
test("a supplier confirms, ships short and invoices what shipped", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await asRole(page, "reviewer");
  await page.getByLabel("Upload a purchase order").setInputFiles("../fixtures/demo/generated/VIDEO-DEMO-005.pdf");
  await page.getByRole("button", { name: "Approve order" }).click();
  await expect(page.locator(".order .erp h3")).toContainText("ERP order SIM-ERP-");

  // Step 1: the order confirmation went out by itself, with its own status.
  const portal = page.getByLabel("Supplier portal");
  await expect(portal.getByLabel("Order confirmation")).toContainText("Order acknowledgement (X12 855)");
  await expect(portal.getByLabel("Order confirmation").locator(".pill.ok")).toHaveText("Delivered");

  // Step 2: ASN. Over-shipping is blocked without a reason; ship 10 of the 12 ordered on line A.
  await portal.getByRole("button", { name: "Create ASN" }).click();
  await expect(page.getByLabel("Shipped quantity line A")).toHaveValue("12");
  await page.getByLabel("Shipped quantity line B").fill("4");
  await expect(page.getByRole("button", { name: "Submit ASN" })).toBeDisabled();
  await page.getByLabel("Shipped quantity line B").fill("3");
  await page.getByLabel("Shipped quantity line A").fill("10");
  await page.getByLabel("Carrier SCAC").fill("DEMO");
  await page.getByLabel("Bill of lading number").fill("BOL-0001");
  await expect(page.getByLabel("ASN timing")).toBeVisible();
  await page.getByRole("button", { name: "Submit ASN" }).click();
  await expect(portal.getByLabel("Shipping notice")).toContainText("ASN-00001");
  await expect(portal.getByLabel("Carrier")).toContainText("Carrier DEMO · BOL BOL-0001");
  const popup = page.waitForEvent("popup");
  await portal.getByRole("button", { name: /Print \d+ GS1-128 labels?/ }).click();
  const labels = await popup;
  await expect(labels.locator("section.label").first()).toContainText("(00) 0952");
  await expect(labels.locator("svg[aria-label^='GS1-128 barcode']").first()).toBeVisible();
  await labels.screenshot({ path: "../docs/screenshots/app-11-gs1-128-labels.png", fullPage: true });
  await labels.close();
  await expect(portal.getByLabel("Shipping notice").locator(".flowstate")).toHaveText("ERP synced, EDI to retailer delivered");

  // Step 3: invoice from the ASN: 10 x 24.00 + 3 x 24.00 = 312.00, not the ordered 360.00, with no sales
  // tax by default for the fictional US demo supplier (wholesale for resale).
  await portal.getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByLabel("Amounts", { exact: true })).toContainText("Lines 312.00");
  await expect(page.locator(".invtotal")).toContainText("312.00 USD");
  await page.getByRole("button", { name: "Submit invoice" }).click();
  await expect(portal.getByLabel("Invoice")).toContainText("INV-00001");
  await expect(portal.getByLabel("Invoice").locator(".flowstate")).toContainText("ERP synced, EDI to retailer delivered");
  await expect(portal.getByLabel("Payment terms")).toContainText("Terms 2% 10, net 30 · due ");
  // The 2 cases of line A not shipped stay open as a backorder until shipped or cancelled.
  await expect(portal.getByLabel("Backorder")).toContainText("2 CASE line A");
  await portal.getByRole("button", { name: "Cancel the rest" }).click();
  await portal.getByLabel("Cancel reason").fill("Out of stock (fictional)");
  await portal.getByRole("button", { name: "Cancel the rest" }).click();
  await expect(portal.getByLabel("Backorder")).toContainText("Rest of the order cancelled: 2 CASE line A");
  await expect(page.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "Settings" }).click();
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export pilot measurements (CSV)" }).click();
  const file = await csv;
  expect(file.suggestedFilename()).toBe("order-agent-pilot.csv");
  const text = readFileSync(await file.path(), "utf8");
  expect(text.split("\r\n")[0]).toContain("po_number,customer_id,received_at");
  expect(text).toMatch(/VIDEO-DEMO-005,DEMO-CUST-01,.*,1,/);
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await page.screenshot({ path: "../docs/screenshots/app-04-supplier-portal.png", fullPage: true });

  // The EDI tab lists the messages with raw X12 and a plain-language mapping.
  await page.getByRole("tab", { name: "Trading Grid outbox" }).click();
  await expect(page.locator(".edi-card[data-kind=DESADV]")).toHaveCount(1);
  await expect(page.locator(".edi-card[data-kind=INVOIC]")).toHaveCount(1);
  await expect(page.locator(".edi-card[data-kind=ORDRSP]")).toHaveCount(1);
  await expect(page.getByText(/FICTIONAL identifiers \(GS1 demo prefix 952\)/)).toBeVisible();
  const desadv = page.locator(".edi-card[data-kind=DESADV]");
  await desadv.getByRole("button", { name: "Show message" }).click();
  await expect(desadv.getByLabel("Raw message")).toContainText(/SN1\*\*10\*[A-Z]{2}~/);
  await expect(desadv.getByLabel("Raw message")).toContainText("ST*856*0001~");
  const invoic = page.locator(".edi-card[data-kind=INVOIC]");
  await invoic.getByRole("button", { name: "Show message" }).click();
  await expect(invoic.getByLabel("Raw message")).toContainText(/IT1\*1\*10\*[A-Z]{2}\*24\.00\*\*/);
  await expect(invoic.getByLabel("Raw message")).toContainText("TDS*31200~");
  await expect(invoic.getByLabel("Field mapping")).toContainText("Line 1 (PO line A): 10 CASE at 24.00 = 240.00");
  const dl = page.waitForEvent("download");
  await invoic.getByRole("button", { name: "Download" }).click();
  expect((await dl).suggestedFilename()).toBe("INVOIC-INV-00001.x12");
  await page.screenshot({ path: "../docs/screenshots/app-05-edi-tab.png", fullPage: true });
});

test("a held EDI message shows the mixed state and a safe retry delivers it", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await asRole(page, "administrator");
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Retailer EDI outbox next message").selectOption("hold_next");
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await page.getByLabel("Upload a purchase order").setInputFiles("../fixtures/demo/generated/VIDEO-DEMO-005.pdf");
  await page.getByRole("button", { name: "Approve order" }).click();
  const confirmation = page.getByLabel("Order confirmation");
  await expect(confirmation.locator(".pill.warn")).toHaveText("Pending");
  await confirmation.getByRole("button", { name: "Check receiver and retry safely" }).click();
  await expect(confirmation.locator(".pill.ok")).toHaveText("Delivered");
});
