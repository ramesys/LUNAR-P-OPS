import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";

const CRLF: string = String.fromCharCode(13, 10);

const YEAR_TERRAIN: string =
  "/?sites=sample-a,sample-b,sample-d&from=2026-01-01&to=2026-01-31&step=60&height=2&horizon=terrain&dte=0";

async function openScenario(page: Page, path: string): Promise<Locator> {
  await page.goto(path);
  const table: Locator = page.getByRole("table", { name: /ranked by sunlit time/i });
  await expect(table.getByRole("row")).toHaveCount(4);
  return table;
}

function timeLabel(page: Page): Locator {
  return page.getByRole("group", { name: "Time control" }).locator("output");
}

test.describe("desktop", (): void => {
  test("compares sites with real terrain and cites NASA sources", async ({ page }): Promise<void> => {
    const table: Locator = await openScenario(page, YEAR_TERRAIN);

    await expect(table.getByRole("cell", { name: "Terrain" })).toHaveCount(3);
    await expect(page.getByRole("img", { name: /Sky diagram for .* terrain horizon/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /LOLA south pole DEMs/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /de440s\.bsp/ })).toBeVisible();
  });

  test("animates time and syncs hover previews across charts", async ({ page }): Promise<void> => {
    await openScenario(page, YEAR_TERRAIN);
    await expect(timeLabel(page)).toHaveText("2026-01-01 00:00 UTC");

    await page.getByRole("button", { name: "Play" }).click();
    await expect(timeLabel(page)).not.toHaveText("2026-01-01 00:00 UTC");
    await page.getByRole("button", { name: "Pause" }).click();
    const paused: string = (await timeLabel(page).textContent()) ?? "";
    await page.waitForTimeout(300);
    await expect(timeLabel(page)).toHaveText(paused);

    const timeline: Locator = page.getByRole("img", { name: /Timeline/ });
    const box: { x: number; y: number; width: number; height: number } | null = await timeline.boundingBox();
    if (box === null) throw new Error("timeline not rendered");
    const point: { x: number; y: number } = { x: box.width * 0.6, y: 60 };
    await timeline.hover({ position: point });
    await expect(page.locator(".readout")).toContainText("(preview)");
    await timeline.click({ position: point });
    await page.getByRole("heading", { name: "Sky & timeline" }).hover();
    await expect(page.locator(".readout")).not.toContainText("(preview)");
    await expect(timeLabel(page)).not.toHaveText(paused);
  });

  test("selects sites on the pole map and reruns the comparison", async ({ page }): Promise<void> => {
    await openScenario(page, YEAR_TERRAIN);
    const checkboxC: Locator = page.getByRole("checkbox", { name: /Sample C/ });
    await expect(checkboxC).not.toBeChecked();

    await page.getByRole("button", { name: /^Sample C,/ }).click();
    await expect(checkboxC).toBeChecked();
    await page.getByRole("button", { name: "Compare sites" }).click();

    const table: Locator = page.getByRole("table", { name: /ranked by sunlit time/i });
    await expect(table.getByRole("row")).toHaveCount(5);
    await expect(page).toHaveURL(/sites=sample-a%2Csample-b%2Csample-d%2Csample-c/);
  });

  test("adds a custom site by coordinates and shares it in the URL", async ({ page }): Promise<void> => {
    await openScenario(page, YEAR_TERRAIN);

    await page.getByRole("spinbutton", { name: /Latitude/ }).fill("-87.25");
    await page.getByRole("spinbutton", { name: /Longitude/ }).fill("-30");
    await page.getByRole("button", { name: "Add site" }).click();
    await expect(page.getByRole("checkbox", { name: /Custom 87.25°S 330.00°E/ })).toBeChecked();
    await page.getByRole("button", { name: "Compare sites" }).click();

    const table: Locator = page.getByRole("table", { name: /ranked by sunlit time/i });
    await expect(table.getByRole("row")).toHaveCount(5);
    const customRow: Locator = table.getByRole("row", { name: /Custom 87.25°S 330.00°E/ });
    await expect(customRow.getByRole("cell", { name: "Flat" })).toBeVisible();
    await expect(page).toHaveURL(/custom%3A-87.25%3A330/);

    await page.reload();
    await expect(page.getByRole("checkbox", { name: /Custom 87.25°S 330.00°E/ })).toBeChecked();
  });

  test("exports summary, time series and windows as CSV", async ({ page }): Promise<void> => {
    await openScenario(page, YEAR_TERRAIN);
    const exported: Record<string, string[]> = {};
    for (const label of ["Summary", "Time series", "Windows"]) {
      const downloadPromise: Promise<Download> = page.waitForEvent("download");
      await page.getByRole("group", { name: "Export" }).getByRole("button", { name: label }).click();
      const download: Download = await downloadPromise;
      const text: string = await readFile(await download.path(), "utf-8");
      expect(text.charCodeAt(0)).toBe(0xfeff);
      exported[download.suggestedFilename()] = text.slice(1).trim().split(CRLF);
    }

    const summary: string[] = exported["clps-summary_2026-01-01_2026-01-31.csv"] ?? [];
    expect(summary).toHaveLength(4);
    expect(summary[1]).toMatch(/^1,sample-b,Sample B,sample,-89,120,terrain,/);
    const series: string[] = exported["clps-timeseries_2026-01-01_2026-01-31.csv"] ?? [];
    expect(series).toHaveLength(1 + 3 * 31 * 24);
    expect(series[0]).toBe(
      "time_utc,site_id,sun_azimuth_deg,sun_elevation_deg,sun_horizon_deg,sun_visible," +
        "earth_azimuth_deg,earth_elevation_deg,earth_horizon_deg,dte_available",
    );
    const windows: string[] = exported["clps-windows_2026-01-01_2026-01-31.csv"] ?? [];
    expect(windows.length).toBeGreaterThan(3);
  });

  test("opens a shared link with a flat horizon", async ({ page }): Promise<void> => {
    const table: Locator = await openScenario(
      page,
      "/?sites=sample-b,sample-c,sample-f&from=2026-02-01&to=2026-02-10&step=120&height=2&horizon=flat&dte=2",
    );

    await expect(table.getByRole("cell", { name: "Flat" })).toHaveCount(3);
    await expect(page.getByText("Earth center at least 2° above the horizon")).toBeVisible();
  });
});

test("fits a phone screen with readable charts @phone", async ({ page }): Promise<void> => {
  await openScenario(page, YEAR_TERRAIN);

  const overflow: number = await page.evaluate(
    (): number => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Chart drawing width follows the container, so SVG units are CSS pixels (text keeps its size).
  const ratio: number = await page
    .getByRole("img", { name: /Sky diagram/ })
    .evaluate((svg: Element): number => {
      const viewBoxWidth: number = (svg as SVGSVGElement).viewBox.baseVal.width;
      return svg.getBoundingClientRect().width / viewBoxWidth;
    });
  expect(ratio).toBeGreaterThan(0.95);
  expect(ratio).toBeLessThan(1.05);
  await page.screenshot({ path: "test-results/phone.png", fullPage: true });
});
