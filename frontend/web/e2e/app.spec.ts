import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";

const CRLF: string = String.fromCharCode(13, 10);

const YEAR_TERRAIN: string =
  "/?sites=sample-a,sample-b,sample-d&from=2026-01-01&to=2026-01-31&step=60&height=2&horizon=terrain&dte=0&mode=expert";

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
    await expect(page).toHaveURL(/sites=sample-a%2Csample-b%2Csample-d%2Csample-c.*mode=expert/);
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

  test("exports the charts as self-contained PNG images", async ({ page }): Promise<void> => {
    await openScenario(page, YEAR_TERRAIN);
    for (const [label, file] of [
      ["sky diagram", "clps-sky_sample-b_2026-01-01_2026-01-31.png"],
      ["timeline", "clps-timeline_2026-01-01_2026-01-31.png"],
    ] as const) {
      const downloadPromise: Promise<Download> = page.waitForEvent("download");
      await page.getByRole("button", { name: `Download ${label} as PNG` }).click();
      const download: Download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(file);
      const bytes: Buffer = await readFile(await download.path());
      await writeFile(`test-results/${file}`, bytes);

      expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
      const width: number = bytes.readUInt32BE(16);
      const height: number = bytes.readUInt32BE(20);
      expect(width).toBeGreaterThan(1500);
      expect(height).toBeGreaterThan(500);

      // Inlined styles: the image must contain the Sun's orange and the Earth's blue.
      const colors: { sun: number; earth: number } = await page.evaluate(
        async (base64: string): Promise<{ sun: number; earth: number }> => {
          const image: HTMLImageElement = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas: HTMLCanvasElement = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context: CanvasRenderingContext2D | null = canvas.getContext("2d");
          if (context === null) return { sun: 0, earth: 0 };
          context.drawImage(image, 0, 0);
          const data: Uint8ClampedArray = context.getImageData(0, 0, image.width, image.height).data;
          let sun: number = 0;
          let earth: number = 0;
          for (let i: number = 0; i < data.length; i += 4) {
            const r: number = data[i] ?? 0;
            const g: number = data[i + 1] ?? 0;
            const b: number = data[i + 2] ?? 0;
            if (r > 200 && g > 80 && g < 130 && b < 90) sun += 1;
            if (r < 80 && g > 100 && g < 150 && b > 190) earth += 1;
          }
          return { sun, earth };
        },
        bytes.toString("base64"),
      );
      expect(colors.sun).toBeGreaterThan(100);
      expect(colors.earth).toBeGreaterThan(100);
    }
  });

  test("shows the local terrain in 3D, lit by the Sun at the time shown", async ({ page }): Promise<void> => {
    await openScenario(page, YEAR_TERRAIN);
    await page.getByText("3D view · Sample B").click();
    const canvas: Locator = page.getByRole("img", { name: /3D terrain around Sample B/ }).locator("canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByText(/At the site now:/)).toBeVisible();

    const snapshot: () => Promise<{ url: string; tones: number }> = async (): Promise<{
      url: string;
      tones: number;
    }> =>
      canvas.evaluate((element: HTMLCanvasElement): { url: string; tones: number } => {
        const copy: HTMLCanvasElement = document.createElement("canvas");
        copy.width = 160;
        copy.height = 96;
        const context: CanvasRenderingContext2D | null = copy.getContext("2d");
        if (context === null) return { url: "", tones: 0 };
        context.drawImage(element, 0, 0, copy.width, copy.height);
        const data: Uint8ClampedArray = context.getImageData(0, 0, copy.width, copy.height).data;
        const tones: Set<number> = new Set<number>();
        for (let i: number = 0; i < data.length; i += 4) {
          tones.add(((data[i] ?? 0) >> 3) * 1024 + ((data[i + 1] ?? 0) >> 3) * 32 + ((data[i + 2] ?? 0) >> 3));
        }
        return { url: element.toDataURL("image/png"), tones: tones.size };
      });

    await page.waitForTimeout(500);
    const before: { url: string; tones: number } = await snapshot();
    expect(before.tones).toBeGreaterThan(40);
    await canvas.screenshot({ path: "test-results/terrain3d-before.png" });

    await page.getByRole("slider", { name: "Time" }).fill("300");
    await page.waitForTimeout(500);
    const after: { url: string; tones: number } = await snapshot();
    await canvas.screenshot({ path: "test-results/terrain3d-after.png" });
    expect(after.url).not.toBe(before.url);
  });

  test("opens a shared link with a flat horizon", async ({ page }): Promise<void> => {
    const table: Locator = await openScenario(
      page,
      "/?sites=sample-b,sample-c,sample-f&from=2026-02-01&to=2026-02-10&step=120&height=2&horizon=flat&dte=2&mode=expert",
    );

    await expect(table.getByRole("cell", { name: "Flat" })).toHaveCount(3);
    await expect(page.getByText("Earth center at least 2° above the horizon")).toBeVisible();
  });
});

test("a first-time visitor gets Simple mode with plain-language results", async ({ page }): Promise<void> => {
  await page.goto("/");
  await expect(page.getByRole("table", { name: /ranked by sunlit time/i }).getByRole("row")).toHaveCount(4);

  await expect(page.getByRole("button", { name: "Simple" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".verdict")).toContainText(/Most sunlight|leads on both/);
  await expect(page.locator(".site-card")).toHaveCount(3);
  await expect(page.getByText(/days of sunlight per month/).first()).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Horizon/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Export" })).toHaveCount(0);

  await page.getByRole("button", { name: "Expert" }).click();
  await expect(page).toHaveURL(/mode=expert/);
  await expect(page.getByRole("group", { name: "Export" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expert" })).toHaveAttribute("aria-pressed", "true");
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
