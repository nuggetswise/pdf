import { expect, test } from "@playwright/test";

// D45 supplier portal through the real screens: PO -> order confirmation -> ASN with a short shipment ->
// invoice with the shipped quantity -> EDI tab shows the DESADV and INVOIC. TEST ADAPTER only; all EDI simulated.
test("a supplier confirms, ships short and invoices what shipped", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByLabel("Demo role").selectOption("reviewer");
  await page.getByLabel("Upload a purchase order").setInputFiles("../fixtures/demo/generated/VIDEO-DEMO-005.pdf");
  await page.getByRole("button", { name: "Approve order" }).click();
  await expect(page.locator(".order .erp h3")).toContainText("ERP order SIM-ERP-");

  // Step 1: the order confirmation went out by itself, with its own status.
  const portal = page.getByLabel("Supplier portal");
  await expect(portal.getByLabel("Order confirmation")).toContainText("Order confirmation (EDIFACT ORDRSP)");
  await expect(portal.getByLabel("Order confirmation").locator(".pill.ok")).toHaveText("Delivered");

  // Step 2: ASN. Over-shipping is blocked without a reason; ship 10 of the 12 ordered on line A.
  await portal.getByRole("button", { name: "Create ASN" }).click();
  await expect(page.getByLabel("Shipped quantity line A")).toHaveValue("12");
  await page.getByLabel("Shipped quantity line B").fill("4");
  await expect(page.getByRole("button", { name: "Submit ASN" })).toBeDisabled();
  await page.getByLabel("Shipped quantity line B").fill("3");
  await page.getByLabel("Shipped quantity line A").fill("10");
  await page.getByRole("button", { name: "Submit ASN" }).click();
  await expect(portal.getByLabel("Shipping notice")).toContainText("ASN-00001");
  await expect(portal.getByLabel("Shipping notice").locator(".flowstate")).toHaveText("ERP synced, EDI to retailer delivered");

  // Step 3: invoice from the ASN: 10 x 24.00 + 3 x 24.00 = 312.00, not the ordered 360.00, plus the fictional
  // demo supplier's default GST 5% (15.60) = 327.60.
  await portal.getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByLabel("Amounts", { exact: true })).toContainText("Lines 312.00");
  await expect(page.locator(".invtotal")).toContainText("327.60");
  await page.getByRole("button", { name: "Submit invoice" }).click();
  await expect(portal.getByLabel("Invoice")).toContainText("INV-00001");
  await expect(portal.getByLabel("Invoice").locator(".flowstate")).toContainText("ERP synced, EDI to retailer delivered");
  await expect(page.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  await page.screenshot({ path: "../docs/screenshots/app-04-supplier-portal.png", fullPage: true });

  // The EDI tab lists the messages with raw EDIFACT and a plain-language mapping.
  await page.getByRole("tab", { name: "EDI" }).click();
  await expect(page.locator(".edi-card[data-kind=DESADV]")).toHaveCount(1);
  await expect(page.locator(".edi-card[data-kind=INVOIC]")).toHaveCount(1);
  await expect(page.locator(".edi-card[data-kind=ORDRSP]")).toHaveCount(1);
  await expect(page.getByText(/FICTIONAL identifiers \(GS1 demo prefix 952\)/)).toBeVisible();
  const desadv = page.locator(".edi-card[data-kind=DESADV]");
  await desadv.getByRole("button", { name: "Show message" }).click();
  await expect(desadv.getByLabel("Raw message")).toContainText("QTY+12:10'");
  await expect(desadv.getByLabel("Raw message")).toContainText("UNH+1+DESADV:D:01B:UN:EAN007'");
  const invoic = page.locator(".edi-card[data-kind=INVOIC]");
  await invoic.getByRole("button", { name: "Show message" }).click();
  await expect(invoic.getByLabel("Raw message")).toContainText("QTY+47:10'");
  await expect(invoic.getByLabel("Raw message")).toContainText("MOA+79:312.00'");
  await expect(invoic.getByLabel("Raw message")).toContainText("MOA+77:327.60'");
  await expect(invoic.getByLabel("Field mapping")).toContainText("Invoiced quantity 10");
  const dl = page.waitForEvent("download");
  await invoic.getByRole("button", { name: "Download" }).click();
  expect((await dl).suggestedFilename()).toBe("INVOIC-INV-00001.edi");
  await page.screenshot({ path: "../docs/screenshots/app-05-edi-tab.png", fullPage: true });
});

test("a held EDI message shows the mixed state and a safe retry delivers it", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("Demo role").selectOption("administrator");
  await page.getByLabel("Retailer EDI outbox next message").selectOption("hold_next");
  await page.getByLabel("Upload a purchase order").setInputFiles("../fixtures/demo/generated/VIDEO-DEMO-005.pdf");
  await page.getByRole("button", { name: "Approve order" }).click();
  const confirmation = page.getByLabel("Order confirmation");
  await expect(confirmation.locator(".pill.warn")).toHaveText("Pending");
  await confirmation.getByRole("button", { name: "Check receiver and retry safely" }).click();
  await expect(confirmation.locator(".pill.ok")).toHaveText("Delivered");
});
