import type { Candidate } from "@clps/api-client";
import { ClassicPreset, NodeEditor, type GetSchemes } from "rete";

export interface ScientificNodeContract {
  input_types: Record<string, string>;
  output_types: Record<string, string>;
  units: string;
  reference_frame: string;
  data_sources: string[];
  algorithm: string;
  execution_status: "succeeded" | "unavailable" | "failed";
  validation_status: "unverified" | "independently_validated";
  errors: string[];
  warnings: string[];
}

export class LandingNode extends ClassicPreset.Node {
  value: unknown;
  contract: ScientificNodeContract;
  constructor(label: string, value: unknown, contract: ScientificNodeContract) {
    super(label);
    this.value = value;
    this.contract = contract;
  }
  data(inputs: Record<string, unknown[]>): Record<string, unknown> {
    if (this.label !== "Candidate") return { value: this.value };
    const location: unknown = inputs["location"]?.[0];
    const terrain: unknown = inputs["terrain"]?.[0];
    const height: unknown = inputs["height"]?.[0];
    const time: unknown = inputs["time"]?.[0];
    if (typeof location !== "object" || location === null || typeof terrain !== "object" || terrain === null ||
        typeof height !== "number" || !Number.isFinite(height) || height < 0 || height > 100 ||
        typeof time !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z$/.test(time) ||
        !Number.isFinite(Date.parse(time))) throw new Error("Connect valid location, terrain, height (0–100 m), and UTC time.");
    return { value: { ...location, ...terrain, observer_height_m: height, selected_time_utc: time } };
  }
}
export type LandingConnection = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
export interface LandingNodes { nodes: LandingNode[]; height: LandingNode; result: LandingNode }
export type LandingScheme = GetSchemes<LandingNode, LandingConnection>;

export async function buildLandingNodes(editor: NodeEditor<LandingScheme>, candidate: Candidate,
  onChange: () => void, isActive: () => boolean = (): boolean => true): Promise<LandingNodes> {
  const contract: (outputs: Record<string, string>, units: string, algorithm: string) => ScientificNodeContract = (outputs: Record<string, string>, units: string, algorithm: string): ScientificNodeContract => ({
    input_types: {}, output_types: outputs, units, reference_frame: candidate.coordinate_reference,
    data_sources: algorithm === "parameter/v1"
      ? ["Candidate snapshot / user input"]
      : [candidate.terrain_source_url, `Local window SHA-256: ${candidate.terrain_dataset_sha256}`],
    algorithm, execution_status: "succeeded",
    validation_status: "unverified", errors: [], warnings: ["Not independently validated for this candidate."]
  });
  const location: LandingNode = new LandingNode("Location", { latitude_deg: candidate.latitude_deg, longitude_deg: candidate.longitude_deg },
    contract({ value: "planetocentric latitude and east longitude" }, "degrees", "lunar_core.polar_stereographic_south_inverse/v1"));
  const terrain: LandingNode = new LandingNode("Terrain", { terrain_elevation_m: candidate.terrain_elevation_m },
    contract({ value: "terrain elevation" }, "m above 1737400 m sphere", "lunar_core.TerrainGrid.sample/bilinear-v1"));
  const height: LandingNode = new LandingNode("Observer Height", candidate.observer_height_m, contract({ value: "number" }, "m", "parameter/v1"));
  const time: LandingNode = new LandingNode("Time", candidate.selected_time_utc, contract({ value: "UTC datetime" }, "ISO 8601 UTC", "parameter/v1"));
  const result: LandingNode = new LandingNode("Candidate", null, contract({ value: "candidate preview" }, "degrees, m, UTC", "candidate-preview/assembly-v1"));
  result.contract.input_types = { location: "location", terrain: "elevation", height: "number", time: "UTC datetime" };
  const specs: { node: LandingNode; key: string; label: string }[] = [
    {node: location, key: "location", label: "Location"}, {node: terrain, key: "terrain", label: "Terrain"},
    {node: height, key: "height", label: "Height (m)"}, {node: time, key: "time", label: "UTC time"},
  ];
  for (const spec of specs) {
    const socket: ClassicPreset.Socket = new ClassicPreset.Socket(spec.key);
    spec.node.addOutput("value", new ClassicPreset.Output(socket, spec.label));
    result.addInput(spec.key, new ClassicPreset.Input(socket, spec.label));
  }
  location.addControl("value", new ClassicPreset.InputControl("text", { readonly: true,
    initial: `${candidate.latitude_deg.toFixed(5)}°, ${candidate.longitude_deg.toFixed(5)}° E` }));
  terrain.addControl("value", new ClassicPreset.InputControl("text", { readonly: true,
    initial: `${candidate.terrain_elevation_m.toFixed(2)} m` }));
  height.addControl("value", new ClassicPreset.InputControl("number", { initial: candidate.observer_height_m,
    change: (value: number): void => { height.value = value; onChange(); } }));
  time.addControl("value", new ClassicPreset.InputControl("text", { initial: candidate.selected_time_utc,
    change: (value: string): void => { time.value = value; onChange(); } }));
  const nodes: LandingNode[] = [location, terrain, height, time, result];
  for (const node of nodes) {
    if (!isActive()) throw new Error("Graph setup cancelled");
    await editor.addNode(node);
  }
  for (const spec of specs) {
    if (!isActive()) throw new Error("Graph setup cancelled");
    await editor.addConnection(new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(spec.node, "value", result, spec.key));
  }
  return { nodes, height, result };
}
