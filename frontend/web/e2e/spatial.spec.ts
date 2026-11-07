import { expect, test, type APIRequestContext, type APIResponse, type Locator, type Page, type Request, type Response as PageResponse } from "@playwright/test";

/**
 * Spatial workspace sprint: 40 km terrain alignment, stored Sun/Earth geometry, multi-region
 * lifecycle and selection synchronization. Runs only against the isolated stack (tmpfs database).
 */

const SCENARIO: string = "/?sites=sample-a,sample-b&from=2026-01-01&to=2026-01-02&step=120&height=2&horizon=terrain&dte=0&mode=expert";
const MOON_RADIUS_M: number = 1_737_400;

interface Sample { time_utc: string; sun_azimuth_deg: number; sun_elevation_deg: number; earth_azimuth_deg: number; earth_elevation_deg: number }
interface Evaluation { evaluation_id: string; candidate_id: string; status: string; samples: Sample[]; horizon_elevation_deg: number[]; candidate: { longitude_deg: number } }
interface Frame { center_projected_m: number[]; east_axis_projected: number[]; north_axis_projected: number[]; roi: { center_longitude_deg: number } }
interface Regional { half_width_m: number; spacing_m: number; size: number; elevations_m: number[] }

async function fixture(request: APIRequestContext, east: number = 350, north: number = -450): Promise<Evaluation> {
  const created: APIResponse = await request.post("/api/rois/shackleton-rim-b/candidates", {
    data: { east_m: east, north_m: north, observer_height_m: 2, selected_time_utc: "2026-11-07T00:00:00Z" },
  });
  expect(created.ok()).toBe(true);
  const candidate: { candidate_id: string } = await created.json() as { candidate_id: string };
  const evaluated: APIResponse = await request.post(`/api/candidates/${candidate.candidate_id}/evaluations`, { data: { duration_hours: 6, step_minutes: 60 } });
  expect(evaluated.ok()).toBe(true);
  const result: Evaluation = await evaluated.json() as Evaluation;
  expect(result.status).toBe("COMPUTED_UNVERIFIED");
  return result;
}

async function open(page: Page, f: Evaluation | null): Promise<void> {
  await page.addInitScript(([root, evaluation]: [string, string]): void => {
    if (sessionStorage.getItem("seeded") !== null) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    if (root !== "") localStorage.setItem("lunar-ops-selection", JSON.stringify({ rootId: root, revisionId: root, evaluationId: evaluation, cursorUtc: null }));
  }, [f?.candidate_id ?? "", f?.evaluation_id ?? ""] as [string, string]);
  await page.goto(SCENARIO);
  await expect(page.locator(".terrain-canvas canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Regional explore · 40 km" })).toHaveAttribute("aria-pressed", "true");
}

/** Every request except GETs and the catalog's on-load /api/analysis. */
function watchRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request: Request): void => {
    const url: URL = new URL(request.url());
    if (request.method() !== "GET" && url.pathname.startsWith("/api/") && url.pathname !== "/api/analysis") seen.push(`${request.method()} ${url.pathname}`);
  });
  return seen;
}

/** Independent re-implementation (in the test) of the LOLA polar stereographic inverse. */
function geographic(frame: Frame, east: number, north: number): [number, number] {
  const [cx = 0, cy = 0] = frame.center_projected_m;
  const [ex = 0, ey = 0] = frame.east_axis_projected;
  const [nx = 0, ny = 0] = frame.north_axis_projected;
  const x: number = cx + east * ex + north * nx;
  const y: number = cy + east * ey + north * ny;
  const lat: number = (2 * Math.atan(Math.hypot(x, y) / (2 * MOON_RADIUS_M)) - Math.PI / 2) * 180 / Math.PI;
  return [lat, ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360];
}

