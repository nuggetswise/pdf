import { expect, test } from "@playwright/test";

// At phone width every tab fits the screen: no sideways scrolling of the page.
test("every tab fits a 390 px screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /Receive sample email .*104633/ }).click();
  const fits = async (name: string) => {
    const w = await page.evaluate(() => document.scrollingElement!.scrollWidth);
    expect(w, `${name} is ${w}px wide`).toBeLessThanOrEqual(391);
  };
  for (const t of ["Orders", "Transactions", "Command Center", "Rules", "Settings"]) {
    await page.getByRole("tab", { name: t }).click();
    await fits(t);
  }
  await page.getByRole("tab", { name: "Orders" }).click();
  await page.getByRole("button", { name: "Review order PO-2026-104633" }).click();
  await fits("order review");
  await page.screenshot({ path: "../docs/screenshots/18-phone-order-review.png", fullPage: true });
});
