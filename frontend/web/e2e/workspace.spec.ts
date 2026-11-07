import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type APIResponse, type Download, type Locator, type Page, type Request } from "@playwright/test";

/**
 * Sprint 07: candidate evaluation and catalog comparison contexts against the running stack.
 * The fixture candidate and its evaluation are created through the public API with fixed inputs,
 * so repeated runs reuse the same persisted records (identities are content hashes).
 */

const SCENARIO: string = "/?sites=sample-a,sample-b&from=2026-01-01&to=2026-01-02&step=120&height=2&horizon=terrain&dte=0&mode=expert";

interface Fixture { candidateId: string; evaluationId: string; samples: number }
interface Manifest {
  evaluation_id: string; candidate_id: string; request: unknown; terrain: { near: { sha256: string }; far: { sha256: string } };
  software: Record<string, string>; consistency: Record<string, unknown>; status: Record<string, unknown>;
}

async function fixture(request: APIRequestContext): Promise<Fixture> {
  const created: APIResponse = await request.post("/api/rois/shackleton-rim-b/candidates", {
    data: { east_m: 350, north_m: -450, observer_height_m: 2, selected_time_utc: "2026-11-07T00:00:00Z" },
  });
  expect(created.ok()).toBe(true);
  const candidate: { candidate_id: string } = (await created.json()) as { candidate_id: string };
  const evaluated: APIResponse = await request.post(`/api/candidates/${candidate.candidate_id}/evaluations`, {
    data: { duration_hours: 6, step_minutes: 60 },
  });
  expect(evaluated.ok()).toBe(true);
  const evaluation: { evaluation_id: string; status: string; samples: unknown[] } =
    (await evaluated.json()) as { evaluation_id: string; status: string; samples: unknown[] };
  expect(evaluation.status).toBe("COMPUTED_UNVERIFIED");
  return { candidateId: candidate.candidate_id, evaluationId: evaluation.evaluation_id, samples: evaluation.samples.length };
}

async function open(page: Page, f: Fixture): Promise<void> {
  await page.addInitScript(([root, evaluation]: [string, string]): void => {
    if (sessionStorage.getItem("seeded") !== null) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    localStorage.setItem("lunar-ops-selection", JSON.stringify({ rootId: root, revisionId: root, evaluationId: evaluation, cursorUtc: null }));
  }, [f.candidateId, f.evaluationId] as [string, string]);
  await page.goto(SCENARIO);
  await expect(page.getByRole("table", { name: /ranked by sunlit time/i })).toBeVisible();
  await expect(candidateCard(page)).toContainText(f.evaluationId.slice(0, 22));
}

const candidateCard: (page: Page) => Locator = (page: Page): Locator => page.getByRole("button", { name: /^Candidate evaluation/ });
const catalogCard: (page: Page) => Locator = (page: Page): Locator => page.getByRole("button", { name: /^Catalog comparison/ });
const inspectorTime: (page: Page) => Locator = (page: Page): Locator => page.getByRole("complementary", { name: "Inspector" }).getByRole("group", { name: "Time control" });
const catalogTime: (page: Page) => Locator = (page: Page): Locator => page.locator("#catalog-context").getByRole("group", { name: "Time control" });
const resultsNode: (page: Page) => Locator = (page: Page): Locator => page.locator(".node-kind-result");

/** Scientific writes made by the page (the catalog's /api/analysis is computed on load, not stored). */
function watchWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request: Request): void => {
    const url: URL = new URL(request.url());
    if (request.method() !== "GET" && url.pathname.startsWith("/api/") && url.pathname !== "/api/analysis") {
      writes.push(`${request.method()} ${url.pathname}`);
    }
  });
  return writes;
}

