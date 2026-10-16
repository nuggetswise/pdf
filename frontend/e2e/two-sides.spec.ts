import { expect, test } from "@playwright/test";

// D54: the supplier stays on email; the retailer receives EDI. A plain-language reply becomes a changed 855, and
// "Mark shipped in ERP" sends the 856 and 810 from the confirmed quantities. TEST ADAPTER only; never shown as AI.
test("a supplier replies in plain words and the retailer receives the changes as EDI", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Supplier and retailer", selected: true })).toBeVisible();
  const supplier = page.getByRole("region", { name: "Supplier's side" });
  const retailer = page.getByRole("region", { name: "Retailer's side" });

  // A clean PO: in Review-all mode it waits for one approval, made from the order screen.
  await supplier.getByLabel("Sample purchase order").selectOption("VIDEO-DEMO-005");
  await supplier.getByRole("button", { name: "Forward sample" }).click();
  const card = supplier.getByRole("article", { name: /Order VIDEO-DEMO-005/ });
  await expect(card).toContainText("waiting for one approval");
  await card.getByRole("button", { name: "Open order" }).click();
  await page.getByRole("button", { name: "Approve order" }).click();
  await expect(page.locator(".order .erp h3")).toContainText("ERP order SIM-ERP-");
  await page.getByRole("tab", { name: "Supplier and retailer" }).click();
  await expect(card).toContainText("In your ERP as SIM-ERP-");
  await expect(retailer.locator(".rcard[data-kind=ORDRSP]")).toHaveCount(1);

  // The supplier answers in their own words; the agent shows each change with the words it came from.
  await card.getByLabel("Supplier's reply").fill("Hi, thanks for the PO. We can only do 10 not 12 on line A. Ships Monday.");
  await card.getByRole("button", { name: "Read reply" }).click();
  const read = card.getByLabel("What the agent understood");
  await expect(read).toContainText("TEST ADAPTER, not AI");
  await expect(read).toContainText("12 CASE → 10 CASE");
  await expect(read).toContainText("“10 not 12”");
  await card.getByRole("button", { name: "Confirm changes to the retailer" }).click();
  await expect(retailer.locator(".rcard[data-kind=ORDRSP]")).toHaveCount(2);
  const changed = retailer.locator(".rcard[data-kind=ORDRSP]").first();
  await expect(changed).toContainText("quantity changed");
  await changed.getByRole("button", { name: "Show EDI" }).click();
  await expect(changed.locator(".raw")).toContainText("ACK*IQ*10*CA~");

  // Shipped in the ERP: the ship notice and invoice follow the confirmed 10, with nothing typed.
  await card.getByRole("button", { name: "Mark shipped in ERP" }).click();
  await expect(retailer.locator(".rcard[data-kind=DESADV]")).toContainText("received");
  await expect(retailer.locator(".rcard[data-kind=INVOIC]")).toContainText("received");
  await expect(card).toContainText("You typed nothing.");
  const inv = retailer.locator(".rcard[data-kind=INVOIC]");
  await inv.getByRole("button", { name: "Show EDI" }).click();
  await expect(inv.locator(".raw")).toContainText(/IT1\*1\*10\*CA\*/);
  await expect(page.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  await page.screenshot({ path: "../docs/screenshots/app-12-two-sides.png", fullPage: true });
});
