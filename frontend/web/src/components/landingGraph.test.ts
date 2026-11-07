import { describe, expect, it } from "vitest";
import { NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import { buildLandingNodes, type LandingNodes, type LandingScheme } from "./landingGraph.ts";
import type { Candidate } from "@clps/api-client";

const candidate: Candidate = { terrain_dataset_sha256: "hash", terrain_nodata: "NaN", coverage_bounds_m: [0, 0, 1, 1], candidate_id: "c0", site_id: "site", latitude_deg: -89.5,
  longitude_deg: 0, terrain_elevation_m: -721, observer_height_m: 2,
  selected_time_utc: "2026-02-01T00:00:00Z", terrain_dataset_id: "LOLA",
  terrain_source_url: "https://example.org", dem_resolution_m: 20,
  coordinate_reference: "MOON_ME", validation_status: "not_independently_validated", data_availability: "available" };

describe("landing dataflow", () => {
  it("routes actual candidate parameters and recomputes preview after an edit", async () => {
    const editor: NodeEditor<LandingScheme> = new NodeEditor<LandingScheme>();
    const engine: DataflowEngine<LandingScheme> = new DataflowEngine<LandingScheme>();
    editor.use(engine);
    const graph: LandingNodes = await buildLandingNodes(editor, candidate, (): void => { /* no UI in this test */ });
    const initial: Record<string, unknown> = await engine.fetch(graph.result.id);
    expect(initial["value"]).toMatchObject({ observer_height_m: 2, terrain_elevation_m: -721 });
    graph.height.value = 5;
    engine.reset();
    const changed: Record<string, unknown> = await engine.fetch(graph.result.id);
    expect(changed["value"]).toMatchObject({ observer_height_m: 5, terrain_elevation_m: -721 });
    expect(candidate.observer_height_m).toBe(2);
    expect(graph.nodes.every((node) => node.contract.algorithm.length > 0 && node.contract.validation_status === "unverified")).toBe(true);
  });
});

it("stops constructing a graph after its host is disposed", async () => {
  const editor: NodeEditor<LandingScheme> = new NodeEditor<LandingScheme>();
  let checks: number = 0;
  await expect(buildLandingNodes(editor, candidate, (): void => { /* no UI */ }, (): boolean => ++checks < 2))
    .rejects.toThrow("Graph setup cancelled");
  expect(editor.getNodes()).toHaveLength(1);
});