test.describe("desktop", (): void => {
  test("keeps candidate and catalog contexts separate while navigating time", async ({ page, request }): Promise<void> => {
    const f: Fixture = await fixture(request);
    await open(page, f);
    const writes: string[] = watchWrites(page);
    const camera: string | null = await page.locator("[aria-label^='3D terrain of the Shackleton']").getAttribute("data-camera");

    // Candidate timeline: Inspector, 3D time panel, graph Results node and context bar agree.
    await inspectorTime(page).getByRole("button", { name: "Step forward" }).click();
    await inspectorTime(page).getByRole("button", { name: "Step forward" }).click();
    await expect(candidateCard(page)).toHaveAttribute("aria-pressed", "true");
    await expect(candidateCard(page)).toContainText(`sample 3/${f.samples.toString()}`);
    await expect(page.locator(".terrain-time")).toContainText(`stored sample 3/${f.samples.toString()}`);
    await expect(page.locator(".terrain-time")).toContainText("2026-11-07 02:00 UTC");
    await expect(resultsNode(page)).toContainText(`cursor 3/${f.samples.toString()}: 2026-11-07 02:00 UTC`);

    // Catalog timeline: activates the catalog context and leaves the candidate cursor alone.
    await catalogTime(page).getByRole("button", { name: "Step forward" }).click();
    await expect(catalogCard(page)).toHaveAttribute("aria-pressed", "true");
    await expect(catalogCard(page)).toContainText("sample 2/");
    await expect(catalogCard(page)).toContainText("2026-01-01 02:00 UTC");
    await expect(page.locator("#catalog-context .context-badge")).toHaveText(/active context/);
    await expect(candidateCard(page)).toContainText(`sample 3/${f.samples.toString()}`);
    await expect(page.locator(".terrain-time")).toContainText("2026-11-07 02:00 UTC");

    // Switching back by the selector changes no cursor.
    await candidateCard(page).click();
    await expect(candidateCard(page)).toHaveAttribute("aria-pressed", "true");
    await expect(catalogCard(page)).toContainText("2026-01-01 02:00 UTC");

    // Playback of stored samples, then a check that nothing was computed or stored.
    await inspectorTime(page).getByRole("button", { name: "Play" }).click();
    await expect(candidateCard(page)).toContainText(`sample ${f.samples.toString()}/${f.samples.toString()}`);
    expect(writes).toEqual([]);
    expect(await page.locator("[aria-label^='3D terrain of the Shackleton']").getAttribute("data-camera")).toBe(camera);
  });

  test("distinguishes draft from saved inputs and restores everything after reload", async ({ page, request }): Promise<void> => {
    const f: Fixture = await fixture(request);
    await open(page, f);
    const writes: string[] = watchWrites(page);
    await inspectorTime(page).getByRole("button", { name: "Step forward" }).click();
    await catalogTime(page).getByRole("button", { name: "Step forward" }).click();

    const height: Locator = page.getByRole("complementary", { name: "Inspector" }).getByRole("spinbutton", { name: /Observer height/ });
    await height.fill("9");
    await expect(page.locator(".node-kind-parameter").filter({ hasText: "Observer Height" })).toContainText("saved C0: 2 m");
    await expect(page.getByRole("complementary", { name: "Inspector" }).getByRole("status").filter({ hasText: "Unsaved edit" })).toBeVisible();
    await expect(candidateCard(page)).toContainText("Unsaved draft differs from the evaluated inputs");
    await expect(page.locator(".terrain-time .draft-text")).toContainText("result above is for 2 m");
    expect(writes).toEqual([]);

    await page.waitForTimeout(500); // the selection is saved with a short debounce
    await page.reload();
    await expect(candidateCard(page)).toContainText(f.evaluationId.slice(0, 22));
    await expect(catalogCard(page)).toHaveAttribute("aria-pressed", "true");
    await expect(candidateCard(page)).toContainText(`sample 2/${f.samples.toString()}`);
    await expect(catalogCard(page)).toContainText("sample 2/");
    await expect(page.locator(".terrain-time")).toContainText(`stored sample 2/${f.samples.toString()}`);
    // The draft is display state: after reload the graph shows the saved inputs again.
    await expect(height).toHaveValue("2");
    expect(writes).toEqual([]);
  });

  test("exports the stored experiment with its software provenance", async ({ page, request }): Promise<void> => {
    const f: Fixture = await fixture(request);
    await open(page, f);
    const downloadPromise: Promise<Download> = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export experiment (JSON)" }).click();
    const download: Download = await downloadPromise;
    const manifest: Manifest = JSON.parse(await readFile(await download.path(), "utf8")) as Manifest;
    const terrain: { datasets: { local_window_sha256: string }[] } =
      (await (await request.get("/api/rois/shackleton-rim-b/terrain")).json()) as { datasets: { local_window_sha256: string }[] };
    expect(manifest.evaluation_id).toBe(f.evaluationId);
    expect(manifest.candidate_id).toBe(f.candidateId);
    expect(manifest.request).toEqual({ duration_hours: 6, step_minutes: 60 });
    expect([manifest.terrain.near.sha256, manifest.terrain.far.sha256]).toEqual(terrain.datasets.map((d: { local_window_sha256: string }): string => d.local_window_sha256));
    expect(manifest.consistency["candidate_snapshot_matches_record"]).toBe(true);
    expect(manifest.status["validation_status"]).toBe("not_independently_validated");
    // Either a real commit with its clean/dirty state, or an explicit "not_recorded" — never invented.
    const commit: string = manifest.software["software_commit"] ?? "";
    expect(commit === "not_recorded" || /^[0-9a-f]{7,40}(-dirty)?$/.test(commit)).toBe(true);
    expect(manifest.software["software_commit_state"]).toBe(commit === "not_recorded" ? "not_recorded" : commit.endsWith("-dirty") ? "dirty" : "clean");
    await expect(page.getByRole("status").filter({ hasText: "Exported" })).toBeVisible();
  });

  test("keeps graph values readable at the normal zoom", async ({ page, request }): Promise<void> => {
    const f: Fixture = await fixture(request);
    await open(page, f);
    await expect(resultsNode(page)).toContainText("interval: 2026-11-07T00:00Z + 6 h @ 60 min");
    const overflowing: string[] = await page.locator(".node-info").evaluateAll((elements: Element[]): string[] =>
      elements.filter((e: Element): boolean => e.scrollWidth > e.clientWidth + 1).map((e: Element): string => e.textContent));
    expect(overflowing).toEqual([]);
    // Editable draft inputs (e.g. the full UTC timestamp) fit too.
    const clipped: string[] = await page.locator(".node-kind input").evaluateAll((inputs: Element[]): string[] =>
      inputs.filter((e: Element): boolean => e.scrollWidth > e.clientWidth + 1).map((e: Element): string => (e as HTMLInputElement).value));
    expect(clipped).toEqual([]);
    await expect(page.locator(".node-kind-parameter").filter({ hasText: "Time" })).toContainText("saved C0: 2026-11-07T00:00:00Z");
    await expect(page.locator(".node-kind-candidate")).toContainText(f.candidateId.slice(0, 22));
  });
});
