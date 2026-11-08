import { createApiClient, type ApiClient, type BrushDefinition, type BrushPreview, type BrushSample, type ScientificEvaluation, type Candidate } from "@clps/api-client";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { JSX } from "react";
import { evaluation } from "../lib/testFixtures.ts";
import type { BrushOverlay } from "../lib/brushTypes.ts";
import { createExplorationStore, ExplorationContext, type ExplorationStore } from "../lib/explorationStore.ts";
import { ConstraintBrush, definitionForPreview } from "./ConstraintBrush.tsx";

function fakeApi(calls: string[]): ApiClient {
  let stored: unknown = null;
  return createApiClient({ baseUrl: "http://api.test", fetch: async (request: Request): Promise<Response> => {
    const path: string = new URL(request.url).pathname;
    calls.push(`${request.method} ${path}`);
    if (request.method === "GET") return Response.json(stored);
    const body: Record<string, unknown> = await request.json() as Record<string, unknown>;
    const definition: BrushDefinition = (path.endsWith("/preview") ? body : body["definition"]) as BrushDefinition;
    const sample: BrushSample = { east_m: 0, north_m: 0, latitude_deg: -89.5, longitude_deg: 56, elevation_m: -28,
      candidate_id: "c0", status: "READY", already_persisted: false, error: null, iteration: 0, parent_candidate_ids: [], parent_evaluation_ids: [] };
    const preview: BrushPreview = { definition, coordinate_reference: "MOON_ME", alignment: "ROI origin", tolerance_m: 1e-7,
      samples: [sample], ready_count: 1, new_count: 1, existing_count: 0, temporal_samples_per_point: 2, estimated_total_samples: 2, preview_token: "preview-token" };
    if (path.endsWith("/preview")) return Response.json(preview);
    const result: ScientificEvaluation = evaluation();
    stored = { schema_version: "lunar-ops-brush/1", experiment_id: "brush-1", preview, results: [{ sample, verdict: "PASS", candidate: result.candidate,
      evaluation: result, persisted: true, errors: [], metrics: { sample_count: 2, duration_hours: 2, sun_fraction: 0.5,
        earth_fraction: 0, simultaneous_fraction: 0, longest_darkness_hours: 1, longest_earth_gap_hours: 2 } },
      { sample: { ...sample, east_m: 100, candidate_id: null, iteration: 1, reason: "Boundary evidence", parent_candidate_ids: ["c0"], parent_evaluation_ids: ["e1"] },
        verdict: "UNAVAILABLE", candidate: null, evaluation: null, persisted: false, errors: ["no DEM"] }], notes: [] };
    return Response.json(stored);
  } });
}

afterEach(cleanup);

interface Harness { store: ExplorationStore; calls: string[]; created: Candidate[][]; inspected: { candidate: Candidate; evaluationId: string | undefined }[]; overlay: () => BrushOverlay }

function mount(): Harness {
  const store: ExplorationStore = createExplorationStore();
  const harness: Harness = { store, calls: [], created: [], inspected: [], overlay: (): BrushOverlay => { throw new Error("not rendered"); } };
  let latest: BrushOverlay | null = null;
  harness.overlay = (): BrushOverlay => { if (latest === null) throw new Error("not rendered"); return latest; };
  render(<ExplorationContext.Provider value={store}><ConstraintBrush apiClient={fakeApi(harness.calls)} defaultTimeUtc="2026-11-07T00:00:00Z"
    onCandidatesCreated={(c: Candidate[]): void => { harness.created.push(c); }}
    onInspect={(candidate: Candidate, evaluationId?: string): void => { harness.inspected.push({ candidate, evaluationId }); store.dispatch({ type: "select-root", rootId: candidate.candidate_id }); }}
    renderTerrain={(brush: BrushOverlay): JSX.Element => { latest = brush; return <button type="button" onClick={(): void => {
      const count: number = brush.regions.find((r): boolean => r.active)?.vertices.length ?? 0;
      brush.onAdd({ east_m: count * 100, north_m: count * 50 });
    }}>Test terrain click</button>; }} /></ExplorationContext.Provider>);
  return harness;
}

