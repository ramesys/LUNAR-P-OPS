import type { Candidate, CandidateRef, ScientificEvaluation } from "@clps/api-client";
import { ClassicPreset, NodeEditor, type GetSchemes } from "rete";

export interface ScientificNodeContract {
  input_types: Record<string, string>;
  output_types: Record<string, string>;
  units: string;
  reference_frame: string;
  data_sources: string[];
  algorithm: string;
  execution_status: "succeeded" | "unavailable" | "failed" | "pending";
  validation_status: "unverified" | "independently_validated";
  errors: string[];
  warnings: string[];
}

export interface CandidatePreview { latitude_deg: number; longitude_deg: number; terrain_elevation_m: number; observer_height_m: number; selected_time_utc: string }
/** Unsaved parameter assembly; never sent to the scientific computation. */
export type PreviewResult = { status: "valid"; value: CandidatePreview } | { status: "invalid"; error: string };

export interface EvaluationSettings { duration_hours: number; step_minutes: number }
/** Typed reference to one persisted evaluation, produced only from an API response. */
export interface EvaluationRef {
  schema_version: "evaluation-ref/1";
  evaluation_id: string;
  candidate_id: string;
  status: ScientificEvaluation["status"];
  origin: "computed" | "restored";
}

export const CANDIDATE_REF_SCHEMA: CandidateRef["schema_version"] = "candidate-ref/1";

export function isCandidateRef(value: unknown): value is CandidateRef {
  if (typeof value !== "object" || value === null) return false;
  const ref: Partial<CandidateRef> = value;
  return ref.schema_version === CANDIDATE_REF_SCHEMA && typeof ref.candidate_id === "string" &&
    typeof ref.site_id === "string" && typeof ref.snapshot_sha256 === "string";
}

function isEvaluationRef(value: unknown): value is EvaluationRef {
  if (typeof value !== "object" || value === null) return false;
  const ref: Partial<EvaluationRef> = value;
  return ref.schema_version === "evaluation-ref/1" && typeof ref.evaluation_id === "string" && typeof ref.candidate_id === "string";
}

export function evaluationRef(evaluation: ScientificEvaluation, origin: EvaluationRef["origin"]): EvaluationRef {
  return { schema_version: "evaluation-ref/1", evaluation_id: evaluation.evaluation_id, candidate_id: evaluation.candidate_id,
    status: evaluation.status, origin };
}

/** Sockets are shared objects: a connection is accepted only between identical socket types. */
export const SOCKETS: { candidateRef: ClassicPreset.Socket; evaluationRef: ClassicPreset.Socket; preview: ClassicPreset.Socket } = {
  candidateRef: new ClassicPreset.Socket("CandidateRef"),
  evaluationRef: new ClassicPreset.Socket("EvaluationRef"),
  preview: new ClassicPreset.Socket("CandidatePreview"),
};

export class LandingNode extends ClassicPreset.Node {
  value: unknown;
  contract: ScientificNodeContract;
  execute?: (inputs: Record<string, unknown[]>) => Promise<Record<string, unknown>>;
  constructor(label: string, value: unknown, contract: ScientificNodeContract) {
    super(label);
    this.value = value;
    this.contract = contract;
  }
  data(inputs: Record<string, unknown[]>): Record<string, unknown> | Promise<Record<string, unknown>> {
    if (this.execute !== undefined) return this.execute(inputs);
    if (this.label !== "Candidate") return { value: this.value };
    // The committed reference never depends on the unsaved preview inputs.
    const candidateRef: CandidateRef | null = isCandidateRef(this.value) ? this.value : null;
    const location: unknown = inputs["location"]?.[0];
    const terrain: unknown = inputs["terrain"]?.[0];
    const height: unknown = inputs["height"]?.[0];
    const time: unknown = inputs["time"]?.[0];
    if (typeof location !== "object" || location === null || typeof terrain !== "object" || terrain === null ||
        typeof height !== "number" || !Number.isFinite(height) || height < 0 || height > 100 ||
        typeof time !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z$/.test(time) ||
        !Number.isFinite(Date.parse(time))) {
      const preview: PreviewResult = { status: "invalid", error: "Connect valid location, terrain, height (0–100 m), and UTC time." };
      return { preview, candidate_ref: candidateRef };
    }
    const preview: PreviewResult = { status: "valid", value: { ...location, ...terrain, observer_height_m: height, selected_time_utc: time } as CandidatePreview };
    return { preview, candidate_ref: candidateRef };
  }
}
export type LandingConnection = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
export interface LandingNodes { nodes: LandingNode[]; height: LandingNode; time: LandingNode; candidate: LandingNode; committed: ClassicPreset.InputControl<"text"> }
export type LandingScheme = GetSchemes<LandingNode, LandingConnection>;