function bilinear(grid: Regional, east: number, north: number): number {
  const col: number = (east + grid.half_width_m) / grid.spacing_m;
  const row: number = (grid.half_width_m - north) / grid.spacing_m;
  const c0: number = Math.min(Math.floor(col), grid.size - 2);
  const r0: number = Math.min(Math.floor(row), grid.size - 2);
  const at: (r: number, c: number) => number = (r: number, c: number): number => grid.elevations_m[r * grid.size + c] ?? NaN;
  const fc: number = col - c0;
  const fr: number = row - r0;
  return (at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc) * (1 - fr) + (at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc) * fr;
}

function roiAzimuth(az: number, candidateLon: number, centerLon: number): number {
  return ((az + candidateLon - centerLon) % 360 + 360) % 360;
}

async function direction(scene: Locator, attribute: string): Promise<[number, number]> {
  const raw: string = await scene.getAttribute(attribute) ?? "";
  const [az = NaN, el = NaN] = raw.split(",").map(Number);
  return [az, el];
}

function expectAngles(actual: [number, number], az: number, el: number): void {
  const delta: number = Math.abs(((actual[0] - az + 540) % 360) - 180);
  expect(delta).toBeLessThan(2e-3);
  expect(Math.abs(actual[1] - el)).toBeLessThan(2e-3);
}

async function drawRegion(page: Page, points: readonly (readonly [number, number])[]): Promise<void> {
  const canvas: Locator = page.locator(".terrain-canvas canvas");
  await page.getByRole("button", { name: "＋ New region" }).click();
  const box: { width: number; height: number } | null = await canvas.boundingBox();
  if (box === null) throw new Error("Terrain canvas unavailable");
  for (const [x, y] of points) await canvas.click({ position: { x: box.width * x, y: box.height * y } });
  await expect(page.getByText(new RegExp(`^${points.length.toString()} vertices ·`))).toBeVisible();
  await page.getByRole("button", { name: "Finish region" }).click();
}

