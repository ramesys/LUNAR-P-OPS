import { createApiClient, type ApiClient, type BrushSample, type Candidate, type RoiTerrain, type ScientificEvaluation } from "@clps/api-client";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSX } from "react";
import { createExplorationStore, ExplorationContext, INITIAL, type BrushRegion, type ExplorationStore } from "../lib/explorationStore.ts";
import { evaluation } from "../lib/testFixtures.ts";
import type { RoiTerrain3DProps } from "./RoiTerrain3D.tsx";
import { ShackletonWorkspace } from "./ShackletonWorkspace.tsx";
import { WorkspaceInspector } from "./WorkspaceInspector.tsx";

// The WebGL view is replaced by a probe that prints what the scene receives.
vi.mock("./RoiTerrain3D.tsx", () => ({
  RoiTerrain3D: ({ temporal, draftHeightM, selectedId }: RoiTerrain3DProps): JSX.Element => <p data-testid="scene">
    {temporal === null || temporal === undefined ? "no temporal state" : `${temporal.evaluation.evaluation_id}@${temporal.index.toString()}:${temporal.evaluation.samples[temporal.index]?.time_utc ?? ""}`}
    {` draft=${String(draftHeightM)} selected=${String(selectedId)}`}</p>,
}));

const roiEvaluation: ScientificEvaluation = evaluation();
const root: Candidate = roiEvaluation.candidate;

function countingApi(calls: string[]): ApiClient {
  return createApiClient({ baseUrl: "http://api.test", fetch: (request: Request): Promise<Response> => {
    const path: string = new URL(request.url).pathname;
    calls.push(`${request.method} ${path}`);
    if (path.endsWith("/terrain")) return Promise.resolve(Response.json({ ...TERRAIN }));
    return Promise.resolve(Response.json([root]));
  } });
}

const TERRAIN: RoiTerrain = { roi: { roi_id: "shackleton-rim-b", name: "Shackleton Rim B", center_latitude_deg: -89.5244, center_longitude_deg: 56.30993,
  half_width_m: 2000, center_source_name: "NASA", center_source_url: "https://ntrs.nasa.gov", note: "Proposed", terrain_available: true },
  coordinate_reference: "MOON_ME", projection: "stereographic", reference_radius_m: 1737400, center_projected_m: [12000, 8000],
  east_axis_projected: [0.55, -0.83], north_axis_projected: [0.83, 0.55], stereographic_scale_factor: 1, corners: [],
  latitude_range_deg: [-89.6, -89.4], longitude_range_deg: [47, 66], size: 2, spacing_m: 4000, elevations_m: [0, 0, 0, 0], center_elevation_m: 0,
  elevation_range_m: [0, 1], datasets: [], coverage: { grid_status: "complete", grid_missing_samples: 0, grid_total_samples: 4, horizon_checks: [], note: "" }, limitations: [] };

afterEach(cleanup);

function workspace(store: ExplorationStore, calls: string[]): JSX.Element {
  return <ExplorationContext.Provider value={store}>
    <ShackletonWorkspace apiClient={countingApi(calls)} selectedCandidateId={root.candidate_id} onCandidateSelected={(): void => undefined}
      defaultTimeUtc="2026-11-07T00:00:00Z" defaultObserverHeightM={2} />
    <WorkspaceInspector root={root} child={null} selected={root} selectedRef={null} evaluation={roiEvaluation} c0Result={roiEvaluation} c1Result={null}
      draft={{ observer_height_m: 9, selected_time_utc: root.selected_time_utc }} mode="simple" busy={false}
      onSelectRevision={(): void => undefined} onDraftChange={(): void => undefined} />
  </ExplorationContext.Provider>;
}

