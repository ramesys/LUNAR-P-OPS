import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Regenerates the README screenshots in docs/screenshots (`make screenshots`, dev stack running).
 * Not part of the regular e2e run: only the "screenshots" project picks up the @screenshots tag.
 */

const OUT: string = "../../docs/screenshots";
const YEAR: string = "sites=sample-a,sample-b,sample-d&from=2026-01-01&to=2026-12-31&step=60&height=2&horizon=terrain&dte=0";

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`);
  await expect(page.getByRole("table", { name: /ranked by sunlit time/i }).getByRole("row")).toHaveCount(4);
  await page.waitForTimeout(400);
}

function card(page: Page, heading: string): Locator {
  return page.locator("section.card", { has: page.getByRole("heading", { name: heading, level: 2 }) });
}

test("capture README screenshots @screenshots", async ({ page }): Promise<void> => {
  test.setTimeout(120_000);

  await page.setViewportSize({ width: 1280, height: 1400 });
  await open(page, `${YEAR}&mode=simple`);
  await page.screenshot({ path: `${OUT}/01-overview-simple.png`, clip: { x: 0, y: 0, width: 1280, height: 1400 } });
  await card(page, "Comparison").screenshot({ path: `${OUT}/02-simple-summary.png` });
  await card(page, "South pole map").screenshot({ path: `${OUT}/03-pole-map.png` });

  await open(page, `${YEAR}&mode=expert`);
  await page.getByRole("slider", { name: "Time" }).fill("150");
  await page.waitForTimeout(300);
  await page.locator("form.scenario-form").screenshot({ path: `${OUT}/04-expert-settings.png` });
  await card(page, "Sky & timeline").locator(".chart").first().screenshot({ path: `${OUT}/05-sky-diagram.png` });
  await card(page, "Sky & timeline").locator(".chart").nth(1).screenshot({ path: `${OUT}/06-timeline.png` });
  await card(page, "Comparison").screenshot({ path: `${OUT}/07-expert-comparison.png` });

  await page.getByText(/^3D view · /).click();
  const view3d: Locator = page.locator(".terrain-3d");
  await expect(view3d.locator("canvas")).toBeVisible();
  await page.waitForTimeout(1500);
  await view3d.screenshot({ path: `${OUT}/08-terrain-3d.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, `${YEAR}&mode=simple`);
  await page.screenshot({ path: `${OUT}/09-mobile.png` });
});