test.describe("desktop", (): void => {
  test("40 km regional terrain is aligned with the API frame and DEM grid", async ({ page, request }): Promise<void> => {
    const frame: Frame = await (await request.get("/api/rois/shackleton-rim-b/terrain")).json() as Frame;
    const regional: Regional = await (await request.get("/api/rois/shackleton-rim-b/regional-terrain")).json() as Regional;
    expect([regional.half_width_m, regional.spacing_m, regional.size]).toEqual([20000, 250, 161]);
    await open(page, null);
    const requests: string[] = watchRequests(page);
    await expect(page.getByText("240 m LOLA DEM · 250 m display grid")).toBeVisible();
    await page.getByRole("button", { name: "Top view" }).click();
    const canvas: Locator = page.locator(".terrain-canvas canvas");
    const scene: Locator = page.locator(".terrain-canvas");
    const box: { width: number; height: number } | null = await canvas.boundingBox();
    if (box === null) throw new Error("terrain canvas missing");
    let checked: number = 0;
    let span: number = 0;
    for (const [x, y] of [[0.3, 0.2], [0.5, 0.5], [0.7, 0.3], [0.4, 0.8], [0.68, 0.72]] as const) {
      await scene.evaluate((element: Element): void => { element.removeAttribute("data-hover"); });
      await canvas.hover({ position: { x: box.width * x, y: box.height * y } });
      await expect.poll(async (): Promise<string | null> => scene.getAttribute("data-hover")).not.toBeNull();
      const [east = NaN, north = NaN, lat = NaN, lon = NaN, elevation = NaN] = (await scene.getAttribute("data-hover") ?? "").split(",").map(Number);
      if (!Number.isFinite(elevation)) continue;
      const [expectedLat, expectedLon] = geographic(frame, east, north);
      expect(Math.abs(lat - expectedLat)).toBeLessThan(1e-9);
      expect(Math.abs(((lon - expectedLon + 540) % 360) - 180)).toBeLessThan(1e-7);
      // The displayed surface is the API's 240 m DEM grid, in the API's row/column order.
      expect(Math.abs(elevation - bilinear(regional, east, north))).toBeLessThan(0.01);
      await expect(page.locator(".terrain-hud")).toContainText(`${Math.abs(lat).toFixed(5)}°S ${lon.toFixed(5)}°E`);
      span = Math.max(span, Math.abs(east), Math.abs(north));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
    // The hovered positions really cover the 40 km extent, not only the 4 km study area.
    expect(span).toBeGreaterThan(6000);

    // Regional terrain never creates candidates, inside or outside the 4 km outline.
    // (A click on an existing marker selects it instead, which is also not a write.)
    const notice: Locator = page.getByRole("status").filter({ hasText: "Regional terrain is for exploration only" });
    let refused: boolean = false;
    for (const [x, y] of [[0.515, 0.47], [0.48, 0.53], [0.52, 0.53], [0.485, 0.47], [0.5, 0.515]] as const) {
      await scene.evaluate((element: Element): void => { element.removeAttribute("data-hover"); });
      await canvas.hover({ position: { x: box.width * x, y: box.height * y } });
      const [east = NaN, north = NaN] = (await scene.getAttribute("data-hover") ?? "").split(",").map(Number);
      expect(Math.max(Math.abs(east), Math.abs(north))).toBeLessThan(2000);
      await canvas.click({ position: { x: box.width * x, y: box.height * y } });
      refused = await notice.isVisible().catch((): boolean => false) || await notice.waitFor({ timeout: 800 }).then((): boolean => true, (): boolean => false);
      if (refused) break;
    }
    expect(refused).toBe(true);
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);
  });

  test("Sun and Earth paths use the stored SPICE samples and follow the Timeline", async ({ page, request }): Promise<void> => {
    const f: Evaluation = await fixture(request);
    const frame: Frame = await (await request.get("/api/rois/shackleton-rim-b/terrain")).json() as Frame;
    await open(page, f);
    const requests: string[] = watchRequests(page);
    const scene: Locator = page.locator(".terrain-canvas");
    await expect(page.locator(".terrain-time")).toContainText(`stored sample 1/${f.samples.length.toString()}`);
    await expect(scene).toHaveAttribute("data-sun-path", f.samples.length.toString());
    await expect(scene).toHaveAttribute("data-earth-path", f.samples.length.toString());
    await expect(scene).toHaveAttribute("data-horizon-points", f.horizon_elevation_deg.length.toString());
    await expect(scene).toHaveAttribute("data-sky-radius-km", "12");
    await expect(page.getByTestId("sky-scale")).toContainText("distances are not to scale");
    const lon: number = f.candidate.longitude_deg;
    const centre: number = frame.roi.center_longitude_deg;
    for (const index of [0, 1, 2]) {
      const sample: Sample | undefined = f.samples[index];
      if (sample === undefined) throw new Error("missing sample");
      await expect(scene).toHaveAttribute("data-cursor-index", index.toString());
      expectAngles(await direction(scene, "data-sun-direction"), roiAzimuth(sample.sun_azimuth_deg, lon, centre), sample.sun_elevation_deg);
      expectAngles(await direction(scene, "data-earth-direction"), roiAzimuth(sample.earth_azimuth_deg, lon, centre), sample.earth_elevation_deg);
      await page.getByRole("complementary", { name: "Inspector" }).getByRole("group", { name: "Time control" }).getByRole("button", { name: "Step forward" }).click();
    }
    // Same directions on the 4 km scale; only the symbolic dome radius changes.
    await page.getByRole("button", { name: "Scientific detail · 4 km" }).click();
    await expect(scene).toHaveAttribute("data-sky-radius-km", "2.6");
    const sample3: Sample | undefined = f.samples[3];
    if (sample3 === undefined) throw new Error("missing sample");
    expectAngles(await direction(scene, "data-sun-direction"), roiAzimuth(sample3.sun_azimuth_deg, lon, centre), sample3.sun_elevation_deg);
    await page.getByRole("checkbox", { name: "Sun path & ray" }).uncheck();
    await expect(scene).toHaveAttribute("data-sun-path", "0");
    await expect(scene).toHaveAttribute("data-sun-direction", "");
    await page.getByRole("checkbox", { name: "Sun path & ray" }).check();
    expect(requests).toEqual([]);
  });

  test("manages several regions, keeps candidates on delete and synchronizes selection", async ({ page, request }): Promise<void> => {
    test.setTimeout(120_000);
    const f: Evaluation = await fixture(request);
    await open(page, f);
    const requests: string[] = watchRequests(page);
    await page.getByRole("button", { name: "Scientific detail · 4 km" }).click();
    await page.getByRole("button", { name: "Top view" }).click();
    await drawRegion(page, [[0.38, 0.36], [0.5, 0.36], [0.5, 0.48], [0.38, 0.48]]);
    await drawRegion(page, [[0.58, 0.55], [0.68, 0.55], [0.62, 0.66]]);
    const chips: Locator = page.getByRole("group", { name: "Regions" });
    await expect(chips.getByRole("button", { name: /^Region 1/ })).toHaveAttribute("aria-pressed", "false");
    await expect(chips.getByRole("button", { name: /^Region 2/ })).toHaveAttribute("aria-pressed", "true");
    await chips.getByRole("button", { name: /^Region 1/ }).click();
    await expect(chips.getByRole("button", { name: /^Region 1/ })).toHaveAttribute("aria-pressed", "true");
    await expect(chips.getByRole("button", { name: /^Region 1/ })).toContainText("4 vtx");
    expect(requests).toEqual([]);

    // Edit Region 1: drag a vertex in edit mode (a draft change, nothing is written).
    await page.getByRole("button", { name: "Edit vertices" }).click();
    const firstVertex: Locator = page.getByRole("button", { name: /^Remove vertex 1/ });
    const before: string = await firstVertex.innerText();
    const canvas: Locator = page.locator(".terrain-canvas canvas");
    await canvas.scrollIntoViewIfNeeded();
    const box: { x: number; y: number; width: number; height: number } | null = await canvas.boundingBox();
    if (box === null) throw new Error("Terrain canvas unavailable");
    await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.36);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.34, { steps: 4 });
    await page.mouse.up();
    await expect(firstVertex).not.toHaveText(before);
    await page.getByRole("button", { name: "Edit vertices" }).click();
    expect(requests).toEqual([]);

    // Preview (read-only) and execute Region 1 with a short interval.
    await page.getByLabel("Grid spacing (m)").fill("250");
    await page.getByLabel("Duration (h)", { exact: true }).fill("2");
    const roiBefore: { candidate_id: string }[] = await (await request.get("/api/rois/shackleton-rim-b/candidates")).json() as { candidate_id: string }[];
    await page.getByRole("button", { name: "Preview locations" }).click();
    await page.getByRole("checkbox", { name: /I approve evaluating/ }).check();
    const executed: Promise<PageResponse> = page.waitForResponse((r): boolean => r.url().endsWith("/brush/execute"), { timeout: 90_000 });
    await page.getByRole("button", { name: "Evaluate region & create candidates" }).click();
    const run: { results: { persisted: boolean; candidate: { candidate_id: string } | null }[] } = await (await executed).json() as { results: { persisted: boolean; candidate: { candidate_id: string } | null }[] };
    const selectedId: string = run.results.find((r): boolean => r.persisted)?.candidate?.candidate_id ?? "";
    expect(selectedId).not.toBe("");
    await expect(page.getByRole("heading", { name: "Experiment results · Region 1" })).toBeVisible();
    const results: Locator = page.getByRole("list", { name: "Brush results" });
    const saved: Locator = results.getByRole("button", { name: /· saved$/ }).first();
    await saved.click();
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    const graph: Locator = page.getByRole("region", { name: "Landing graph" });
    await expect(graph.locator(".node-kind-candidate")).toContainText(selectedId.slice(0, 22));

    // Selecting another candidate elsewhere clears the stale result highlight; selecting it again restores it.
    await page.getByRole("list", { name: "ROI candidates" }).getByRole("button", { pressed: false }).first().click();
    await expect(graph.locator(".node-kind-candidate")).not.toContainText(selectedId.slice(0, 22));
    await expect(saved).toHaveAttribute("aria-pressed", "false");
    await saved.click();
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect(graph.locator(".node-kind-candidate")).toContainText(selectedId.slice(0, 22));
    const roiAfterRun: { candidate_id: string }[] = await (await request.get("/api/rois/shackleton-rim-b/candidates")).json() as { candidate_id: string }[];
    expect(roiAfterRun.length).toBeGreaterThanOrEqual(roiBefore.length);

    // Delete Region 1: confirmation required; candidates, evaluations and the selection remain.
    await page.getByRole("button", { name: "Delete region" }).click();
    const dialog: Locator = page.getByRole("alertdialog", { name: "Confirm region deletion" });
    await expect(dialog).toContainText("Persisted candidates and evaluations are kept");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(chips.getByRole("button", { name: /^Region 1/ })).toBeVisible();
    await page.getByRole("button", { name: "Delete region" }).click();
    await dialog.getByRole("button", { name: "Delete region" }).click();
    await expect(chips.getByRole("button", { name: /^Region 1/ })).toHaveCount(0);
    await expect(chips.getByRole("button", { name: /^Region 2/ })).toHaveAttribute("aria-pressed", "true");
    const roiAfterDelete: { candidate_id: string }[] = await (await request.get("/api/rois/shackleton-rim-b/candidates")).json() as { candidate_id: string }[];
    expect(roiAfterDelete.map((c): string => c.candidate_id).sort()).toEqual(roiAfterRun.map((c): string => c.candidate_id).sort());
    expect((await request.get(`/api/candidates/${selectedId}/evaluations`)).ok()).toBe(true);
    await expect(graph.locator(".node-kind-candidate")).toContainText(selectedId.slice(0, 22));
    expect(requests.filter((r: string): boolean => r.startsWith("DELETE"))).toEqual([]);
    expect(requests.filter((r: string): boolean => !r.endsWith("/brush/preview") && !r.endsWith("/brush/execute"))).toEqual([]);

    // Region definitions survive a reload; the deleted one does not come back.
    await page.waitForTimeout(500);
    await page.reload();
    await expect(chips.getByRole("button", { name: /^Region 2/ })).toContainText("3 vtx");
    await expect(chips.getByRole("button", { name: /^Region 1/ })).toHaveCount(0);
  });
});

