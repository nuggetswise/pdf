import { expect, test } from "@playwright/test";
import { asRole } from "./helpers";

const ADMIN = { "X-Demo-Role": "administrator", "X-Demo-User": "alex" };

test("reviewer resolves exceptions by hand and the order is delivered without a Send click", async ({ page, request }) => {
  await request.post("/api/demo/reset", { headers: ADMIN });
  await request.put("/api/demo/rehearsal-mode", { headers: ADMIN, data: { value: "on" } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await page.getByLabel("Sample purchase order").selectOption("VIDEO-DEMO-001");
  await page.getByRole("button", { name: "Open sample" }).click();
  await expect(page.locator(".issue.open")).toHaveCount(3);

  // Viewer cannot act.
  await asRole(page, "viewer");
  await expect(page.locator(".decide")).toHaveCount(0);
  await asRole(page, "reviewer");

  const card = (title: string) => page.locator(".issue", { hasText: title });
  // A reason is required: the backend refuses and the UI shows why.
  await card("Below minimum order quantity").getByRole("button", { name: "Allow once (one-off exception)" }).click();
  await expect(page.locator(".main > .alert.bad")).toContainText("reason is required");
  await card("Below minimum order quantity").getByLabel("Reason").fill("Trial quantity agreed (fictional)");
  await card("Below minimum order quantity").getByRole("button", { name: "Allow once (one-off exception)" }).click();
  await card("Price differs").getByLabel("Reason").fill("Promotion (fictional)");
  await card("Price differs").getByRole("button", { name: "Accept printed price" }).click();
  await card("Outdated GTIN").getByRole("button", { name: "Apply replacement GTIN" }).click();

  await expect(page.locator(".issue.resolved")).toHaveCount(3);
  await expect(page.locator(".order .erp h3")).toContainText("ERP order SIM-ERP-");
  await expect(page.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  await page.screenshot({ path: "../docs/screenshots/manual-review-delivered.png", fullPage: true });

  // Reviewer sees the candidate rule but cannot activate it; administrator can.
  await page.getByRole("tab", { name: "Agent memory" }).click();
  await expect(page.locator(".rule.candidate")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Activate" })).toHaveCount(0);
  await asRole(page, "administrator");
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.locator(".rule.active")).toHaveCount(1);
  await page.screenshot({ path: "../docs/screenshots/memory-active.png", fullPage: true });
});
