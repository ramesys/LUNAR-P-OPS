import type { ApiClient, Candidate, CandidateRef, ScientificEvaluation } from "@clps/api-client";
import { useEffect, useRef, useState, type JSX, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { NodeEditor } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { Cancelled, DataflowEngine } from "rete-engine";
import { ReactPlugin, Presets, type ReactArea2D } from "rete-react-plugin";
import {
  addScientificNodes,
  buildLandingNodes,
  describeRef,
  type CandidatePreview,
  type EvaluationSettings,
  type LandingConnection,
  type LandingNode,
  type LandingNodes,
  type LandingScheme,
  type PreviewResult,
  type ScienceApi,
  type ScientificNodes,
} from "./landingGraph.ts";

import { SelectionGuard } from "../lib/selectionGuard.ts";
import { ScientificResults } from "./ScientificResults.tsx";

type Extra = ReactArea2D<LandingScheme>;
interface Graph { engine: DataflowEngine<LandingScheme>; area: AreaPlugin<LandingScheme, Extra>; landing: LandingNodes; science: ScientificNodes }
type Outcome = { evaluation: ScientificEvaluation | null; error: null } | { evaluation: null; error: string };

function scienceApi(apiClient: ApiClient): ScienceApi {
  const path: (id: string) => { params: { path: { candidate_id: string } } } = (id: string): { params: { path: { candidate_id: string } } } => ({ params: { path: { candidate_id: id } } });
  return {
    getCandidate: async (id: string): Promise<Candidate> => {
      const { data } = await apiClient.GET("/api/candidates/{candidate_id}", path(id));
      if (data === undefined) throw new Error("Candidate not found in the API.");
      return data;
    },
    getCandidateRef: async (id: string): Promise<CandidateRef> => {
      const { data } = await apiClient.GET("/api/candidates/{candidate_id}/ref", path(id));
      if (data === undefined) throw new Error("CandidateRef unavailable.");
      return data;
    },
    listEvaluations: async (id: string): Promise<ScientificEvaluation[]> => {
      const { data } = await apiClient.GET("/api/candidates/{candidate_id}/evaluations", path(id));
      if (data === undefined) throw new Error("Stored evaluations unavailable.");
      return data;
    },
    evaluate: async (id: string, settings: EvaluationSettings): Promise<ScientificEvaluation> => {
      const { data } = await apiClient.POST("/api/candidates/{candidate_id}/evaluations", { ...path(id), body: settings });
      if (data === undefined) throw new Error("Scientific evaluation request failed.");
      return data;
    },
    getEvaluation: async (id: string): Promise<ScientificEvaluation> => {
      const { data } = await apiClient.GET("/api/evaluations/{evaluation_id}", { params: { path: { evaluation_id: id } } });
      if (data === undefined) throw new Error("Persisted evaluation unavailable.");
      return data;
    },
  };
}

/** Fetch the Results node through the Rete dataflow, retrying when a cache reset cancels it. */
async function fetchResults(graph: Graph): Promise<Outcome> {
  for (let attempt: number = 0; attempt < 4; attempt++) {
    try {
      const output: Record<string, unknown> = await graph.engine.fetch<LandingNode>(graph.science.result.id);
      return { evaluation: (output["evaluation"] ?? null) as ScientificEvaluation | null, error: null };
    } catch (caught: unknown) {
      if (caught instanceof Cancelled) continue;
      return { evaluation: null, error: caught instanceof Error ? caught.message : String(caught) };
    }
  }
  return { evaluation: null, error: "The dataflow was reset repeatedly; retry." };
}

function statusOf(evaluation: ScientificEvaluation): LandingNode["contract"]["execution_status"] {
  if (evaluation.status === "COMPUTED_UNVERIFIED" || evaluation.status === "VALIDATED") return "succeeded";
  return evaluation.status === "UNAVAILABLE" ? "unavailable" : "failed";
}

export function LandingGraph({ apiClient, candidate }: { apiClient: ApiClient; candidate: Candidate }): JSX.Element {
  const host: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<CandidatePreview | null>(null);
  const [child, setChild] = useState<Candidate | null>(null);
  const childRef: RefObject<Candidate | null> = useRef<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [contracts, setContracts] = useState<LandingNode[]>([]);
  const [c0Result, setC0Result] = useState<ScientificEvaluation | null>(null);
  const [c1Result, setC1Result] = useState<ScientificEvaluation | null>(null);
  const [c0History, setC0History] = useState<ScientificEvaluation[]>([]);
  const [c1History, setC1History] = useState<ScientificEvaluation[]>([]);
  const [evaluationBusy, setEvaluationBusy] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(24);
  const [step, setStep] = useState<number>(60);
  const [outputRef, setOutputRef] = useState<CandidateRef | null>(null);
  const [dataflow, setDataflow] = useState<string>("Building graph…");
  const graphRef: RefObject<Graph | null> = useRef<Graph | null>(null);
  const refs: RefObject<Map<string, CandidateRef>> = useRef(new Map<string, CandidateRef>());
  const evalGeneration: RefObject<SelectionGuard> = useRef(new SelectionGuard());
  const outputGuard: RefObject<SelectionGuard> = useRef(new SelectionGuard());
  const generation: RefObject<number> = useRef<number>(0);
  const api: RefObject<ScienceApi> = useRef(scienceApi(apiClient));

  useEffect((): void => { childRef.current = child; }, [child]);

  function labelFor(id: string): string { return id === candidate.candidate_id ? "C0" : "C1"; }

  function remember(evaluation: ScientificEvaluation): void {
    const add: (history: ScientificEvaluation[]) => ScientificEvaluation[] = (history: ScientificEvaluation[]): ScientificEvaluation[] =>
      [...history.filter((item: ScientificEvaluation): boolean => item.evaluation_id !== evaluation.evaluation_id), evaluation];
    if (evaluation.candidate_id === candidate.candidate_id) { setC0Result(evaluation); setC0History(add); }
    else if (evaluation.candidate_id === childRef.current?.candidate_id) { setC1Result(evaluation); setC1History(add); }
  }

  async function showOutcome(graph: Graph, outcome: Outcome): Promise<void> {
    const { compute, result, computeStatus, display } = graph.science;
    if (outcome.error !== null) {
      compute.contract.execution_status = "failed"; compute.contract.errors = [outcome.error];
      result.contract.execution_status = "failed"; result.contract.errors = [outcome.error];
      computeStatus.setValue(`FAILED: ${outcome.error}`); display.setValue("No result");
    } else if (outcome.evaluation === null) {
      compute.contract.execution_status = "pending"; compute.contract.errors = [];
      result.contract.execution_status = "pending";
      computeStatus.setValue("Waiting for Evaluate"); display.setValue("Not evaluated");
    } else {
      const evaluation: ScientificEvaluation = outcome.evaluation;
      for (const node of [compute, result]) {
        node.contract.execution_status = statusOf(evaluation);
        node.contract.validation_status = evaluation.status === "VALIDATED" ? "independently_validated" : "unverified";
        node.contract.errors = evaluation.errors; node.contract.warnings = evaluation.warnings;
      }
      compute.contract.data_sources = [JSON.stringify(evaluation.provenance)];
      computeStatus.setValue(`${evaluation.status} · ${labelFor(evaluation.candidate_id)} · ${evaluation.evaluation_id.slice(0, 19)}…`);
      const first: ScientificEvaluation["samples"][number] | undefined = evaluation.samples[0];
      display.setValue(first === undefined ? `${evaluation.status}: ${evaluation.errors[0] ?? "no samples"}` :
        `${evaluation.status}: Sun ${first.sun_elevation_deg.toFixed(2)}°, Earth ${first.earth_elevation_deg.toFixed(2)}°`);
      remember(evaluation);
    }
    await graph.area.update("node", compute.id);
    await graph.area.update("node", result.id);
    setContracts((nodes: LandingNode[]): LandingNode[] => [...nodes]);
  }

  async function referenceFor(target: Candidate): Promise<CandidateRef> {
    const cached: CandidateRef | undefined = refs.current.get(target.candidate_id);
    if (cached !== undefined) return cached;
    const ref: CandidateRef = await api.current.getCandidateRef(target.candidate_id);
    if (ref.candidate_id !== target.candidate_id) throw new Error("CandidateRef mismatch.");
    refs.current.set(target.candidate_id, ref);
    return ref;
  }

  /** Put a committed candidate on Candidate.candidate_ref and restore its stored result through the graph. */
  async function selectOutput(graph: Graph, target: Candidate): Promise<boolean> {
    const token: number = outputGuard.current.next();
    const ref: CandidateRef = await referenceFor(target);
    if (!outputGuard.current.isCurrent(token) || graphRef.current !== graph) return false;
    const node: LandingNode = graph.landing.candidate;
    if (!(typeof node.value === "object" && node.value !== null && (node.value as CandidateRef).candidate_id === ref.candidate_id)) {
      node.value = ref;
      graph.engine.reset(node.id);
    }
    graph.landing.committed.setValue(describeRef(ref, labelFor(ref.candidate_id)));
    await graph.area.update("node", node.id);
    setOutputRef(ref);
    setDataflow(`Candidate.candidate_ref → Scientific computation → Results carries ${labelFor(ref.candidate_id)}.`);
    return true;
  }

  useEffect((): (() => void) => {
    let active: boolean = true;
    const generationRef: RefObject<number> = generation;
    const sequence: number = ++generationRef.current;
    void apiClient.GET("/api/candidates/{candidate_id}/children", { params: { path: { candidate_id: candidate.candidate_id } } })
      .then(({ data }): void => { if (active && sequence === generationRef.current && data !== undefined) setChild(data.at(-1) ?? null); })
      .catch((): void => { if (active && sequence === generationRef.current) setError("Could not load saved candidate evolution."); });
    return (): void => { active = false; generationRef.current++; };
  }, [apiClient, candidate.candidate_id]);

  useEffect((): (() => void) => {
    const evalRef: SelectionGuard = evalGeneration.current;
    const token: number = evalRef.next();
    const ids: string[] = child === null ? [candidate.candidate_id] : [candidate.candidate_id, child.candidate_id];
    void Promise.all(ids.map(async (id: string): Promise<ScientificEvaluation[]> => {
      const { data } = await apiClient.GET("/api/candidates/{candidate_id}/evaluations", { params: { path: { candidate_id: id } } });
      return data ?? [];
    })).then((results): void => {
      if (evalRef.isCurrent(token)) {
        const first: ScientificEvaluation[] = results[0] ?? [];
        const second: ScientificEvaluation[] = results[1] ?? [];
        setC0History(first); setC1History(second);
        setC0Result(first.at(-1) ?? null); setC1Result(second.at(-1) ?? null);
      }
    }).catch((): void => { if (evalRef.isCurrent(token)) setError("Could not reload saved scientific evaluations."); });
    return (): void => { evalRef.invalidate(); };
  }, [apiClient, candidate.candidate_id, child]);

  useEffect((): (() => void) | undefined => {
    if (host.current === null) return undefined;
    const outputs: SelectionGuard = outputGuard.current;
    let disposed: boolean = false;
    let revision: number = 0;
    const wrapper: HTMLDivElement = document.createElement("div");
    wrapper.style.width = "100%"; wrapper.style.height = "100%";
    host.current.appendChild(wrapper);
    const editor: NodeEditor<LandingScheme> = new NodeEditor<LandingScheme>();
    const engine: DataflowEngine<LandingScheme> = new DataflowEngine<LandingScheme>();
    const area: AreaPlugin<LandingScheme, Extra> = new AreaPlugin<LandingScheme, Extra>(wrapper);
    const connection: ConnectionPlugin<LandingScheme, Extra> = new ConnectionPlugin<LandingScheme, Extra>();
    const render: ReactPlugin<LandingScheme, Extra> = new ReactPlugin<LandingScheme, Extra>({ createRoot });
    connection.addPreset(ConnectionPresets.classic.setup());
    render.addPreset(Presets.classic.setup());
    editor.use(engine); editor.use(area); area.use(connection); area.use(render);
    void (async (): Promise<void> => {
      let ready: boolean = false;
      let landing: LandingNodes | null = null;
      const refresh: () => void = (): void => {
        if (!ready || landing === null || disposed) return;
        const request: number = ++revision;
        const node: LandingNode = landing.candidate;
        setPreview(null);
        // Reset the editable parameter nodes (and thus Candidate and its successors); the
        // scientific nodes memoise their backend calls, so this never repeats a calculation.
        engine.reset(landing.height.id);
        engine.reset(landing.time.id);
        void engine.fetch<LandingNode>(node.id).then(async (pending): Promise<void> => {
          const value: Record<string, unknown> = await pending;
          if (disposed || request !== revision) return;
          const result: PreviewResult = value["preview"] as PreviewResult;
          node.contract.execution_status = result.status === "valid" ? "succeeded" : "failed";
          node.contract.errors = result.status === "valid" ? [] : [result.error];
          setContracts([...editor.getNodes()]);
          setPreview(result.status === "valid" ? result.value : null);
          setError(result.status === "valid" ? null : "Connect all inputs and enter a valid height and UTC time.");
        }).catch((): void => { /* Superseded by a newer reset. */ });
      };
      editor.addPipe((context) => {
        if (context.type === "connectioncreate") {
          const wire: LandingConnection = context.data;
          const source: LandingNode | undefined = editor.getNode(wire.source);
          const target: LandingNode | undefined = editor.getNode(wire.target);
          if (source === undefined || target === undefined || !(["Candidate", "Scientific computation", "Results"].includes(target.label)) ||
              source.outputs[wire.sourceOutput] === undefined || target.inputs[wire.targetInput] === undefined ||
              source.outputs[wire.sourceOutput]?.socket !== target.inputs[wire.targetInput]?.socket ||
              editor.getConnections().some((existing): boolean => existing.target === wire.target && existing.targetInput === wire.targetInput)) return undefined;
        }
        if (context.type === "connectioncreated" || context.type === "connectionremoved") {
          const target: string = context.data.target;
          queueMicrotask((): void => {
            // A removed wire leaves its target outside the reset cascade, so reset it directly.
            if (editor.getNode(target) !== undefined) engine.reset(target);
            refresh();
            const graph: Graph | null = graphRef.current;
            if (graph !== null && !disposed) void fetchResults(graph).then((outcome: Outcome): Promise<void> | undefined =>
              disposed ? undefined : showOutcome(graph, outcome));
          });
        }
        return context;
      });
      const built: LandingNodes = await buildLandingNodes(editor, candidate, refresh, (): boolean => !disposed);
      // The component may have unmounted while nodes were being added.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (disposed) return;
      landing = built;
      const science: ScientificNodes = await addScientificNodes(editor, built.candidate, candidate, api.current, (): boolean => !disposed);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (disposed) return;
      const graph: Graph = { engine, area, landing: built, science };
      graphRef.current = graph;
      setContracts([...built.nodes, ...science.nodes]);
      for (const [index, node] of built.nodes.entries()) {
        await area.translate(node.id, index === 4 ? { x: 620, y: 90 } : { x: Math.floor(index / 2) * 290, y: (index % 2) * 230 });
      }
      for (const [index, node] of science.nodes.entries()) {
        await area.translate(node.id, { x: 960 + index * 330, y: 90 });
      }
      ready = true;
      refresh();
      await AreaExtensions.zoomAt(area, editor.getNodes());
      if (!(await selectOutput(graph, candidate))) return;
      const outcome: Outcome = await fetchResults(graph);
      // The component may have unmounted during the fetch.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!disposed) await showOutcome(graph, outcome);
    })().catch((): void => { if (!disposed) setError("Unable to initialise the landing graph."); });
    return (): void => { disposed = true; revision++; graphRef.current = null; outputs.invalidate(); area.destroy(); wrapper.remove(); };
    // selectOutput/showOutcome read refs only; the graph is rebuilt per candidate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiClient, candidate]);

  async function commit(): Promise<void> {
    if (preview === null || saving || evaluationBusy) return;
    const request: number = ++generation.current;
    setSaving(true); setError(null);
    try {
      const { data } = await apiClient.POST("/api/candidates/{candidate_id}/evolve", {
        params: { path: { candidate_id: candidate.candidate_id } },
        body: { observer_height_m: preview.observer_height_m, selected_time_utc: preview.selected_time_utc },
      });
      if (request !== generation.current) return;
      if (data === undefined) throw new Error("Candidate could not be saved.");
      childRef.current = data;
      setChild(data);
      const graph: Graph | null = graphRef.current;
      if (graph !== null && await selectOutput(graph, data)) await showOutcome(graph, await fetchResults(graph));
    } catch { if (request === generation.current) setError("Candidate could not be saved."); }
    finally { if (request === generation.current) setSaving(false); }
  }

  async function chooseOutput(target: Candidate): Promise<void> {
    const graph: Graph | null = graphRef.current;
    if (graph === null || evaluationBusy) return;
    try {
      if (await selectOutput(graph, target)) await showOutcome(graph, await fetchResults(graph));
    } catch { setError("Could not load the CandidateRef for this candidate."); }
  }

  async function runScientific(target: Candidate): Promise<void> {
    const graph: Graph | null = graphRef.current;
    if (graph === null || evaluationBusy) return;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 168 || !Number.isInteger(step) || step < 1 || step > 360) {
      setError("Choose a duration up to 168 hours and a step between 1 and 360 minutes."); return;
    }
    const evalGuard: SelectionGuard = evalGeneration.current;
    const token: number = evalGuard.next();
    setEvaluationBusy(true); setError(null);
    graph.science.computeStatus.setValue(`Running for ${labelFor(target.candidate_id)}…`);
    void graph.area.update("node", graph.science.compute.id);
    try {
      if (!(await selectOutput(graph, target))) return;
      graph.science.compute.request(target.candidate_id, { duration_hours: duration, step_minutes: step });
      graph.engine.reset(graph.science.compute.id);
      const outcome: Outcome = await fetchResults(graph);
      // Ignore a response that no longer matches the selected reference or a newer request.
      const current: unknown = graph.landing.candidate.value;
      if (!evalGuard.isCurrent(token) || graphRef.current !== graph ||
          (current as CandidateRef | null)?.candidate_id !== target.candidate_id) return;
      if (outcome.evaluation !== null && outcome.evaluation.candidate_id !== target.candidate_id) return;
      await showOutcome(graph, outcome);
      if (outcome.error !== null) setError(`Scientific evaluation failed: ${outcome.error}`);
    } catch {
      if (evalGuard.isCurrent(token)) setError("Scientific evaluation failed or was superseded. Retry with a saved candidate.");
    } finally { if (evalGuard.isCurrent(token)) setEvaluationBusy(false); }
  }

  const outputLabel: string = outputRef === null ? "none" : labelFor(outputRef.candidate_id);
  return <section aria-label="Landing graph">
    <h3>Landing Graph</h3>
    <p>Edit height and UTC time in the nodes. The live preview assembles inputs only. Scientific results come only from a committed candidate whose <code>candidate_ref</code> flows through Scientific computation to Results; the computation runs in the Python backend when you press Evaluate.</p>
    <div ref={host} style={{ width: "100%", height: 540, background: "#202832", border: "1px solid #617184" }} aria-label="Rete landing graph canvas" />
    <p aria-live="polite">Dataflow: {dataflow}</p>
    <h4>Live Preview</h4>
    {preview === null ? <p>Preview unavailable.</p> : <p>Height: {preview.observer_height_m} m · Time: {preview.selected_time_utc} · Elevation: {preview.terrain_elevation_m.toFixed(2)} m. Unsaved edits are not on <code>candidate_ref</code> until you create C1.</p>}
    {error !== null && <p role="alert">{error}</p>}
    <button type="button" disabled={preview === null || saving || evaluationBusy} onClick={(): void => { void commit(); }}>Create Candidate C1</button>
    {child !== null && <section aria-label="Candidate comparison">
      <h4>Candidate C0 → C1</h4><p>C0: {candidate.candidate_id}</p><p>C1: {child.candidate_id}</p>
      <p>Observer height: {candidate.observer_height_m} m → {child.observer_height_m} m</p>
      <p>UTC time: {candidate.selected_time_utc} → {child.selected_time_utc}</p>
      <p>Terrain and coordinates retained from C0. Validation: not independently validated.</p>
    </section>}
    <section aria-label="CandidateRef output">
      <h4>candidate_ref output: {outputLabel}</h4>
      {outputRef !== null && <p>CandidateRef {outputRef.schema_version}: {outputRef.candidate_id} · site {outputRef.site_id} · window {outputRef.terrain_window_id} · snapshot {outputRef.snapshot_sha256.slice(0, 16)}…</p>}
      <button type="button" aria-pressed={outputRef?.candidate_id === candidate.candidate_id} disabled={evaluationBusy}
        onClick={(): void => { void chooseOutput(candidate); }}>Output C0</button>{" "}
      <button type="button" aria-pressed={child !== null && outputRef?.candidate_id === child.candidate_id} disabled={evaluationBusy || child === null}
        onClick={(): void => { if (child !== null) void chooseOutput(child); }}>Output C1</button>
    </section>
    <section aria-label="Scientific evaluation controls">
      <h4>Evaluate saved candidates</h4>
      <label>Duration (hours, max 168) <input type="number" min="0.01" max="168" disabled={evaluationBusy} value={duration} onChange={(event): void => { setDuration(Number(event.target.value)); }} /></label>{" "}
      <label>Sampling step (minutes) <input type="number" min="1" max="360" disabled={evaluationBusy} value={step} onChange={(event): void => { setStep(Number(event.target.value)); }} /></label>{" "}
      <button type="button" disabled={evaluationBusy} onClick={(): void => { void runScientific(candidate); }}>Evaluate C0</button>{" "}
      <button type="button" disabled={evaluationBusy || child === null} onClick={(): void => { if (child !== null) void runScientific(child); }}>Evaluate C1</button>
      {evaluationBusy && <p>Computing terrain horizon and SPICE positions…</p>}
      {c0History.length > 1 && <label>C0 evaluation history <select value={c0Result?.evaluation_id ?? ""} onChange={(event): void => { setC0Result(c0History.find((item): boolean => item.evaluation_id === event.target.value) ?? null); }}>
        {c0History.map((item): JSX.Element => <option key={item.evaluation_id} value={item.evaluation_id}>{item.status} · {item.request.duration_hours} h · {item.request.step_minutes} min · {item.evaluation_id.slice(-8)}</option>)}
      </select></label>}
      {c1History.length > 1 && <label>C1 evaluation history <select value={c1Result?.evaluation_id ?? ""} onChange={(event): void => { setC1Result(c1History.find((item): boolean => item.evaluation_id === event.target.value) ?? null); }}>
        {c1History.map((item): JSX.Element => <option key={item.evaluation_id} value={item.evaluation_id}>{item.status} · {item.request.duration_hours} h · {item.request.step_minutes} min · {item.evaluation_id.slice(-8)}</option>)}
      </select></label>}
      <ScientificResults c0={c0Result} c1={c1Result} />
    </section>
    <details><summary>Scientific node contracts</summary>{contracts.map((node): JSX.Element => <div key={node.id}>
      <h5>{node.label}</h5><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(node.contract, null, 2)}</pre>
    </div>)}</details>
  </section>;
}