test("@phone keeps the Region Brush dock directly below the Timeline", async ({ page, request }): Promise<void> => {
  const f: Evaluation = await fixture(request);
  await open(page, f);
  const timeline: Locator = page.getByRole("region", { name: "Candidate timeline dock" });
  const dock: Locator = page.getByRole("region", { name: "Constraint Brush" });
  await expect(timeline).toBeInViewport();
  await expect(dock).toBeInViewport();
  const t: { y: number; height: number } | null = await timeline.boundingBox();
  const d: { y: number; height: number } | null = await dock.boundingBox();
  if (t === null || d === null) throw new Error("docks missing");
  expect(Math.abs(t.y + t.height - d.y)).toBeLessThan(2);
  expect(d.y + d.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) + 1);
  await page.getByRole("button", { name: "＋ New region" }).click();
  await expect(page.getByRole("group", { name: "Regions" }).getByRole("button", { name: /^Region 1/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Parameters" }).click();
  await expect(page.getByLabel("Grid spacing (m)")).toBeVisible();
  const t2: { y: number; height: number } | null = await timeline.boundingBox();
  const d2: { y: number } | null = await dock.boundingBox();
  // The Timeline moves up with the dock when the parameters drawer opens.
  if (t2 === null || d2 === null) throw new Error("docks missing");
  expect(Math.abs(t2.y + t2.height - d2.y)).toBeLessThan(2);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
