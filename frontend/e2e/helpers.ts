import type { Page } from "@playwright/test";

/** Switch the demo user. The picker sits in a collapsed "Signed in as" menu in the header. */
export async function asRole(page: Page, role: "administrator" | "reviewer" | "viewer") {
  const menu = page.locator("details.role");
  if (!(await menu.evaluate((d) => (d as HTMLDetailsElement).open))) await menu.locator("summary").click();
  await page.getByLabel("Signed-in user").selectOption(role);
  await menu.locator("summary").click();
}
