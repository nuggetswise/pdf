import { expect, test } from "@playwright/test";

test("forwarded email is processed automatically and shows evidence", async ({ page, request }) => {
  await request.post("/api/demo/reset", { headers: { "X-Demo-Role": "administrator", "X-Demo-User": "alex" } });
  await page.goto("/");
  await expect(page.getByText("Rehearsal: TEST ADAPTER (not AI)")).toBeVisible();
  await page.getByRole("tab", { name: "Inbox & review" }).click();
  await expect(page.getByText("No orders yet")).toBeVisible();

  await page.getByLabel("Sample purchase order").selectOption("VIDEO-DEMO-001");
  await page.getByRole("button", { name: "Open sample" }).click();

  // No Extract button: processing runs through matching and validation on its own.
  await expect(page.locator(".issue")).toHaveCount(3);
  await expect(page.getByText("TEST ADAPTER (fixture parser, not AI extraction)").first()).toBeVisible();
  await expect(page.getByText("Read by AI")).toHaveCount(0);
  await expect(page.locator(".pl.hl").first()).toBeVisible(); // evidence highlighted in PDF text
  await expect(page.locator(".totals")).toContainText("190.00");
  await page.screenshot({ path: "../docs/screenshots/slice2-inbox.png", fullPage: true });

  // Identical file again is flagged as a duplicate, not reprocessed.
  await page.getByRole("button", { name: "Open sample" }).click();
  await expect(page.locator(".mail").first()).toContainText("Duplicate file");
});
