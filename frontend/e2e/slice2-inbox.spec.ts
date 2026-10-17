import { expect, test } from "@playwright/test";

test("forwarded email is processed automatically and shows evidence", async ({ page, request }) => {
  await request.post("/api/demo/reset", { headers: { "X-Demo-Role": "administrator", "X-Demo-User": "alex" } });
  await page.goto("/");
  await page.getByRole("tab", { name: "Orders" }).click();
  await expect(page.getByText("Rehearsal: TEST ADAPTER (not AI)")).toBeVisible();
  await page.getByRole("tab", { name: "Orders" }).click();
  await expect(page.getByText("No orders yet")).toBeVisible();

  await page.getByLabel("Upload a purchase order").setInputFiles("../fixtures/demo/generated/VIDEO-DEMO-001.pdf");

  // No Extract button: processing runs through matching and validation on its own.
  await expect(page.locator("article.issue")).toHaveCount(3);
  await expect(page.getByText("TEST ADAPTER (fixture parser, not AI extraction)").first()).toBeVisible();
  await expect(page.getByText("Read by AI")).toHaveCount(0);
  await expect(page.locator(".vbox.issue").first()).toBeVisible(); // each held value boxed on the PDF page
  await expect(page.locator(".totals")).toContainText("190.00");
  await page.screenshot({ path: "../docs/screenshots/slice2-inbox.png", fullPage: true });

  // Identical file again is flagged as a duplicate, not reprocessed.
  await page.getByLabel("Upload a purchase order").setInputFiles("../fixtures/demo/generated/VIDEO-DEMO-001.pdf");
  await expect(page.locator(".mail").first()).toContainText("Duplicate");
});