function drawTriangle(): void {
  fireEvent.click(screen.getByRole("button", { name: "＋ New region" }));
  for (let i: number = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Test terrain click" }));
  fireEvent.click(screen.getByRole("button", { name: "Finish region" }));
}

it("keeps drawing and preview read-only, and inspects a result only after explicit approval", async (): Promise<void> => {
  const h: Harness = mount();
  fireEvent.click(screen.getByRole("button", { name: "＋ New region" }));
  for (let i: number = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Test terrain click" }));
  expect(h.calls).toEqual([]);
  expect(screen.getByText(/3 vertices ·/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Finish region" }));
  expect(screen.getByLabelText("Grid spacing (m)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Preview locations" }));
  await screen.findByText(/1 locations · 1 DEM-ready/);
  expect(h.calls).toEqual(["POST /api/rois/shackleton-rim-b/brush/preview"]);
  expect(screen.getByRole("button", { name: "Evaluate region & create candidates" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /I approve evaluating/ }));
  fireEvent.click(screen.getByRole("button", { name: "Evaluate region & create candidates" }));
  await screen.findByRole("heading", { name: "Experiment results · Region 1" });
  expect(h.created[0]?.[0]?.candidate_id).toBe("c0");
  fireEvent.click(screen.getByRole("button", { name: /PASS · 0 m E, 0 m N/ }));
  expect(h.inspected[0]?.candidate.candidate_id).toBe("c0");
  expect(h.inspected[0]?.evaluationId).toBe("e1");
  expect(h.store.getState().inspectedSample).toEqual({ regionId: h.store.getState().activeRegionId, index: 0 });
  expect(h.overlay().regions[0]?.samples[0]).toMatchObject({ verdict: "PASS", selected: true });
});

it("manages several regions and deletes one only after confirmation, without any API write", (): void => {
  const h: Harness = mount();
  drawTriangle();
  drawTriangle();
  expect(h.store.getState().regions.map((r): number => r.number)).toEqual([1, 2]);
  expect(h.overlay().regions.map((r): boolean => r.active)).toEqual([false, true]);
  fireEvent.click(screen.getByRole("button", { name: /^Region 1/ }));
  expect(h.overlay().regions.map((r): boolean => r.active)).toEqual([true, false]);
  fireEvent.click(screen.getByRole("button", { name: "Delete region" }));
  const dialog: HTMLElement = screen.getByRole("alertdialog", { name: "Confirm region deletion" });
  expect(dialog.textContent).toContain("Persisted candidates and evaluations are kept");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.store.getState().regions).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Delete region" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete region" }));
  expect(h.store.getState().regions.map((r): number => r.number)).toEqual([2]);
  // Numbers are never reused while regions exist.
  drawTriangle();
  expect(h.store.getState().regions.map((r): number => r.number)).toEqual([2, 3]);
  fireEvent.click(screen.getByRole("button", { name: "Clear vertices" }));
  fireEvent.click(within(screen.getByRole("alertdialog", { name: "Confirm clearing vertices" })).getByRole("button", { name: "Clear vertices" }));
  expect(h.store.getState().regions.at(-1)?.vertices).toEqual([]);
  expect(h.calls).toEqual([]);
});

it("drops a preview that returns after its region was edited", async (): Promise<void> => {
  const h: Harness = mount();
  drawTriangle();
  fireEvent.click(screen.getByRole("button", { name: "Preview locations" }));
  // Edit while the request is in flight: the response belongs to the previous revision.
  const region: ReturnType<ExplorationStore["getState"]>["regions"][number] | undefined = h.store.getState().regions[0];
  if (region === undefined) throw new Error("region missing");
  act((): void => { h.store.dispatch({ type: "region-edit", regionId: region.id, patch: { params: { ...region.params, spacing_m: 200 } } }); });
  await screen.findByText(/changed while previewing/);
  expect(h.store.getState().regions[0]?.preview).toBeNull();
});


