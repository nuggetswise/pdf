import { expect, test, type Page } from "@playwright/test";

// D71: Order Operations, clicked through the real screens. The sample inbox is fictional and processed by the
// same rules on every load; the downstream ERP is simulated and deterministic.
const shot = (page: Page, name: string) => page.screenshot({ path: `../docs/screenshots/ops-${name}.png`, fullPage: true });
const tile = (page: Page, label: string) => page.getByLabel(new RegExp(`^${label}: \\d+$`));
const attention = (page: Page) => page.getByRole("list", { name: "Orders that need attention" });
const review = (page: Page, po: string) => page.getByRole("button", { name: `Review order ${po}` }).first().click();
const back = (page: Page) => page.getByRole("button", { name: "Back to order operations" }).click();
const history = (page: Page) => page.getByRole("region", { name: "Order history" });
const issue = (page: Page, title: string) => page.getByRole("region", { name: title });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Order operations", selected: true })).toBeVisible();
});

test("home shows operational state first, attention items first, counts from state", async ({ page }) => {
  await expect(tile(page, "Orders received")).toContainText("18");
  await expect(tile(page, "Processed automatically")).toContainText("13");
  await expect(tile(page, "Need review")).toContainText("3");
  await expect(tile(page, "Blocked")).toContainText("1");
  await expect(tile(page, "Rejected by ERP")).toContainText("1");
  const rows = attention(page).getByRole("listitem");
  await expect(rows).toHaveCount(5);
  // Most severe first: ERP rejection, then blocked, then review.
  await expect(rows.nth(0)).toContainText("SG-55134");
  await expect(rows.nth(0)).toContainText("ERP rejection");
  await expect(rows.nth(1)).toContainText("Blocked");
  const done = page.getByRole("region", { name: "Processing normally or completed" });
  await expect(done.locator("tbody tr")).toHaveCount(13);
  await expect(done.locator("[data-po=\"HV-88190\"]")).toContainText("Accepted · SIM-SO-61001");
  await shot(page, "01-home");
});

test("scenario 1: a straight-through order needs no person and shows how it was processed", async ({ page }) => {
  await page.getByRole("button", { name: "View order HV-88190" }).click();
  await expect(page.getByLabel("Order state: Completed automatically")).toBeVisible();
  await expect(page.getByText("Accepted by simulated downstream ERP as SIM-SO-61001.")).toBeVisible();
  const h = history(page);
  for (const t of ["Email received", "identified as a purchase order", "Order fields extracted", "Buyer matched", "Validation completed. All checks passed.",
    "Structured order created", "Sent to simulated ERP", "Accepted by simulated ERP as SIM-SO-61001"]) await expect(h).toContainText(t);
  await expect(h.locator(".ev-person")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Approve|Resend/ })).toHaveCount(0);
});

