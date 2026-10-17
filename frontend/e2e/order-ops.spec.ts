import { expect, test, type Page } from "@playwright/test";

// D71: Order Operations, clicked through the real screens. The sample inbox is fictional and processed by the
// same rules on every load; the downstream ERP is simulated and deterministic.
const shot = (page: Page, name: string) => page.screenshot({ path: `../docs/screenshots/ops-${name}.png`, fullPage: true });
const tile = (page: Page, label: string) => page.getByLabel(new RegExp(`^${label}: \\d+$`));
const attention = (page: Page) => page.getByRole("list", { name: "Orders that need attention" });
const review = (page: Page, po: string) => page.getByRole("button", { name: `Review order ${po}` }).first().click();
const back = (page: Page) => page.getByRole("button", { name: "Back to orders" }).click();
const history = (page: Page) => page.getByRole("region", { name: "Order history" });
const issue = (page: Page, title: string) => page.getByRole("region", { name: title });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Orders", exact: true, selected: true })).toBeVisible();
});

test("home shows operational state first, attention items first, counts from state", async ({ page }) => {
  await expect(page.getByText("AI reads uploaded and forwarded documents into fields. Rules check every order. People decide exceptions.")).toBeVisible();
  await expect(tile(page, "Orders received")).toContainText("18");
  await expect(tile(page, "Processed automatically")).toContainText("14");
  await expect(tile(page, "Need review")).toContainText("3");
  await expect(tile(page, "Blocked")).toContainText("0");
  await expect(tile(page, "Declined by ERP")).toContainText("1");
  const rows = attention(page).getByRole("listitem");
  await expect(rows).toHaveCount(4);
  // Most severe first: the ERP response, then review.
  await expect(rows.nth(0)).toContainText("SG-55134");
  await expect(rows.nth(0)).toContainText("ERP response");
  const done = page.getByRole("region", { name: "Processing normally or completed" });
  await expect(done.locator("tbody tr")).toHaveCount(14);
  await expect(done.locator("[data-po=\"HV-88190\"]")).toContainText("Accepted · SIM-SO-61001");
  await shot(page, "01-home");
});

test("scenario 1: a straight-through order needs no person and shows how it was processed", async ({ page }) => {
  await page.getByRole("button", { name: "View order HV-88190" }).click();
  await expect(page.getByLabel("Order state: Completed automatically")).toBeVisible();
  await expect(page.locator(".chips")).toContainText("Read by: sample data, not AI");
  await expect(page.locator(".outcome").getByText("Accepted by your ERP as SIM-SO-61001.")).toBeVisible();
  const h = history(page);
  for (const t of ["Email received", "identified as a purchase order", "Sample order loaded", "not read by AI", "Buyer matched", "Validation completed. All checks passed.",
    "Structured order created", "Sent to your ERP (simulated)", "Accepted by your ERP as SIM-SO-61001"]) await expect(h).toContainText(t);
  await expect(h.locator(".ev-person")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Approve|Resend/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "What Harborview Markets receives" })).toContainText("order accepted as printed");
});

