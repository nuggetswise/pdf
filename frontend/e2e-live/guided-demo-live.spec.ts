import { expect, test } from "@playwright/test";

// Runs the full guided demo in rehearsal mode (TEST ADAPTER, never presented as AI) and captures
// one screenshot per step into docs/screenshots/. Each step performs real API actions; the test
// checks the real resulting state, not just the narration.
test("guided demo runs end to end in live Gemini extraction", async ({ page }) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Start demo with live AI extraction/ }).click();
  const next = page.locator(".controls .primary");
  const shot = (n: number, name: string) =>
    page.screenshot({ path: `../docs/screenshots/live/demo-${String(n).padStart(2, "0")}-${name}.png`, fullPage: true });

  const expectations: [string, () => Promise<void>][] = [
    ["reset", async () => { await expect(page.locator(".mode")).toHaveText("Review-all mode"); }],
    ["exception-only", async () => { await expect(page.locator(".mode")).toHaveText("Exception-only mode"); }],
    ["po-arrives", async () => { await expect(page.locator(".stage .issue")).toHaveCount(3); }],
    ["business-rules", async () => {
      await page.locator(".stage .issue").first().click();
      await expect(page.locator(".stage .pl.focus")).toBeVisible();
    }],
    ["moq", async () => { await expect(page.locator(".stage .issue.resolved")).toHaveCount(1); }],
    ["price", async () => { await expect(page.locator(".stage .issue.resolved")).toHaveCount(2); }],
    ["gtin-auto-delivery", async () => { await expect(page.locator(".stage .erp h3")).toContainText("ERP order SIM-ERP-"); }],
    ["memory-activated", async () => { await expect(page.locator(".stage .rule.active")).toHaveCount(1); }],
    ["memory-reuse", async () => {
      await expect(page.locator(".stage .pill.memory")).toBeVisible();
      await expect(page.locator(".stage .provenance.memory_rule")).toContainText("alex");
      await expect(page.locator(".stage .erp h3")).toContainText("SIM-ERP-");
      await expect(page.locator(".stage .order .stages li.done")).toHaveCount(8);
    }],
    ["other-customer-held", async () => { await expect(page.locator(".stage .issue.open")).toHaveCount(1); }],
    ["revoked-held", async () => { await expect(page.locator(".stage .issue.open")).toHaveCount(1); }],
    ["review-all", async () => { await expect(page.locator(".stage .approve")).toBeVisible(); }],
    ["erp-timeout", async () => { await expect(page.locator(".stage .erp")).toContainText("Outcome unknown"); }],
    ["safe-retry", async () => {
      await expect(page.locator(".stage .erp-card")).toHaveCount(3);
      await expect(page.locator(".stage .order .erp")).toContainText("Reconciled");
      await expect(page.locator(".stage .order .stages li.done")).toHaveCount(8);
    }],
    ["wrap-up", async () => { await expect(page.locator(".kpi").nth(1)).toContainText("3"); }],
  ];

  for (const [k, [name, check]] of expectations.entries()) {
    await expect(page.locator(".stepno")).toContainText(`Step ${k + 1} of ${expectations.length}`);
    await expect(next).not.toHaveText("Working…", { timeout: 300_000 });
    if (!(await next.textContent())?.match(/Next|Finished/)) await next.click(); // perform the step's action
    await expect(next).toHaveText(/Next|Finished/, { timeout: 300_000 }); // real state reached
    await expect(page.locator(".narration .alert.bad")).toHaveCount(0);
    await check();
    await shot(k + 1, name);
    if (k < expectations.length - 1) await next.click();
  }

  // Exec summary reflects the real state: 3 ERP orders, 1 by policy, 1 memory reuse, 2 held.
  const kpi = (i: number) => page.locator(".kpi b").nth(i);
  await expect(kpi(1)).toHaveText("3");
  await expect(kpi(2)).toHaveText("1");
  await expect(kpi(3)).toHaveText("2");
  await expect(kpi(4)).toHaveText("1");
});