export function describeRef(ref: CandidateRef | null, label: string): string {
  return ref === null ? "No committed candidate" : `${label} · ${ref.candidate_id.slice(0, 22)}…`;
}

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
  const result: LandingNode = new LandingNode("Candidate", null, contract({
    preview: "CandidatePreview (unsaved live preview; not evaluated)",
    candidate_ref: "CandidateRef {schema_version, candidate_id, site_id, parent_candidate_id, terrain_window_id, snapshot_sha256} of a persisted candidate",
  }, "degrees, m, UTC", "candidate-preview/assembly-v1 + persisted candidate-ref/1"));
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
  result.addOutput("preview", new ClassicPreset.Output(SOCKETS.preview, "Preview (unsaved)"));
  result.addOutput("candidate_ref", new ClassicPreset.Output(SOCKETS.candidateRef, "candidate_ref: CandidateRef"));
  const committed: ClassicPreset.InputControl<"text"> = new ClassicPreset.InputControl("text", { readonly: true, initial: describeRef(null, "") });
  result.addControl("committed", committed);
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
  return { nodes, height, time, candidate: result, committed };
}

/** Backend calls used by the scientific nodes (the Python service stays the only scientific engine). */
export interface ScienceApi {
  getCandidate: (id: string) => Promise<Candidate>;
  getCandidateRef: (id: string) => Promise<CandidateRef>;
  listEvaluations: (id: string) => Promise<ScientificEvaluation[]>;
  evaluate: (id: string, settings: EvaluationSettings) => Promise<ScientificEvaluation>;
  getEvaluation: (id: string) => Promise<ScientificEvaluation>;
}

function settingsKey(candidateId: string, settings: EvaluationSettings): string {
  return `${candidateId}|${settings.duration_hours.toString()}|${settings.step_minutes.toString()}`;
}

/**
 * Receives a CandidateRef. Without an explicit request it only restores the latest persisted
 * evaluation; after `request()` the next dataflow fetch for that reference runs the backend once.
 * Results are memoised per request, so Rete cache resets and React renders never repeat a POST.
 */
export class ScientificComputationNode extends LandingNode {
  settings: EvaluationSettings = { duration_hours: 24, step_minutes: 60 };
  backendCalls: number = 0;
  private requested: string | null = null;
  private readonly memo: Map<string, Promise<EvaluationRef | null>> = new Map<string, Promise<EvaluationRef | null>>();
  private readonly api: ScienceApi;

  constructor(api: ScienceApi, contract: ScientificNodeContract) {
    super("Scientific computation", null, contract);
    this.api = api;
  }

  /** The explicit Evaluate action. */
  request(candidateId: string, settings: EvaluationSettings): void {
    this.settings = { ...settings };
    this.requested = settingsKey(candidateId, this.settings);
  }

  override data(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    const ref: unknown = inputs["candidate_ref"]?.[0];
    if (!isCandidateRef(ref)) {
      return Promise.reject(new Error("No CandidateRef received: connect Candidate.candidate_ref to Scientific computation."));
    }
    const key: string = settingsKey(ref.candidate_id, this.settings);
    const memoKey: string = this.requested === key ? `run|${key}` : `restore|${ref.candidate_id}`;
    let pending: Promise<EvaluationRef | null> | undefined = this.memo.get(memoKey);
    if (pending === undefined) {
      pending = this.requested === key ? this.run(ref, { ...this.settings }) : this.restore(ref);
      this.memo.set(memoKey, pending);
      pending.catch((): void => { this.memo.delete(memoKey); });
    }
    return pending.then((evaluation_ref: EvaluationRef | null): Record<string, unknown> => ({ evaluation_ref }));
  }

  private async restore(ref: CandidateRef): Promise<EvaluationRef | null> {
    const stored: ScientificEvaluation[] = await this.api.listEvaluations(ref.candidate_id);
    const latest: ScientificEvaluation | undefined = stored.at(-1);
    return latest === undefined ? null : evaluationRef(latest, "restored");
  }

  private async run(ref: CandidateRef, settings: EvaluationSettings): Promise<EvaluationRef> {
    const authoritative: Candidate = await this.api.getCandidate(ref.candidate_id);
    if (authoritative.candidate_id !== ref.candidate_id || authoritative.site_id !== ref.site_id) {
      throw new Error("CandidateRef does not match the stored candidate.");
    }
    const current: CandidateRef = await this.api.getCandidateRef(ref.candidate_id);
    if (current.snapshot_sha256 !== ref.snapshot_sha256) throw new Error("Stored candidate snapshot differs from the CandidateRef.");
    this.backendCalls++;
    const evaluation: ScientificEvaluation = await this.api.evaluate(ref.candidate_id, settings);
    if (evaluation.candidate_id !== ref.candidate_id) throw new Error("Evaluation belongs to a different candidate.");
    this.memo.delete(`restore|${ref.candidate_id}`);
    return evaluationRef(evaluation, "computed");
  }
}

