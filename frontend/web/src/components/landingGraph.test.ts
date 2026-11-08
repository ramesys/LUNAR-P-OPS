import { describe, expect, it } from "vitest";
import { NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import { addScientificNodes, addTerrainNode, buildLandingNodes, DEFAULT_TERRAIN_CONSTRAINTS, describeTerrain, type EvaluationSettings, type LandingConnection, type LandingNodes, type LandingScheme, type PreviewResult,
  type ScienceApi, type ScientificNodes, type TerrainApi } from "./landingGraph.ts";
import { terrainScreen } from "../lib/testFixtures.ts";
import type { Candidate, CandidateRef, ScientificEvaluation, TerrainScreen, TerrainScreenConstraints } from "@clps/api-client";

const candidate: Candidate = { terrain_dataset_sha256: "hash", terrain_nodata: "NaN", coverage_bounds_m: [0, 0, 1, 1], candidate_id: "c0", site_id: "site", latitude_deg: -89.5,
  longitude_deg: 0, terrain_elevation_m: -721, observer_height_m: 2,
  selected_time_utc: "2026-02-01T00:00:00Z", terrain_dataset_id: "LOLA",
  terrain_source_url: "https://example.org", dem_resolution_m: 20,
  coordinate_reference: "MOON_ME", validation_status: "not_independently_validated", data_availability: "available", terrain_window_id: "sample-a" };
const child: Candidate = { ...candidate, candidate_id: "c1", parent_candidate_id: "c0", observer_height_m: 6 };

function ref(c: Candidate): CandidateRef {
  return { schema_version: "candidate-ref/1", candidate_id: c.candidate_id, site_id: c.site_id, parent_candidate_id: c.parent_candidate_id ?? null,
    terrain_window_id: c.terrain_window_id, snapshot_sha256: `sha-${c.candidate_id}` };
}

function evaluation(id: string, candidateId: string, settings?: EvaluationSettings): ScientificEvaluation {
  return { evaluation_id: id, candidate_id: candidateId, status: "COMPUTED_UNVERIFIED", request: settings ?? { duration_hours: 24, step_minutes: 60 },
    candidate: candidateId === "c0" ? candidate : child, provenance: {}, warnings: [], errors: [], horizon_azimuth_deg: [],
    horizon_elevation_deg: [], samples: [], intervals: {} };
}

/** Fake FastAPI persistence: evaluate() appends to the stored list, like the real endpoint. */
function fakeApi(log: string[]): ScienceApi {
  const stored: Map<string, ScientificEvaluation[]> = new Map<string, ScientificEvaluation[]>([["c0", [evaluation("e-old", "c0")]]]);
  const all: () => ScientificEvaluation[] = (): ScientificEvaluation[] => [...stored.values()].flat();
  return {
    getCandidate: (id: string): Promise<Candidate> => { log.push(`GET candidate ${id}`); return Promise.resolve(id === "c0" ? candidate : child); },
    getCandidateRef: (id: string): Promise<CandidateRef> => Promise.resolve(ref(id === "c0" ? candidate : child)),
    listEvaluations: (id: string): Promise<ScientificEvaluation[]> => { log.push(`LIST ${id}`); return Promise.resolve(stored.get(id) ?? []); },
    evaluate: (id: string, settings: EvaluationSettings): Promise<ScientificEvaluation> => {
      log.push(`POST ${id} ${settings.duration_hours.toString()}h`);
      const created: ScientificEvaluation = evaluation(`e-${id}-${settings.duration_hours.toString()}`, id, settings);
      stored.set(id, [...(stored.get(id) ?? []), created]);
      return Promise.resolve(created);
    },
    getEvaluation: (id: string): Promise<ScientificEvaluation> => {
      const found: ScientificEvaluation | undefined = all().find((e: ScientificEvaluation): boolean => e.evaluation_id === id);
      return found === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(found);
    },
  };
}

interface TestGraph { engine: DataflowEngine<LandingScheme>; editor: NodeEditor<LandingScheme>; landing: LandingNodes; science: ScientificNodes }

async function graph(api: ScienceApi): Promise<TestGraph> {
  const editor: NodeEditor<LandingScheme> = new NodeEditor<LandingScheme>();
  const engine: DataflowEngine<LandingScheme> = new DataflowEngine<LandingScheme>();
  editor.use(engine);
  const landing: LandingNodes = await buildLandingNodes(editor, candidate, (): void => { /* no UI in this test */ });
  const science: ScientificNodes = await addScientificNodes(editor, landing.candidate, candidate, api);
  return { engine, editor, landing, science };
}

async function resultOf(g: { engine: DataflowEngine<LandingScheme>; science: ScientificNodes }): Promise<ScientificEvaluation | null> {
  return (await g.engine.fetch(g.science.result.id))["evaluation"] as ScientificEvaluation | null;
}

describe("landing dataflow", () => {
  it("routes actual candidate parameters and recomputes preview after an edit", async () => {
    const g: TestGraph = await graph(fakeApi([]));
    const initial: PreviewResult = (await g.engine.fetch(g.landing.candidate.id))["preview"] as PreviewResult;
    expect(initial).toMatchObject({ status: "valid", value: { observer_height_m: 2, terrain_elevation_m: -721 } });
    g.landing.height.value = 5;
    g.engine.reset(g.landing.height.id);
    const changed: PreviewResult = (await g.engine.fetch(g.landing.candidate.id))["preview"] as PreviewResult;
    expect(changed).toMatchObject({ status: "valid", value: { observer_height_m: 5, terrain_elevation_m: -721 } });
    g.landing.time.value = "not a time";
    g.engine.reset(g.landing.time.id);
    expect((await g.engine.fetch(g.landing.candidate.id))["preview"]).toMatchObject({ status: "invalid" });
    expect(candidate.observer_height_m).toBe(2);
    expect(g.landing.nodes.every((node) => node.contract.algorithm.length > 0 && node.contract.validation_status === "unverified")).toBe(true);
  });

  it("propagates the committed CandidateRef, not the unsaved preview, to the scientific computation", async () => {
    const log: string[] = [];
    const g: TestGraph = await graph(fakeApi(log));
    // No CandidateRef on the output yet: the computation refuses to run.
    await expect(g.engine.fetch(g.science.result.id)).rejects.toThrow(/No CandidateRef/);
    g.landing.candidate.value = ref(candidate);
    g.engine.reset(g.landing.candidate.id);
    expect((await resultOf(g))?.evaluation_id).toBe("e-old");
    expect(log).toEqual(["LIST c0"]);
    // An edited, uncommitted height does not change the reference or trigger a calculation.
    g.landing.height.value = 9;
    g.engine.reset(g.landing.height.id);
    expect((await g.engine.fetch(g.landing.candidate.id))["candidate_ref"]).toEqual(ref(candidate));
    expect((await resultOf(g))?.evaluation_id).toBe("e-old");
    expect(log.filter((entry: string): boolean => entry.startsWith("POST"))).toEqual([]);

    g.science.compute.request("c0", { duration_hours: 12, step_minutes: 60 });
    g.engine.reset(g.science.compute.id);
    const computed: ScientificEvaluation | null = await resultOf(g);
    expect(computed).toMatchObject({ evaluation_id: "e-c0-12", candidate_id: "c0", request: { duration_hours: 12 } });
    expect(log).toContain("GET candidate c0");
    // Repeated cache resets (re-renders, preview edits) never repeat the POST.
    for (let i: number = 0; i < 3; i++) { g.engine.reset(); await resultOf(g); }
    expect(log.filter((entry: string): boolean => entry.startsWith("POST"))).toEqual(["POST c0 12h"]);

    g.landing.candidate.value = ref(child);
    g.engine.reset(g.landing.candidate.id);
    expect(await resultOf(g)).toBeNull();
    g.science.compute.request("c1", { duration_hours: 6, step_minutes: 60 });
    g.engine.reset(g.science.compute.id);
    expect(await resultOf(g)).toMatchObject({ evaluation_id: "e-c1-6", candidate_id: "c1" });
    expect(g.science.compute.backendCalls).toBe(2);
  });

  it("needs a real connection and an unchanged snapshot", async () => {
    const log: string[] = [];
    const api: ScienceApi = fakeApi(log);
    const g: TestGraph = await graph({ ...api, getCandidateRef: (): Promise<CandidateRef> => Promise.resolve({ ...ref(candidate), snapshot_sha256: "changed" }) });
    g.landing.candidate.value = ref(candidate);
    g.science.compute.request("c0", { duration_hours: 24, step_minutes: 60 });
    await expect(g.engine.fetch(g.science.result.id)).rejects.toThrow(/snapshot/);
    expect(log.filter((entry: string): boolean => entry.startsWith("POST"))).toEqual([]);
    const wire: LandingConnection | undefined = g.editor.getConnections().find((c) => c.target === g.science.compute.id);
    expect(wire?.sourceOutput).toBe("candidate_ref");
    if (wire !== undefined) await g.editor.removeConnection(wire.id);
    g.engine.reset(g.science.compute.id);
    await expect(g.engine.fetch(g.science.result.id)).rejects.toThrow(/No CandidateRef/);
  });
});

it("stops constructing a graph after its host is disposed", async () => {
  const editor: NodeEditor<LandingScheme> = new NodeEditor<LandingScheme>();
  let checks: number = 0;
  await expect(buildLandingNodes(editor, candidate, (): void => { /* no UI */ }, (): boolean => ++checks < 2))
    .rejects.toThrow("Graph setup cancelled");
  expect(editor.getNodes()).toHaveLength(1);
});

describe("terrain screen node", (): void => {
  it("receives candidate_ref through the existing graph and memoises one request per limit set", async (): Promise<void> => {
    const editor: NodeEditor<LandingScheme> = new NodeEditor<LandingScheme>();
    const engine: DataflowEngine<LandingScheme> = new DataflowEngine<LandingScheme>();
    editor.use(engine);
    const calls: string[] = [];
    const api: TerrainApi = { screenTerrain: (id: string, constraints: TerrainScreenConstraints): Promise<TerrainScreen> => {
      calls.push(`${id}:${String(constraints.max_local_slope_deg)}`);
      return Promise.resolve(terrainScreen({ screen_id: `s-${id}-${String(constraints.max_local_slope_deg)}` }));
    } };
    const landing: LandingNodes = await buildLandingNodes(editor, candidate, (): void => undefined);
    const terrain: Awaited<ReturnType<typeof addTerrainNode>> = await addTerrainNode(editor, landing.candidate, candidate, api);
    // Still a single graph: the terrain node hangs off the same Candidate.candidate_ref output.
    expect(editor.getConnections().filter((c: LandingConnection): boolean => c.source === landing.candidate.id && c.sourceOutput === "candidate_ref")).toHaveLength(1);
    await expect(engine.fetch(terrain.node.id)).rejects.toThrow(/No CandidateRef/);
    landing.candidate.value = ref(candidate);
    engine.reset(landing.candidate.id);
    const first: Record<string, unknown> = await engine.fetch(terrain.node.id);
    expect((first["terrain_screen"] as TerrainScreen).screen_id).toBe("s-c0-12");
    engine.reset(terrain.node.id);
    await engine.fetch(terrain.node.id);
    expect(calls).toEqual(["c0:12"]);
    terrain.node.setConstraints({ ...DEFAULT_TERRAIN_CONSTRAINTS, max_local_slope_deg: 8 });
    engine.reset(terrain.node.id);
    const stricter: Record<string, unknown> = await engine.fetch(terrain.node.id);
    expect((stricter["terrain_screen"] as TerrainScreen).screen_id).toBe("s-c0-8");
    expect(calls).toEqual(["c0:12", "c0:8"]);
    expect(terrain.node.contract.warnings.join(" ")).toMatch(/not certified landing safety/);
  });

  it("summarises verdicts and never shows missing metrics as numbers", (): void => {
    expect(describeTerrain(terrainScreen())).toEqual({ verdict: "Terrain FAIL · COMPUTED_UNVERIFIED", metrics: "slope 14.2° (plane 13.4°) · RMS 0.91 m" });
    const missing: TerrainScreen = terrainScreen({ status: "UNAVAILABLE", verdict: "NOT_ASSESSED", slope: null, roughness: null });
    expect(describeTerrain(missing)).toEqual({ verdict: "Terrain NOT ASSESSED · UNAVAILABLE", metrics: "slope not assessed (plane not assessed) · RMS not assessed" });
  });
});