it("shows adaptive results generated after preview on the terrain and with their reason", async (): Promise<void> => {
  const h: Harness = mount();
  drawTriangle();
  fireEvent.click(screen.getByRole("button", { name: "Preview locations" }));
  await screen.findByText(/1 locations · 1 DEM-ready/);
  fireEvent.click(screen.getByRole("checkbox", { name: /I approve evaluating/ }));
  fireEvent.click(screen.getByRole("button", { name: "Evaluate region & create candidates" }));
  await screen.findByRole("heading", { name: "Experiment results · Region 1" });
  expect(h.overlay().regions[0]?.samples).toHaveLength(2);
  expect(h.overlay().regions[0]?.samples[1]).toMatchObject({ iteration: 1, parentIndices: [0] });
  fireEvent.click(screen.getByRole("button", { name: /UNAVAILABLE · 100 m E/ }));
  expect(screen.getByText(/Boundary evidence/)).toBeTruthy();
});

it("defaults to adaptive sampling and allows a uniform benchmark", async (): Promise<void> => {
  const h: Harness = mount();
  drawTriangle();
  const method: HTMLSelectElement = screen.getByLabelText<HTMLSelectElement>("Sampling method");
  expect(method.value).toBe("adaptive");
  fireEvent.click(screen.getByRole("button", { name: "Preview locations" }));
  await screen.findByText(/1 locations · 1 DEM-ready/);
  expect(h.store.getState().regions[0]?.preview?.definition.sampling).toBe("adaptive");
  fireEvent.click(screen.getByRole("button", { name: "Parameters" }));
  fireEvent.change(screen.getByLabelText("Sampling method"), { target: { value: "grid" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview locations" }));
  await screen.findByText(/1 locations · 1 DEM-ready/);
  expect(h.store.getState().regions[0]?.preview?.definition.sampling).toBe("grid");
});


it("restores a saved adaptive experiment by ID without a write", async (): Promise<void> => {
  const h: Harness = mount();
  drawTriangle();
  fireEvent.click(screen.getByRole("button", { name: "Preview locations" }));
  await screen.findByText(/1 locations · 1 DEM-ready/);
  fireEvent.click(screen.getByRole("checkbox", { name: /I approve evaluating/ }));
  fireEvent.click(screen.getByRole("button", { name: "Evaluate region & create candidates" }));
  await screen.findByRole("heading", { name: "Experiment results · Region 1" });
  fireEvent.click(screen.getByRole("button", { name: "Delete region" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete region" }));
  const writes: number = h.calls.filter((call): boolean => call.startsWith("POST")).length;
  fireEvent.change(screen.getByLabelText("Saved experiment ID"), { target: { value: "brush-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Load experiment" }));
  await screen.findByRole("heading", { name: "Experiment results · Region 1" });
  expect(h.overlay().regions[0]?.samples).toHaveLength(2);
  expect(h.calls.filter((call): boolean => call.startsWith("POST"))).toHaveLength(writes);
});

it("reuses the stored definition exactly when previewing an unchanged restored experiment", (): void => {
  const definition: BrushDefinition = { polygon: [], spacing_m: 100, max_points: 5, observer_height_m: 3,
    start_utc: "2026-11-07T00:00:00Z", duration_hours: 6, step_minutes: 60, retention: "all", sampling: "adaptive",
    constraints: { min_sun_fraction: 0.12345678912345678, min_earth_fraction: 0, min_simultaneous_fraction: 0, max_darkness_hours: null, max_earth_gap_hours: null } };
  const region: Parameters<typeof definitionForPreview>[0] = { execution: { preview: { definition } } } as unknown as Parameters<typeof definitionForPreview>[0];
  expect(definitionForPreview(region)).toBe(definition);
});
