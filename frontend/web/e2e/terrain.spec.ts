import { expect, test, type Locator, type Response as PageResponse } from "@playwright/test";

interface TerrainOut { verdict: string; screen_id: string }
interface Sample { iteration: number; reason: string | null; terrain: TerrainOut | null; parent_terrain_screen_ids: string[] }
interface Result { verdict: string; visibility_verdict: string | null; persisted: boolean; sample: Sample }
interface Execution { refinement_policy: string | null; results: Result[] }

/**
 * Experiment B on the isolated stack (temporary database, real LOLA DEM and SPICE): terrain limits
 * are previewed, terrain-failing lattice points are never evaluated, and the selected candidate's
 * terrain screen appears in the Region Brush and in the existing Landing Graph.
 */
test("terrain-aware adaptive brush screens, refines and explains candidates", async ({ page }): Promise<void> => {
  test.setTimeout(180000);
  await page.goto("/?sites=sample-a,sample-b&from=2026-01-01&to=2026-01-02&step=120&height=2&horizon=terrain&dte=0&mode=expert");
  await page.getByRole("button", { name: "Scientific detail · 4 km" }).click();
  await page.getByRole("button", { name: "Top view" }).click();
  await page.getByRole("button", { name: "＋ New region" }).click();
  const canvas: Locator = page.locator(".terrain-canvas canvas");
  const box: { width: number; height: number } | null = await canvas.boundingBox();
  if (box === null) throw new Error("Terrain canvas unavailable");
  for (const [x, y] of [[0.32, 0.32], [0.68, 0.32], [0.68, 0.68], [0.32, 0.68]] as const) {
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
  }
  await page.getByRole("button", { name: "Finish region" }).click();
  await page.getByLabel("Grid spacing (m)").fill("200");
  await page.getByLabel("Maximum locations").fill("6");
  await page.getByLabel("Duration (h)", { exact: true }).fill("24");
  await page.getByLabel("Step (min)", { exact: true }).fill("360");
  const evidence: Locator = page.getByLabel("Refinement evidence");
  await expect(evidence).toBeDisabled();
  await page.getByLabel("Apply slope / roughness limits").check();
  await expect(page.getByLabel("Max local slope (°)")).toHaveValue("12");
  await evidence.selectOption("visibility_terrain");

  const previewResponse: Promise<PageResponse> = page.waitForResponse((r): boolean => r.url().endsWith("/brush/preview") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Preview locations" }).click();
  const preview: { terrain_pool_size: number; terrain_excluded_count: number; samples: Sample[] } =
    await (await previewResponse).json() as { terrain_pool_size: number; terrain_excluded_count: number; samples: Sample[] };
  expect(preview.terrain_pool_size).toBeGreaterThan(preview.terrain_excluded_count);
  expect(preview.terrain_excluded_count).toBeGreaterThan(0);
  expect(preview.samples.every((s: Sample): boolean => s.terrain !== null && s.terrain.verdict !== "FAIL")).toBe(true);
  await expect(page.getByTestId("terrain-prescreen")).toContainText(`${preview.terrain_excluded_count.toString()} of ${preview.terrain_pool_size.toString()} lattice points`);

  await page.getByRole("checkbox", { name: /I approve evaluating/ }).check();
  const response: Promise<PageResponse> = page.waitForResponse((r): boolean => r.url().endsWith("/brush/execute") && r.request().method() === "POST", { timeout: 150000 });
  await page.getByRole("button", { name: "Evaluate region & create candidates" }).click();
  const run: Execution = await (await response).json() as Execution;
  expect(run.refinement_policy).toBe("spatial-lattice-evidence-terrain-v1");
  expect(run.results.length).toBeGreaterThan(preview.samples.length);
  for (const r of run.results) {
    expect(r.sample.terrain?.verdict).not.toBe("FAIL");
    expect(r.sample.parent_terrain_screen_ids.length).toBeGreaterThan(0);
    if (r.sample.iteration > 0 && r.verdict !== "NOT_EVALUATED") expect(r.sample.reason).toContain("terrain pre-screen excluded");
  }
  await expect(page.getByText("policy spatial-lattice-evidence-terrain-v1", { exact: false })).toBeVisible();

  const results: Locator = page.getByRole("list", { name: "Brush results" });
  await expect(results.getByRole("button").first()).toContainText(/terrain (PASS|NOT_ASSESSED)/);
  await results.getByRole("button").first().click();
  const detail: Locator = page.locator(".brush-result-detail").getByRole("region", { name: "Terrain screen" });
  await expect(detail).toContainText("LandingZoneScreen");
  await expect(detail).toContainText("Local slope");
  await expect(detail.getByText(/not certified landing safety/)).toBeVisible();

  // The same Rete graph gains a Terrain screen node fed by Candidate.candidate_ref.
  const graphNode: Locator = page.locator(".node-kind-compute").filter({ hasText: "Terrain screen" });
  await expect(graphNode).toContainText(/Terrain (PASS|FAIL|NOT ASSESSED) · COMPUTED_UNVERIFIED/, { timeout: 30000 });
  const card: Locator = page.getByRole("region", { name: /^Terrain screen · C0/ });
  await expect(card).toBeVisible();
  await expect(page.getByLabel("Candidate terrain screen")).toContainText("limits from Region 1");
  await expect(page.locator(".graph-canvas")).toHaveCount(1);
});
