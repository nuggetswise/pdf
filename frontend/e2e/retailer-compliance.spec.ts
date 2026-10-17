import { expect, test } from "@playwright/test";
import { asRole } from "./helpers";

// D47: a retailer the supplier has not set up yet. Its EDI is held until its GLNs are entered; the ASN and the
// invoice show the retailer's rule check before submit, and a message that would be rejected cannot be sent.
// FICTIONAL TEST DATA ("Fernhill Demo Electronics", GS1 demo prefix 952) and the TEST ADAPTER; all EDI simulated.
test("EDI is held until the retailer is set up, then the ASN and invoice pass its rules", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Intake" }).click();
  await asRole(page, "reviewer");
  const card = (text: string) => page.locator(".issue.open", { hasText: text });

  // Onboard the unknown retailer and its two items from the PO (D46), then approve.
  await page.getByLabel("Upload a purchase order").setInputFiles("../fixtures/onboarding/ONBOARD-DEMO-003.pdf");
  await card("Customer not recognised").getByRole("button", { name: "Add as new customer" }).click();
  await card("9520000002015").getByRole("button", { name: "Add to catalogue" }).click();
  await card("9520000002022").getByRole("button", { name: "Add to catalogue" }).click();
  await expect(page.locator(".allclear")).toBeVisible();
  await page.getByRole("button", { name: "Approve order" }).click();
  await expect(page.locator(".order .erp h3")).toContainText("ERP order SIM-ERP-");

  // No GLNs on file: the order confirmation is held and the ASN would be rejected, with the reason shown.
  const portal = page.getByLabel("Supplier portal");
  await expect(portal.getByLabel("EDI setup")).toContainText("has no GLNs on file");
  await expect(portal.getByLabel("Order confirmation").locator(".pill.bad")).toHaveText("Held");
  await portal.getByRole("button", { name: "Create ASN" }).click();
  const asnCheck = portal.getByLabel("Shipping notice").getByLabel("Retailer check");
  await expect(asnCheck).toContainText("Would be rejected");
  await expect(asnCheck).toContainText("Buyer has no valid GLN");
  await expect(page.getByRole("button", { name: "Submit ASN" })).toBeDisabled();
  await page.screenshot({ path: "../docs/screenshots/app-09-edi-blocked.png", fullPage: true });

  // Enter the EDI setup. A wrong check digit is refused.
  const setup = portal.getByLabel("EDI setup");
  // US X12 retailers hide the VAT fields; choosing the EANCOM MediaMarktSaturn rules shows them.
  await expect(setup.getByLabel("Supplier VAT number")).toHaveCount(0);
  await setup.getByLabel("Retailer rules").selectOption("mediamarktsaturn");
  await setup.getByLabel("Supplier GLN").fill("9520000005559");
  await setup.getByLabel("Supplier VAT number").fill("DE000000000");
  await setup.getByLabel("Tax type").selectOption("VAT");
  await setup.getByLabel("Default tax rate %").fill("19");
  await setup.getByLabel("Buyer GLN").fill("9520010007773");
  await setup.getByRole("button", { name: "Save EDI setup" }).click();
  await expect(setup.getByRole("alert")).toContainText("not a valid GLN");
  await setup.getByLabel("Buyer GLN").fill("9520010007772");
  await setup.getByLabel("Buyer VAT number").fill("DE999999999");
  await setup.getByLabel(/Delivery GLN/).fill("9520020007779");
  await setup.getByLabel("EDI agreement / contract reference").fill("EDI-AGR-DEMO-1");
  await setup.getByRole("button", { name: "Save EDI setup" }).click();
  await expect(setup).toContainText("MediaMarktSaturn (public guides, partial)");

  // The held confirmation is rebuilt from the setup and sent.
  await portal.getByLabel("Order confirmation").getByRole("button", { name: "Check again and send" }).click();
  await expect(portal.getByLabel("Order confirmation").locator(".pill.ok")).toHaveText("Delivered");

  // ASN: 24 cables 10 per carton (10, 10, 4) and the stands in one carton: 4 cartons, 2 per pallet.
  await page.getByLabel("Units per carton line 1").fill("10");
  await page.getByLabel("Cartons per pallet").fill("2");
  await expect(page.getByLabel("Packing preview")).toContainText("2 pallets, 4 cartons");
  await expect(asnCheck).toContainText("Passes retailer check");
  await page.getByRole("button", { name: "Submit ASN" }).click();
  await expect(portal.getByLabel("Shipping notice").locator(".flowstate")).toHaveText("ERP synced, EDI to retailer delivered");
  await expect(portal.getByLabel("Packing")).toContainText("2 pallets, 4 cartons");

  // Invoice: stands at 7% VAT, a 2% discount on the 19% lines. 100.80 - 2.02 = 98.78 (+18.77); 69.00 (+4.83).
  await portal.getByRole("button", { name: "Create invoice" }).click();
  await page.getByLabel("Tax rate line 2").fill("7");
  await page.getByRole("button", { name: "Add allowance or charge" }).click();
  await page.getByLabel("Allowance 1 percent").fill("2");
  await page.getByLabel("Allowance 1 tax rate").selectOption("19");
  await expect(page.getByLabel("Order, ASN and invoice check")).toContainText("matched");
  await expect(page.getByLabel("Amounts", { exact: true })).toContainText("VAT 19% on 98.78: 18.77");
  await expect(page.locator(".invtotal")).toContainText("191.38 EUR");
  await expect(portal.getByLabel("Invoice", { exact: true }).getByLabel("Retailer check")).toContainText("Passes retailer check");
  await page.screenshot({ path: "../docs/screenshots/app-10-invoice-tax-match.png", fullPage: true });
  await page.getByRole("button", { name: "Submit invoice" }).click();
  await expect(portal.getByLabel("Invoice", { exact: true }).locator(".flowstate")).toContainText("ERP synced, EDI to retailer delivered");

  // The EDI tab shows the SSCCs, the tax subtotals and the passed check.
  await page.getByRole("tab", { name: "Trading Grid outbox" }).click();
  const desadv = page.locator(".edi-card[data-kind=DESADV]");
  await desadv.getByRole("button", { name: "Show message" }).click();
  await expect(desadv.getByLabel("Raw message")).toContainText(/PCI\+33E'\s*GIN\+BJ\+09520000\d{10}'/);
  const invoic = page.locator(".edi-card[data-kind=INVOIC]");
  await expect(invoic.getByLabel("Retailer check")).toContainText("Passed retailer check");
  await invoic.getByRole("button", { name: "Show message" }).click();
  await expect(invoic.getByLabel("Raw message")).toContainText("MOA+77:191.38'");
  await expect(invoic.getByLabel("Raw message")).toContainText("RFF+CT:EDI-AGR-DEMO-1'");
  await page.screenshot({ path: "../docs/screenshots/app-11-edi-compliance.png", fullPage: true });
});
