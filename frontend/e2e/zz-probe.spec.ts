import { expect, test } from "@playwright/test";
const S = "/tmp/claude-0/probe/";
test("probe", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:3200/");
  await page.screenshot({ path: S + "01-today.png", fullPage: true });
  const forward = page.getByRole("region", { name: "Forward a purchase order" });
  await forward.getByRole("button", { name: "Forward to agent" }).click();
  const card = page.getByRole("article", { name: /Order PO-2026-104587/ });
  await expect(card).toContainText("waiting for one approval");
  await page.screenshot({ path: S + "02-after-forward.png", fullPage: true });
  // forward again -> duplicate?
  await forward.getByRole("button", { name: "Forward to agent" }).click().catch(()=>{});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: S + "03-forward-again.png", fullPage: true });
  await card.first().getByRole("button", { name: "Open order" }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: S + "04-order.png", fullPage: true });
  // email without pdf
  const eml = "From: buyer@x.example\r\nTo: a@b\r\nSubject: PO 555\r\nMessage-ID: <x1@x>\r\nDate: Thu, 15 Oct 2026 10:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nPlease ship 10 cases of NF-CRK-001 to store 12 by 03/04/2026.\r\n";
  await page.getByRole("tab", { name: "Orders" }).click();
  const input = page.locator('input[type=file]').first();
  await input.setInputFiles({ name: "body.eml", mimeType: "message/rfc822", buffer: Buffer.from(eml) });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: S + "05-body-eml.png", fullPage: true });
  console.log("BODY:", (await page.locator("[role=alert], .alert").allInnerTexts()).join(" | "));
  await page.getByRole("button", { name: "Retailer", exact: true }).click();
  await page.screenshot({ path: S + "06-retailer.png", fullPage: true });
  await page.getByRole("tab", { name: "Suppliers" }).click();
  await page.screenshot({ path: S + "07-retailer-suppliers.png", fullPage: true });
});
