import { expect, test } from "@playwright/test";

// D54: the supplier stays on email; the retailer receives EDI. A plain-language reply becomes a changed 855, and
// "Mark shipped in ERP" sends the 856 and 810 from the confirmed quantities. TEST ADAPTER only; never shown as AI.
test("a supplier replies in plain words and the retailer receives the changes as EDI", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Orders", exact: true, selected: true })).toBeVisible();
  const supplier = page.getByRole("region", { name: "Forward a purchase order" });
  const retailer = page.getByRole("region", { name: "Documents received" });
  const asRetailer = () => page.getByRole("button", { name: "Retailer", exact: true }).click();
  const asSupplier = () => page.getByRole("button", { name: "Supplier", exact: true }).click();

  // A clean PO: in Review-all mode it waits for one approval, made from the order screen.
  await supplier.getByLabel("Forward a purchase order").setInputFiles("../fixtures/demo/generated/VIDEO-DEMO-005.eml");
  const card = page.locator("[data-po=\"VIDEO-DEMO-005\"]");
  await expect(card).toContainText("waiting for one approval");
  await expect(card).toContainText("from orders@northfield-demo.example");
  await card.getByRole("button").click();
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  await expect(page.getByText(/Accepted by your ERP as SIM-ERP-/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Orders", exact: true }).click();
  await expect(card).toContainText("In your ERP as SIM-ERP-");
  await asRetailer();
  await expect(retailer.locator(".rcard[data-kind=ORDRSP]")).toHaveCount(1);
  await asSupplier();
  await page.getByRole("tab", { name: "Orders", exact: true }).click();
  await card.getByRole("button").click();
  // Stock was there, so the order confirmed itself with a ship date; the reply and shipping live in the order.
  const order = page.getByRole("region", { name: "Stock and ship date" });
  await expect(order).toContainText("Ships ");

  // The supplier answers in their own words; the agent shows each change with the words it came from.
  await order.getByLabel("Supplier's reply").fill("Hi, thanks for the PO. We can only do 10 not 12 on line A. Ships Monday.");
  await order.getByRole("button", { name: "Read reply" }).click();
  const read = order.getByLabel("What the agent understood");
  await expect(read).toContainText("TEST ADAPTER, not AI");
  await expect(read).toContainText("12 CASE → 10 CASE");
  await expect(read).toContainText("“10 not 12”");
  await order.getByRole("button", { name: "Confirm changes to the retailer" }).click();
  await expect(order).toContainText("Your reply was confirmed to the retailer.");
  await asRetailer();
  await expect(retailer.locator(".rcard[data-kind=ORDRSP]")).toHaveCount(2);
  const changed = retailer.locator(".rcard[data-kind=ORDRSP]").first();
  await expect(changed).toContainText("quantity changed");
  await changed.getByRole("button", { name: "Show EDI" }).click();
  await expect(changed.locator(".raw")).toContainText("ACK*IQ*10*CA~");

  await asSupplier();
  // Shipped in the ERP: the ship notice and invoice follow the confirmed 10, with nothing typed.
  await page.getByRole("tab", { name: "Orders", exact: true }).click();
  await card.getByRole("button").click();
  await order.getByLabel("Carrier SCAC").fill("UPSN");
  await order.getByLabel("Tracking number").fill("1ZTEST100001");
  await order.getByRole("button", { name: "Mark shipped in ERP" }).click();
  await page.getByRole("tab", { name: "Orders", exact: true }).click();
  await expect(card).toContainText("sent to the retailer.");
  await page.screenshot({ path: "../docs/screenshots/app-12-supplier-today.png", fullPage: true });
  await asRetailer();
  await expect(retailer.locator(".rcard[data-kind=DESADV]")).toContainText("received");
  await expect(retailer.locator(".rcard[data-kind=INVOIC]")).toContainText("received");
  const inv = retailer.locator(".rcard[data-kind=INVOIC]");
  await inv.getByRole("button", { name: "Show EDI" }).click();
  await expect(inv.locator(".raw")).toContainText(/IT1\*1\*10\*CA\*/);
  await expect(page.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  await page.screenshot({ path: "../docs/screenshots/app-13-retailer-received.png", fullPage: true });
});
