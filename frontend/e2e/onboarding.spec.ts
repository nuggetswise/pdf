import { expect, test } from "@playwright/test";
import { asRole } from "./helpers";

// D46: a PO from a retailer your ERP does not list yet (Birchwood Test Market, made up). The reviewer adds the
// retailer and items for this session; the order clears, and a repeat PO from it is clean.
const PDF = (name: string) => `../fixtures/onboarding/${name}.pdf`;

test("a reviewer adds an unknown retailer and items from a PO", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await asRole(page, "reviewer");
  const card = (text: string) => page.locator("section.issue-card", { hasText: text });

  await page.getByLabel("Add a document").setInputFiles(PDF("ONBOARD-01"));
  await page.getByRole("button", { name: "Review order BW-TEST-5001" }).click();
  await expect(page.locator("section.issue-card")).toHaveCount(3);
  await expect(card("Customer not recognised")).toBeVisible();
  await page.screenshot({ path: "../docs/screenshots/15-onboarding-held.png", fullPage: true });

  await card("Customer not recognised").getByRole("button", { name: "Add as new customer" }).click();
  await expect(page.locator("section.issue-card")).toHaveCount(2);
  await card("FICT-GTIN-7001").getByRole("button", { name: "Add to catalogue" }).click();
  await expect(page.locator("section.issue-card")).toHaveCount(1);
  await card("FICT-GTIN-7002").getByLabel("Minimum order quantity").fill("5");
  await card("FICT-GTIN-7002").getByRole("button", { name: "Add to catalogue" }).click();
  await expect(page.locator("section.issue-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  await expect(page.locator(".outcome")).toContainText("Accepted by your ERP as SIM-ERP-");

  await page.getByRole("button", { name: /Back to orders/ }).click();
  await page.getByLabel("Add a document").setInputFiles(PDF("ONBOARD-02"));
  await page.getByRole("button", { name: "Review order BW-TEST-5002" }).click().catch(() => {});
  await expect(page.getByRole("button", { name: "Approve and send to ERP" })).toBeVisible();

  await page.getByRole("tab", { name: "Rules" }).click();
  const added = page.getByRole("region", { name: "Added while reviewing" });
  await expect(added).toContainText("Birchwood Test Market Ltd.");
  await expect(added).toContainText("FICT-GTIN-7002");
  await expect(added).toContainText("REF-2026-10-v1 plus additions");
  await page.screenshot({ path: "../docs/screenshots/16-added-while-reviewing.png", fullPage: true });
});