test("scenario 2: a date inside lead time; confirm the earliest date, undo, confirm again and send", async ({ page }) => {
  await review(page, "SG-55120");
  const card = issue(page, "Requested date is inside lead time");
  await expect(card).toContainText("Resolved by");
  await expect(card).toContainText("Planning");
  await expect(card).toContainText("Rule R8");
  await expect(card.getByLabel("Proposed change")).toContainText("2026-10-23");
  await expect(card.getByLabel("Proposed change")).toContainText("2026-10-26");
  await expect(card).toContainText("Recommendation · Rule R8");
  await expect(card.getByRole("list", { name: "Evidence" })).toHaveCount(0);
  await card.getByRole("button", { name: "View evidence" }).click();
  await expect(card.getByRole("list", { name: "Evidence" })).toContainText("Lead time 10 days for NB-3001");
  const buyer = page.getByRole("region", { name: "What Summit Grocers receives" });
  await expect(buyer).toContainText("Nothing yet");
  await shot(page, "02-lead-time");
  const date = page.locator("tr[data-field=delivery_date]");
  await expect(date).toContainText("Uncertain");

  await card.getByRole("button", { name: "Confirm proposed date" }).click();
  await expect(date).toContainText("Changed");
  await expect(page.getByLabel("Order state: Ready to send")).toBeVisible();
  await expect(buyer).toContainText("On sending: delivery date confirmed as 2026-10-26 (PO shows 2026-10-23)");
  await expect(history(page).locator(".ev-person")).toContainText("Recommendation accepted");

  await page.getByRole("region", { name: "Decisions on this order" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Order state: Needs review")).toBeVisible();
  await expect(history(page)).toContainText("Decision undone");

  await issue(page, "Requested date is inside lead time").getByRole("button", { name: "Confirm proposed date" }).click();
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  await expect(page.getByLabel("Order state: Completed after review")).toBeVisible();
  await expect(buyer).toContainText("Acknowledgement sent: delivery date confirmed as 2026-10-26");
  await expect(page.getByRole("region", { name: "Decisions on this order" }).getByRole("button", { name: "Undo" })).toHaveCount(0);
  await back(page);
  await expect(tile(page, "Need review")).toContainText("2");
  await expect(tile(page, "Completed after review")).toContainText("1");
});

test("scenario 3: a revised PO updates the existing ERP order and makes no second order", async ({ page }) => {
  await review(page, "HV-88220");
  await expect(page.locator(".chips")).toContainText("Revision 2");
  const card = issue(page, "Revised PO received");
  await expect(card).toContainText("Rule R9");
  await expect(card.getByLabel("Proposed change")).toContainText("Revision 1");
  await expect(card.getByLabel("Proposed change")).toContainText("48");
  await expect(card.getByLabel("Proposed change")).toContainText("60");
  await expect(card).toContainText("Your ERP holds revision 1 as SIM-SO-61014");
  await shot(page, "03-revision");
  await card.getByRole("button", { name: "Apply revision" }).click();
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  const erp = page.getByRole("region", { name: "Your ERP (simulated)" });
  await expect(erp).toContainText("UPDATED: Sales order SIM-SO-61014 updated.");
  await expect(page.getByRole("region", { name: "What Harborview Markets receives" })).toContainText("revision 2 of HV-88220 accepted");
});

test("scenario 4: an order using the previous price list; keeping the printed price is recorded", async ({ page }) => {
  await review(page, "LF-20419");
  const card = issue(page, "Order uses the previous price list");
  await expect(card).toContainText("Pricing");
  await expect(card.getByLabel("Proposed change")).toContainText("18.75");
  await expect(card.getByLabel("Proposed change")).toContainText("18.50");
  await card.getByRole("button", { name: "Keep original" }).click();
  const price = page.getByRole("table", { name: "Line 1" }).locator("tr[data-field=unit_price]");
  await expect(price).toContainText("18.75");
  await expect(price).toContainText("differs from the price list (18.50 USD)");
  await expect(page.getByRole("region", { name: "Decisions on this order" })).toContainText("Original value kept");
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  await expect(page.getByLabel("Order state: Completed after review")).toBeVisible();
  await expect(page.getByRole("region", { name: "Your ERP (simulated)" })).toContainText("1 line(s) · 750.00 USD");
});

test("scenario 5: a ship-to retired in your ERP is corrected and resent", async ({ page }) => {
  await review(page, "SG-55134");
  await expect(page.getByLabel("Order state: Declined by ERP")).toBeVisible();
  const card = issue(page, "ERP declined the ship-to");
  await expect(card).toContainText("ERP master data");
  await expect(card).toContainText("Ship-to SG-DC14 is not active for customer account 40017");
  await expect(history(page)).toContainText("Validation completed. All checks passed.");
  const erp = page.getByRole("region", { name: "Your ERP (simulated)" });
  await expect(erp).toContainText("SHIPTO_INACTIVE");
  await expect(erp).toContainText("Your ERP, using its own checks such as active ship-to codes in its customer master.");
  await expect(card.getByRole("radio", { name: /SG-DC14N/ })).toBeChecked();
  await shot(page, "05-erp-rejection");
  await card.getByRole("button", { name: "Use selected ship-to" }).click();
  await page.getByRole("button", { name: "Resend to ERP" }).click();
  await expect(page.getByLabel("Order state: Completed after review")).toBeVisible();
  await expect(erp).toContainText("Attempt 2");
  await expect(erp).toContainText("SIM-SO-61012");
  await back(page);
  await expect(tile(page, "Declined by ERP")).toContainText("0");
});

test("evidence: switch between PDF and email, history marks each actor", async ({ page }) => {
  await review(page, "HV-88220");
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await expect(page.getByLabel("Original email")).toContainText("Please replace PO HV-88220");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(page.getByLabel(/PDF HV-88220.pdf/)).toBeVisible();
  const h = history(page);
  await expect(h.locator(".ev-actor-system").first()).toContainText("System");
  await expect(h.locator(".ev-actor-agent").first()).toContainText("Order agent (rules)");
  await expect(page.getByText("Simulated system. No live ERP connection.")).toBeVisible();
});

test("Rules lists every order check and document check", async ({ page }) => {
  await page.getByRole("tab", { name: "Rules" }).click();
  const order = page.getByRole("region", { name: "Order checks" });
  await expect(order.locator("tbody tr")).toHaveCount(9);
  await expect(order).toContainText("The requested delivery date allows the lead time of every item on the order.");
  await expect(page.getByRole("region", { name: "Document checks" }).locator("tbody tr")).toHaveCount(17);
  await expect(page.getByText("Fictional reference data.")).toBeVisible();
  await shot(page, "10-rules");
});

test("Command Center links an order exception to its review and back", async ({ page }) => {
  await page.getByRole("button", { name: "Open Command Center" }).click();
  const list = page.getByRole("region", { name: "Order exceptions" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await list.getByRole("button", { name: "Review order SG-55134" }).click();
  await expect(page.getByLabel("Order state: Declined by ERP")).toBeVisible();
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

// D72: every screen fits a phone. Measured, not eyeballed: the page never scrolls sideways.
test("phone width: no screen scrolls sideways", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const fits = async (where: string) => {
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(w, where).toBeLessThanOrEqual(390);
  };
  await fits("home");
  for (const po of ["SG-55134", "SG-55120", "HV-88220", "LF-20419"]) {
    await review(page, po);
    await fits(`review ${po}`);
    await back(page);
  }
  await page.getByRole("region", { name: "Forward a purchase order" }).getByRole("button", { name: "Forward to agent" }).click();
  await page.locator("[data-po=\"PO-2026-104587\"]").getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Structured order" })).toBeVisible();
  await fits("forwarded order review");
  for (const t of ["Command Center", "Sent", "Rules", "Settings"]) {
    await page.getByRole("tab", { name: t }).click();
    await fits(t);
  }
  await page.getByRole("button", { name: "Retailer", exact: true }).click();
  for (const t of ["Documents received", "Suppliers", "Command Center"]) {
    await page.getByRole("tab", { name: t }).click();
    await fits(`retailer ${t}`);
  }
});

// D72: a forwarded order opens in the same review as the sample inbox and one approval sends it.
test("a forwarded order opens in the order review with field states and your ERP", async ({ page }) => {
  await page.getByRole("region", { name: "Forward a purchase order" }).getByRole("button", { name: "Forward to agent" }).click();
  await page.locator("[data-po=\"PO-2026-104587\"]").getByRole("button").click();
  await expect(page.getByLabel("Order state: Ready to send")).toBeVisible();
  await expect(page.locator(".pdfpage img")).toBeVisible();
  await expect(page.locator("tr[data-field=po_number]")).toContainText("Accepted");
  const erp = page.getByRole("region", { name: "Your ERP (simulated)" });
  await expect(erp).toContainText("Not sent. Sending starts after approval.");
  await page.getByRole("button", { name: "Approve and send to ERP" }).click();
  await expect(page.locator(".outcome")).toContainText("Accepted by your ERP as SIM-ERP-");
  await expect(page.getByRole("region", { name: "Stock and ship date" })).toBeVisible();
  const h = history(page);
  await expect(h.locator(".ev-person").first()).toContainText("Approved");
  await expect(h.locator(".ev-erp")).toContainText("Accepted by your ERP as SIM-ERP-");
  await shot(page, "09-forwarded-review");
  await page.getByRole("button", { name: "View document" }).click();
  await expect(page.getByRole("heading", { name: "All documents" })).toBeVisible();
});
