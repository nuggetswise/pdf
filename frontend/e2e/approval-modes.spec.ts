import { expect, test } from "@playwright/test";
import { asRole } from "./helpers";

// Review all and Automatic when checks pass (P22 to P24). A failed check stops an order in both modes.
test("an administrator turns on automatic processing with a reason; a clean order then reaches the ERP alone", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Review all", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Change" }).first().click();
  await page.getByLabel("Default approval mode").selectOption("exception_only");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".alert.bad")).toContainText("reason");
  await page.getByLabel("Reason for automatic processing").fill("First month of clean Maple orders reviewed");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Default:").locator("..")).toContainText("Automatic when checks pass");

  await page.getByRole("tab", { name: "Orders" }).click();
  await expect(page.getByRole("button", { name: /Approval mode: Automatic when checks pass/ })).toBeVisible();
  await page.getByRole("button", { name: /Receive sample email .*104620/ }).click();
  await expect(page.locator("tr[data-po='PO-2026-104620']")).toContainText("Done automatically");
  await expect(page.locator("tr[data-po='PO-2026-104620']")).toContainText("SIM-ERP-100001");

  // The cheese PO fails a check, so it still waits for a person.
  await page.getByRole("button", { name: /Receive sample email .*104633/ }).click();
  await expect(page.getByRole("button", { name: "Review order PO-2026-104633" })).toBeVisible();
  await page.screenshot({ path: "../docs/screenshots/14-automatic-mode.png", fullPage: true });
});

test("a viewer can read the approval mode but not change it", async ({ page }) => {
  await page.goto("/");
  await asRole(page, "viewer");
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByText("Only an administrator can change them.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change" })).toHaveCount(0);
});

test("an order that needs review records a notification, and none once notifications are off", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Receive sample email .*104633/ }).click();
  await page.getByRole("button", { name: "Review order PO-2026-104633" }).click();
  await expect(page.locator(".timeline")).toContainText("Review notification sent (test)");
});

test("with notifications off no review notification is recorded", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Tell me when an order needs review").click();
  await expect(page.getByLabel("Tell me when an order needs review")).not.toBeChecked();
  await page.getByRole("tab", { name: "Orders" }).click();
  await page.getByRole("button", { name: /Receive sample email .*104633/ }).click();
  await page.getByRole("button", { name: "Review order PO-2026-104633" }).click();
  await expect(page.locator(".timeline")).toContainText("Waiting for a decision");
  await expect(page.locator(".timeline")).not.toContainText("Review notification");
});