/** Receives an EvaluationRef and outputs the persisted evaluation retrieved from the API. */
export class ResultsNode extends LandingNode {
  private readonly memo: Map<string, Promise<ScientificEvaluation>> = new Map<string, Promise<ScientificEvaluation>>();
  private readonly api: ScienceApi;
  constructor(api: ScienceApi, contract: ScientificNodeContract) {
    super("Results", null, contract);
    this.api = api;
  }
  override data(inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
    const received: unknown[] | undefined = inputs["evaluation_ref"];
    if (received === undefined) return Promise.reject(new Error("No EvaluationRef received: connect Scientific computation to Results."));
    const ref: unknown = received[0];
    if (ref === null) return Promise.resolve({ evaluation: null, evaluation_ref: null });
    if (!isEvaluationRef(ref)) return Promise.reject(new Error("Invalid EvaluationRef."));
    let pending: Promise<ScientificEvaluation> | undefined = this.memo.get(ref.evaluation_id);
    if (pending === undefined) {
      pending = this.api.getEvaluation(ref.evaluation_id).then((evaluation: ScientificEvaluation): ScientificEvaluation => {
        if (evaluation.evaluation_id !== ref.evaluation_id || evaluation.candidate_id !== ref.candidate_id) {
          throw new Error("Persisted evaluation does not match its EvaluationRef.");
        }
        return evaluation;
      });
      this.memo.set(ref.evaluation_id, pending);
      pending.catch((): void => { this.memo.delete(ref.evaluation_id); });
    }
    return pending.then((evaluation: ScientificEvaluation): Record<string, unknown> => ({ evaluation, evaluation_ref: ref }));
  }
}

export interface ScientificNodes {
  nodes: LandingNode[];
  compute: ScientificComputationNode;
  result: ResultsNode;
  computeStatus: ClassicPreset.InputControl<"text">;
  display: ClassicPreset.InputControl<"text">;
}

export async function addScientificNodes(editor: NodeEditor<LandingScheme>, candidateNode: LandingNode, candidate: Candidate,
  api: ScienceApi, active: () => boolean = (): boolean => true): Promise<ScientificNodes> {
  const base: ScientificNodeContract = { input_types: {}, output_types: {}, units: "UTC, degrees, metres, seconds",
    reference_frame: candidate.coordinate_reference, data_sources: [candidate.terrain_source_url],
    algorithm: "candidate-horizon-spice-v1 (FastAPI / Python)", execution_status: "pending", validation_status: "unverified",
    errors: [], warnings: ["No scientific evaluation has been executed."] };
  const compute: ScientificComputationNode = new ScientificComputationNode(api, { ...base,
    input_types: { candidate_ref: "CandidateRef" }, output_types: { evaluation_ref: "EvaluationRef (persisted)" } });
  const result: ResultsNode = new ResultsNode(api, { ...base,
    input_types: { evaluation_ref: "EvaluationRef" }, output_types: { evaluation: "persisted evaluation" }, algorithm: "result-inspector/v1" });
  compute.addInput("candidate_ref", new ClassicPreset.Input(SOCKETS.candidateRef, "candidate_ref: CandidateRef"));
  compute.addOutput("evaluation_ref", new ClassicPreset.Output(SOCKETS.evaluationRef, "evaluation_ref: EvaluationRef"));
  result.addInput("evaluation_ref", new ClassicPreset.Input(SOCKETS.evaluationRef, "evaluation_ref: EvaluationRef"));
  const computeStatus: ClassicPreset.InputControl<"text"> = new ClassicPreset.InputControl("text", { readonly: true, initial: "Waiting for Evaluate" });
  compute.addControl("status", computeStatus);
  const display: ClassicPreset.InputControl<"text"> = new ClassicPreset.InputControl("text", { readonly: true, initial: "Not evaluated" });
  result.addControl("status", display);
  const nodes: LandingNode[] = [compute, result];
  for (const node of nodes) { if (!active()) throw new Error("Graph setup cancelled"); await editor.addNode(node); }
  for (const [source, output, target, input] of [[candidateNode, "candidate_ref", compute, "candidate_ref"], [compute, "evaluation_ref", result, "evaluation_ref"]] as const) {
    if (!active()) throw new Error("Graph setup cancelled");
    await editor.addConnection(new ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>(source, output, target, input));
  }
  return { nodes, compute, result, computeStatus, display };
}