test("scenario 2: unit recommendation with evidence, accept, undo, accept again and send", async ({ page }) => {
  await review(page, "SG-55120");
  const card = issue(page, "Unit of measure mismatch");
  await expect(card).toContainText("Recommendation available");
  await expect(card.getByLabel("Proposed change")).toContainText("24 CASE");
  await expect(card.getByLabel("Proposed change")).toContainText("24 EA");
  await expect(card).toContainText("Order agent (AI)");
  // Evidence on request, and the source location highlighted in the PDF.
  await expect(card.getByRole("list", { name: "Evidence" })).toHaveCount(0);
  await card.getByRole("button", { name: "View evidence" }).click();
  await expect(card.getByRole("list", { name: "Evidence" })).toContainText("ordered NB-2001 in EA on its last 6 orders");
  await card.getByRole("button", { name: "Show in source" }).click();
  await expect(page.locator(".po-page .hl")).toContainText("CASE");
  await shot(page, "02-unit-recommendation");
  const line1 = page.getByRole("table", { name: "Line 1" });
  await expect(line1.locator("tr[data-field=unit]")).toContainText("Uncertain");

  await card.getByRole("button", { name: "Accept change" }).click();
  await expect(line1.locator("tr[data-field=unit]")).toContainText("Changed");
  await expect(page.getByLabel("Order state: Ready to send")).toBeVisible();
  await expect(history(page).locator(".ev-person")).toContainText("Recommendation accepted");
  await expect(history(page).locator(".ev-person")).toContainText("Alex, operations lead");

  // Undo before sending restores the review state.
  await page.getByRole("region", { name: "Decisions on this order" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Order state: Needs review")).toBeVisible();
  await expect(line1.locator("tr[data-field=unit]")).toContainText("Uncertain");
  await expect(history(page)).toContainText("Decision undone");

  await issue(page, "Unit of measure mismatch").getByRole("button", { name: "Accept change" }).click();
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  await expect(page.getByLabel("Order state: Completed after review")).toBeVisible();
  await expect(page.getByRole("region", { name: "Simulated downstream ERP" })).toContainText("Accepted");
  await expect(page.getByRole("region", { name: "Decisions on this order" }).getByRole("button", { name: "Undo" })).toHaveCount(0);
  await back(page);
  await expect(tile(page, "Need review")).toContainText("2");
  await expect(tile(page, "Completed after review")).toContainText("1");
  await expect(page.locator("[data-po=\"SG-55120\"]")).toContainText("Completed after review");
});

test("scenario 2b: keeping the original unit is recorded and stops the order honestly", async ({ page }) => {
  await review(page, "SG-55120");
  await issue(page, "Unit of measure mismatch").getByRole("button", { name: "Keep original" }).click();
  await expect(issue(page, "Unit cannot be ordered")).toContainText("Validation failed");
  await expect(page.getByLabel("Order state: Needs review")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and send to ERP" })).toHaveCount(0);
  await expect(history(page)).toContainText("Recommendation rejected; original value kept");
});

test("scenario 3: genuine ambiguity needs a selection; validation reruns and the order continues", async ({ page }) => {
  await review(page, "HV-88213");
  const card = issue(page, "Product needs a choice");
  await expect(card).toContainText("Judgement required");
  await expect(card.getByRole("radio")).toHaveCount(2);
  await expect(card).toContainText("330 mL can");
  await expect(card).toContainText("500 mL bottle");
  await expect(card.getByText("Recommended")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Use selected item" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Approve and send to ERP" })).toHaveCount(0);
  await shot(page, "03-ambiguous-product");
  await card.getByRole("radio", { name: /500 mL/ }).check();
  await card.getByRole("button", { name: "Use selected item" }).click();
  await expect(page.getByRole("table", { name: "Line 1" }).locator("tr[data-field=sku]")).toContainText("NB-1002");
  await expect(history(page)).toContainText("Validation rerun. All checks passed.");
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  await expect(page.getByLabel("Order state: Completed after review")).toBeVisible();
});

test("scenario 4: a blocked order cannot be sent and offers no automatic fix", async ({ page }) => {
  await review(page, "PF-7731");
  await expect(page.getByLabel("Order state: Blocked")).toBeVisible();
  const card = issue(page, "Delivery location missing");
  await expect(card).toContainText("Why processing stopped");
  await expect(card).toContainText("no location is proposed");
  await expect(card.getByRole("button", { name: "Accept change" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Approve|Resend/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Simulated downstream ERP" })).toContainText("Blocked orders cannot be sent.");
  await expect(page.locator(".po-page .hl")).toContainText("Not printed");
  await shot(page, "04-blocked");
  await card.getByRole("button", { name: "Mark as waiting on buyer" }).click();
  await expect(page.getByLabel("Order state: Blocked")).toBeVisible();
  await expect(issue(page, "Delivery location missing")).toContainText("Waiting on buyer");
  // The buyer answers: a person enters the confirmed location.
  const c2 = issue(page, "Delivery location missing");
  await c2.getByLabel("Delivery location").selectOption("PF-DC2");
  await expect(c2.getByRole("button", { name: "Use location" })).toBeDisabled();
  await c2.getByLabel("The buyer confirmed this location").check();
  await c2.getByRole("button", { name: "Use location" }).click();
  await expect(history(page)).toContainText("confirmed by the buyer");
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  await expect(page.getByLabel("Order state: Completed after review")).toBeVisible();
});

test("scenario 5: ERP rejection is distinct from validation, corrected and resent", async ({ page }) => {
  await review(page, "SG-55134");
  await expect(page.getByLabel("Order state: Rejected by ERP")).toBeVisible();
  const card = issue(page, "Rejected by simulated ERP");
  await expect(card).toContainText("ERP rejection");
  await expect(card).toContainText("Ship-to SG-DC14 is not active for customer account 40017");
  await expect(history(page)).toContainText("Validation completed. All checks passed.");
  const erp = page.getByRole("region", { name: "Simulated downstream ERP" });
  await expect(erp).toContainText("SHIPTO_INACTIVE");
  await expect(card.getByRole("radio", { name: /SG-DC14N/ })).toBeChecked();
  await shot(page, "05-erp-rejection");
  await card.getByRole("button", { name: "Use selected ship-to" }).click();
  await page.getByRole("button", { name: "Resend to ERP" }).click();
  await expect(page.getByLabel("Order state: Completed after review")).toBeVisible();
  await expect(erp).toContainText("Attempt 2");
  await expect(erp).toContainText("SIM-SO-61012");
  await back(page);
  await expect(tile(page, "Rejected by ERP")).toContainText("0");
});

test("scenario 6: rejecting a price recommendation keeps the printed price and says so", async ({ page }) => {
  await review(page, "LF-20419");
  const card = issue(page, "Price differs from price list");
  await expect(card.getByLabel("Proposed change")).toContainText("18.75");
  await expect(card.getByLabel("Proposed change")).toContainText("18.50");
  await card.getByRole("button", { name: "Keep original" }).click();
  const price = page.getByRole("table", { name: "Line 1" }).locator("tr[data-field=unit_price]");
  await expect(price).toContainText("18.75");
  await expect(price).toContainText("differs from the price list (18.50 USD)");
  await expect(page.getByRole("region", { name: "Decisions on this order" })).toContainText("Original value kept");
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  await expect(page.getByLabel("Order state: Completed after review")).toBeVisible();
  await expect(page.getByRole("region", { name: "Simulated downstream ERP" })).toContainText("1 line(s) · 750.00 USD");
});

test("evidence: switch between PDF and email, history marks each actor", async ({ page }) => {
  await review(page, "PF-7731");
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await expect(page.getByLabel("Original email")).toContainText("Please deliver as usual.");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(page.getByLabel(/PDF PF-7731.pdf/)).toBeVisible();
  const h = history(page);
  await expect(h.locator(".ev-actor-system").first()).toContainText("System");
  await expect(h.locator(".ev-actor-agent").first()).toContainText("AI agent");
  await expect(page.getByText("Simulated system. No live ERP connection.")).toBeVisible();
});

test("Command Center links an order exception to its review and back", async ({ page }) => {
  await page.getByRole("button", { name: "Open Command Center" }).click();
  const list = page.getByRole("region", { name: "Order exceptions" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await list.getByRole("button", { name: "Review order SG-55134" }).click();
  await expect(page.getByLabel("Order state: Rejected by ERP")).toBeVisible();
  await back(page);
  await expect(page.getByRole("tab", { name: "Command Center", selected: true })).toBeVisible();
});

test("narrow screens stack the source and keep the decision first", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await review(page, "SG-55120");
  const decision = await page.getByRole("heading", { name: "Decision required" }).boundingBox();
  const source = await page.getByRole("heading", { name: "Source" }).boundingBox();
  expect(decision!.y).toBeLessThan(source!.y);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