describe("space–time synchronization", (): void => {
  it("drives the terrain scene from the shared cursor without any API request", async (): Promise<void> => {
    const store: ExplorationStore = createExplorationStore({ ...INITIAL, rootId: "c0", revisionId: "c0" });
    store.dispatch({ type: "evaluation", evaluation: roiEvaluation });
    store.dispatch({ type: "draft", draft: { observer_height_m: 9, selected_time_utc: root.selected_time_utc } });
    const calls: string[] = [];
    render(workspace(store, calls));
    expect((await screen.findByTestId("scene")).textContent).toBe("e1@0:2026-11-07T00:00:00Z draft=9 selected=c0");
    expect(screen.getByRole("region", { name: "Candidate timeline dock" }).getAttribute("data-active")).toBe("true");
    const before: number = calls.length;
    // Scrub with the original CLPS time control's step button.
    fireEvent.click(screen.getByRole("button", { name: "Step forward" }));
    expect(screen.getByTestId("scene").textContent).toBe("e1@1:2026-11-07T01:00:00Z draft=9 selected=c0");
    expect(screen.getByText(/Inspecting stored sample/).textContent).toContain("2 of 2");
    expect(store.getState().cursorUtc).toBe("2026-11-07T01:00:00Z");
    expect(store.getState().revisionId).toBe("c0");
    expect(calls.length).toBe(before);
  });

  it("plays back stored samples only and never requests a computation", async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const store: ExplorationStore = createExplorationStore({ ...INITIAL, rootId: "c0", revisionId: "c0" });
      store.dispatch({ type: "evaluation", evaluation: roiEvaluation });
      const calls: string[] = [];
      render(workspace(store, calls));
      await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(10); });
      const before: string[] = [...calls];
      act((): void => { store.dispatch({ type: "playing", playing: true }); });
      await act(async (): Promise<void> => { await vi.advanceTimersByTimeAsync(2000); });
      expect(store.getState().cursorUtc).toBe("2026-11-07T01:00:00Z");
      expect(store.getState().playing).toBe(false);
      expect(calls).toEqual(before);
      expect(calls.some((call: string): boolean => call.startsWith("POST"))).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("does not draw another terrain window's result in the Shackleton scene", async (): Promise<void> => {
    const sampleA: ScientificEvaluation = { ...roiEvaluation, candidate: { ...root, terrain_window_id: "sample-a" } };
    const store: ExplorationStore = createExplorationStore({ ...INITIAL, rootId: "c0", revisionId: "c0" });
    store.dispatch({ type: "evaluation", evaluation: sampleA });
    render(workspace(store, []));
    expect((await screen.findByTestId("scene")).textContent).toContain("no temporal state");
  });
});

it("compares exact UTC samples across region results without a write", async (): Promise<void> => {
  const store: ExplorationStore = createExplorationStore({ ...INITIAL, rootId: "c0", revisionId: "c0" });
  store.dispatch({ type: "evaluation", evaluation: roiEvaluation });
  const { defaultParams, definitionOf } = await import("./ConstraintBrush.tsx");
  store.dispatch({ type: "region-create", id: "region", params: defaultParams("2026-11-07T00:00:00Z") });
  const region: BrushRegion | undefined = store.getState().regions[0];
  if (region === undefined) throw new Error("region missing");
  const sample: BrushSample = { east_m: 0, north_m: 0, status: "READY" as const, candidate_id: "c0", already_persisted: true,
    iteration: 0, parent_candidate_ids: [], parent_evaluation_ids: [] };
  const shifted: ScientificEvaluation = { ...roiEvaluation, evaluation_id: "shifted", samples: roiEvaluation.samples.map((s) => ({ ...s, time_utc: "2026-11-07T00:30:00Z" })) };
  store.dispatch({ type: "region-execution", regionId: "region", revision: region.revision, execution: {
    schema_version: "lunar-ops-brush/1", preview: { definition: definitionOf(region), coordinate_reference: "", alignment: "", tolerance_m: 0,
      samples: [sample], ready_count: 1, new_count: 0, existing_count: 1, temporal_samples_per_point: 2, estimated_total_samples: 2, preview_token: "token" },
    results: [{ sample, verdict: "PASS", candidate: root, evaluation: roiEvaluation, persisted: true, errors: [] },
      { sample: { ...sample, candidate_id: "c2" }, verdict: "PASS", candidate: root, evaluation: shifted, persisted: true, errors: [] }], notes: [],
  } });
  const calls: string[] = [];
  render(workspace(store, calls));
  await screen.findByTestId("scene");
  fireEvent.click(screen.getByText("Compare region results at the cursor UTC"));
  expect(screen.getAllByText("unsampled").length).toBeGreaterThan(0);
  const before: number = calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Step forward" }));
  expect(calls.length).toBe(before);
  expect(calls.every((call): boolean => !call.startsWith("POST"))).toBe(true);
});
