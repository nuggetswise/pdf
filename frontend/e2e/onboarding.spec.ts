import { expect, test } from "@playwright/test";
import { asRole } from "./helpers";

// D46: a real supplier's first PO from a customer the reference data does not know. The reviewer adds the
// customer and products for this session; the order clears, and a repeat PO from that customer is clean.
// Uses the FICTIONAL fixtures in fixtures/onboarding (scripts/onboarding_fixtures.py) and the TEST ADAPTER.
const PDF = (name: string) => `../fixtures/onboarding/${name}.pdf`;

test("a reviewer onboards an unknown customer and products from a PO", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Orders" }).click();
  await asRole(page, "reviewer");
  const card = (text: string) => page.locator(".issue.open", { hasText: text });

  await page.getByLabel("Upload a purchase order").setInputFiles(PDF("ONBOARD-DEMO-001"));
  await expect(page.locator(".issue.open")).toHaveCount(3);
  await expect(card("Customer not recognised")).toBeVisible();
  await page.screenshot({ path: "../docs/screenshots/app-07-onboarding-held.png", fullPage: true });

  await card("Customer not recognised").getByRole("button", { name: "Add as new customer" }).click();
  await expect(card("Customer not recognised")).toHaveCount(0);
  await expect(page.locator(".issue.open")).toHaveCount(2);

  await card("FICT-GTIN-7001").getByRole("button", { name: "Add to catalogue" }).click();
  await expect(page.locator(".issue.open")).toHaveCount(1);
  await card("FICT-GTIN-7002").getByLabel("Minimum order quantity").fill("5");
  await card("FICT-GTIN-7002").getByRole("button", { name: "Add to catalogue" }).click();
  await expect(page.locator(".issue.open")).toHaveCount(0);
  await expect(page.locator(".allclear")).toBeVisible();
  await page.getByRole("button", { name: "Approve order" }).click();
  await expect(page.locator(".order .erp h3")).toContainText("ERP order SIM-ERP-");

  // The second PO from the same customer: no customer or product issues.
  await page.getByLabel("Upload a purchase order").setInputFiles(PDF("ONBOARD-DEMO-002"));
  await expect(page.locator(".order h3").first()).toContainText("BW-DEMO-5002");
  await expect(page.locator(".allclear")).toBeVisible();
  await expect(page.locator(".order h3").first()).toContainText("SESSION-CUST-01");
  await expect(page.getByRole("button", { name: "Approve order" })).toBeVisible();

  // The additions are visible and labelled on the memory screen.
  await page.getByRole("tab", { name: "Agent memory" }).click();
  const added = page.getByRole("region", { name: "Added in this session" });
  await expect(added).toContainText("Birchwood Demo Market");
  await expect(added).toContainText("FICT-GTIN-7002");
  await expect(added).toContainText("REF-2026-10-v1 + session additions");
  await expect(added).toContainText("rita");
  await page.screenshot({ path: "../docs/screenshots/app-08-session-additions.png", fullPage: true });
});
