import { expect, test, type Page } from "@playwright/test";

// D74: the five-order demo through the real screens. Each email is read by the same path as any forwarded order
// (TEST ADAPTER here, never shown as AI). Supplier policy and supervision are set in Rules; a revised PO updates
// the order the ERP already holds. ERP and EDI are simulated.
const shot = (page: Page, name: string) => page.screenshot({ path: `../docs/screenshots/five-${name}.png`, fullPage: true });
const inbox = (page: Page) => page.getByRole("list", { name: "Supplier inbox" });
const forward = (page: Page, label: string) => inbox(page).getByRole("button", { name: `Forward ${label}`, exact: true }).click();
const tile = (page: Page, label: string) => page.getByLabel(new RegExp(`^${label}: \\d+$`));
const row = (page: Page, po: string) => page.locator(`[data-po="${po}"]`);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Orders", exact: true, selected: true })).toBeVisible();
});

test("the inbox holds five fictional emails and nothing is hardcoded into the queue", async ({ page }) => {
  await expect(inbox(page).getByRole("listitem")).toHaveCount(5);
  await expect(tile(page, "Orders received")).toContainText("0");
  await expect(page.getByText("No orders yet. Forward one from the inbox.")).toBeVisible();
  await shot(page, "01-inbox");
});

test("policy, supervision, an automatic order, a revision that updates the same ERP order", async ({ page }) => {
  test.setTimeout(120_000);
  // Rules: a price policy for Northfield, then automatic processing for its emailed orders.
  await page.getByRole("tab", { name: "Rules" }).click();
  const policies = page.getByRole("region", { name: "Order policies" });
  await expect(policies).toContainText("No order policies.");
  await policies.getByRole("button", { name: "Add policy" }).click();
  await policies.getByLabel("Customer").selectOption({ label: "Northfield Demo Retail" });
  await policies.getByLabel("Accept when within (%)").fill("10");
  await policies.getByLabel("Effective from").fill("2026-01-01");
  await policies.getByRole("button", { name: "Save policy" }).click();
  await expect(page.locator(".alert.bad")).toContainText("Enter the reason for this policy");
  await policies.getByLabel("Reason").fill("Promotional prices within 10% are accepted (fictional)");
  await policies.getByRole("button", { name: "Save policy" }).click();
  await expect(policies.locator("tbody tr")).toHaveCount(1);
  await expect(policies).toContainText("P-1");
  const route = page.locator(".supervision tr", { hasText: "Northfield Demo Retail" }).filter({ hasText: "Email attachment" });
  await route.getByRole("button", { name: "Change" }).click();
  await route.getByRole("combobox").selectOption("exception_only");
  await route.getByLabel("Reason for automatic processing").fill("Pilot evidence reviewed (fictional)");
  await route.getByRole("button", { name: "Save" }).click();
  await expect(route).toContainText("Automatic when checks pass");
  await shot(page, "02-rules");

  // VIDEO-DEMO-001: the policy settles the price; two checks still need a person, with context.
  await page.getByRole("tab", { name: "Orders", exact: true }).click();
  await forward(page, "Northfield Demo Retail · VIDEO-DEMO-001");
  const r1 = row(page, "VIDEO-DEMO-001");
  await expect(r1).toContainText("Decision needed");
  await expect(r1).toContainText("Order value");
  await expect(r1).toContainText("Requested delivery");
  await expect(r1).toContainText("(+1 more)");
  await expect(policies).toHaveCount(0);
  await shot(page, "03-exception-context");
  await r1.getByRole("button", { name: "Review order VIDEO-DEMO-001" }).click();
  await expect(page.getByRole("region", { name: "Decisions on this order" })).toContainText("by order policy P-1");
  const life = page.getByRole("navigation", { name: "Order lifecycle" });
  await expect(life).toContainText("Next: Decide the open checks");
  await expect(life.getByRole("button", { name: /Confirmed \(855\)/ })).toBeVisible();
  await page.getByRole("button", { name: "Back to orders" }).click();

  // VIDEO-DEMO-005: clean, automatic. Filter tiles narrow the lists.
  await forward(page, "Northfield Demo Retail · VIDEO-DEMO-005");
  await expect(row(page, "VIDEO-DEMO-005").first()).toContainText("Completed automatically");
  await tile(page, "Processed automatically").click();
  await expect(tile(page, "Processed automatically")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("list", { name: "Orders that need attention" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show all" }).click();

  // VIDEO-DEMO-006: same PO number, new quantity. Held as a revision; accepting it updates the same ERP order.
  await forward(page, "Northfield Demo Retail · VIDEO-DEMO-005, revision 2");
  const rev = page.getByRole("list", { name: "Orders that need attention" }).locator('[data-po="VIDEO-DEMO-005"]');
  await expect(rev).toContainText("Accept as a revision of the earlier order, or reject");
  await rev.getByRole("button", { name: "Review order VIDEO-DEMO-005" }).click();
  const card = page.getByRole("region", { name: "Same customer and PO already received" });
  await card.getByLabel("Reason").fill("Buyer sent revision 2 (fictional)");
  await card.getByRole("button", { name: "Accept as revision" }).click();
  // VIDEO-DEMO-005 revision 1 went to the ERP as SIM-ERP-100001; revision 2 updates that order.
  await expect(page.locator(".outcome")).toContainText("Accepted by your ERP as SIM-ERP-100001");
  await expect(page.getByRole("navigation", { name: "Order lifecycle" })).toContainText("Next: Create the ship notice (ASN)");
  await shot(page, "04-revision");
  await page.getByRole("tab", { name: "Sent" }).click();
  await expect(page.getByText("SIM-ERP-100002")).toHaveCount(0);
});

test("phone width: no screen scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fits = async (where: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth), where).toBeLessThanOrEqual(390);
  await fits("home");
  await forward(page, "Northfield Demo Retail · VIDEO-DEMO-001");
  await row(page, "VIDEO-DEMO-001").getByRole("button", { name: "Review order VIDEO-DEMO-001" }).click();
  await fits("review");
  for (const t of ["Command Center", "Sent", "Rules", "Settings"]) { await page.getByRole("tab", { name: t }).click(); await fits(t); }
  await page.getByRole("button", { name: "Retailer", exact: true }).click();
  for (const t of ["Documents received", "Suppliers", "Command Center"]) { await page.getByRole("tab", { name: t }).click(); await fits(`retailer ${t}`); }
});
