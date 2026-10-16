import { expect, test } from "@playwright/test";
import { asRole } from "./helpers";

// The whole story through the real app, as a user would click it (replaces the guided demo): upload a PDF,
// exception review, automatic delivery, Exception-only mode, agent memory reuse and scope, revocation,
// Review-all approval, and a safe retry after an ERP timeout. TEST ADAPTER only; never presented as AI.
const PDF = (name: string) => `../fixtures/demo/generated/${name}.pdf`;

test("a user runs the order desk end to end", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Supplier and retailer", selected: true })).toBeVisible();
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await expect(page.getByRole("tab", { name: "Guided demo" })).toHaveCount(0);
  const role = (r: "administrator" | "reviewer" | "viewer") => asRole(page, r);
  const card = (title: string) => page.locator(".issue", { hasText: title });
  const upload = (name: string) => page.getByLabel("Upload a purchase order").setInputFiles(PDF(name));

  // Administrator switches on Exception-only.
  await role("administrator");
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Automation mode").selectOption("exception_only");
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await expect(page.locator(".mode")).toHaveText("Exception-only mode");

  // A reviewer uploads a PDF; three exceptions are held, resolved, and the order goes to the ERP by itself.
  await role("reviewer");
  await upload("VIDEO-DEMO-001");
  await expect(page.locator(".issue.open")).toHaveCount(3);
  await expect(page.locator(".mail").first()).toContainText("VIDEO-DEMO-001.pdf");
  // Act 1 (D49): what retyping this PDF would have cost, from the errors the agent caught.
  const manual = page.getByRole("region", { name: "If you retyped this order" });
  await expect(manual).toContainText("30");
  await expect(manual).toContainText("USD 54.38");
  await expect(card("Price differs")).toContainText("Manual route: USD 4.00 at risk.");
  // The agent's own steps, from this run's data, beside the manual cost; the maths is one click away.
  const work = page.getByRole("region", { name: "What the Order Agent did" });
  await expect(work).toContainText("found 3 problems");
  await expect(work).toContainText("0 fields typed by hand, instead of 30");
  await manual.getByRole("button", { name: "Show the maths" }).click();
  await expect(manual).toContainText("30 fields × 20 s = 10.0 min");
  await page.screenshot({ path: "../docs/screenshots/app-00-manual-route-cost.png", fullPage: true });
  await card("Below minimum order quantity").getByLabel("Reason").fill("Trial quantity agreed (fictional)");
  await card("Below minimum order quantity").getByRole("button", { name: "Allow once (one-off exception)" }).click();
  await card("Price differs").getByLabel("Reason").fill("Promotion (fictional)");
  await card("Price differs").getByRole("button", { name: "Accept printed price" }).click();
  await card("Outdated GTIN").getByRole("button", { name: "Apply replacement GTIN" }).click();
  await expect(page.locator(".order .erp h3")).toContainText("ERP order SIM-ERP-");
  await page.screenshot({ path: "../docs/screenshots/app-01-upload-reviewed-delivered.png", fullPage: true });

  // Administrator activates what was learned.
  await role("administrator");
  await page.getByRole("tab", { name: "Agent memory" }).click();
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.locator(".rule.active")).toHaveCount(1);

  // Same customer, same retired code: fixed by memory and delivered with no human touch.
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await upload("VIDEO-DEMO-002");
  await expect(page.locator(".pill.memory")).toBeVisible();
  await expect(page.locator(".provenance.memory_rule")).toContainText("alex");
  await expect(page.locator(".order .erp h3")).toContainText("SIM-ERP-");
  await page.screenshot({ path: "../docs/screenshots/app-02-memory-reuse.png", fullPage: true });

  // Another customer: the rule does not apply, so the order is held.
  await upload("VIDEO-DEMO-003");
  await expect(page.locator(".issue.open")).toHaveCount(1);

  // Revoked rule: the next Northfield order is held again.
  await page.getByRole("tab", { name: "Agent memory" }).click();
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.locator(".rule.revoked")).toHaveCount(1);
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await upload("VIDEO-DEMO-004");
  await expect(page.locator(".issue.open")).toHaveCount(1);

  // Review-all: a clean order waits; one approval sends it; the ERP times out; a safe retry reconciles.
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Automation mode").selectOption("review_all");
  await page.getByLabel("ERP simulator next call").selectOption("timeout_next");
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await upload("VIDEO-DEMO-005");
  await expect(page.locator(".approve")).toBeVisible();
  await role("reviewer");
  await page.getByRole("button", { name: "Approve order" }).click();
  await expect(page.locator(".order .erp")).toContainText("Outcome unknown");
  await page.getByRole("button", { name: "Check ERP and retry safely" }).click();
  await expect(page.locator(".order .erp")).toContainText("Reconciled");
  await expect(page.getByRole("button", { name: /^Send/ })).toHaveCount(0);

  // The same file again is a duplicate, not a second order.
  await upload("VIDEO-DEMO-005");
  await expect(page.locator(".mail").first()).toContainText("Duplicate file");
  await page.getByRole("tab", { name: "ERP records" }).click();
  await expect(page.locator(".erp-card")).toHaveCount(3);
  await page.screenshot({ path: "../docs/screenshots/app-03-erp-records.png", fullPage: true });

  const kpi = (i: number) => page.locator(".kpi b").nth(i);
  await expect(kpi(0)).toHaveText("6");
  await expect(kpi(1)).toHaveText("3");
  await expect(kpi(2)).toHaveText("2");
});

test("a file that is not a PDF is refused with a reason", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await page.getByLabel("Upload a purchase order").setInputFiles({ name: "order.pdf", mimeType: "application/pdf",
    buffer: Buffer.from("not really a pdf") });
  await expect(page.locator(".main > .alert.bad")).toContainText("Attachment is not a PDF");
  await expect(page.getByText("No orders yet")).toBeVisible();
});
