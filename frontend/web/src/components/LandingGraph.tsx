import type { ApiClient, Candidate, CandidateRef, ScientificEvaluation } from "@clps/api-client";
import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { ClassicPreset, NodeEditor } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { Cancelled, DataflowEngine } from "rete-engine";
import { ReactPlugin, Presets, type ReactArea2D } from "rete-react-plugin";
import {
  addScientificNodes,
  buildLandingNodes,
  InfoControl,
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
import { nearestSample, useExploration, useExplorationStore, type Draft, type ExperimentSettings, type ExplorationStore } from "../lib/explorationStore.ts";
import { loadSelection } from "../lib/workspaceSelection.ts";
import { formatUtc } from "../lib/format.ts";
import type { Mode } from "../lib/mode.ts";
import { WorkspaceInspector, revisionLabel } from "./WorkspaceInspector.tsx";

type Extra = ReactArea2D<LandingScheme>;
interface Graph { engine: DataflowEngine<LandingScheme>; area: AreaPlugin<LandingScheme, Extra>; landing: LandingNodes; science: ScientificNodes; refresh: () => void }
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

type NodeKind = "parameter" | "candidate" | "compute" | "result";
function kindOf(label: string): NodeKind {
  if (label === "Candidate") return "candidate";
  if (label === "Scientific computation") return "compute";
  return label === "Results" ? "result" : "parameter";
}
type NodeProps = Parameters<typeof Presets.classic.Node<LandingScheme>>[0];
/** Colour each node by its role (CSS on a wrapper); the classic node is otherwise unchanged. */
function kindNode(kind: NodeKind): (props: NodeProps) => JSX.Element {
  return (props: NodeProps): JSX.Element => <div className={`node-kind node-kind-${kind}`}><Presets.classic.Node {...props} /></div>;
}
/** Wrapping read-only text for InfoControl (saved values, statuses, interval, cursor). */
function ControlView({ data }: { data: ClassicPreset.Control }): JSX.Element | null {
  if (data instanceof InfoControl) return <div className={`node-info tone-${data.tone}`} title={data.text}>{data.text}</div>;
  if (data instanceof ClassicPreset.InputControl) return <Presets.classic.Control data={data as ClassicPreset.InputControl<"text">} />;
  return null;
}

const KIND_NODES: Record<NodeKind, (props: NodeProps) => JSX.Element> = {
  parameter: kindNode("parameter"), candidate: kindNode("candidate"), compute: kindNode("compute"), result: kindNode("result"),
};

interface LandingGraphProps {
  apiClient: ApiClient;
  /** Root candidate (C0) of this graph. */
  candidate: Candidate;
  /** Committed revision (C0 or a C1) chosen in the app-level selection. */
  selectedRevisionId: string;
  onSelectRevision: (revision: Candidate) => void;
  mode: Mode;
}

export function LandingGraph({ apiClient, candidate, selectedRevisionId, onSelectRevision, mode }: LandingGraphProps): JSX.Element {
  const host: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<CandidatePreview | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);
  const store: ExplorationStore = useExplorationStore();
  const draft: Draft | null = useExploration((state): Draft | null => state.draft);
  const settings: ExperimentSettings = useExploration((state): ExperimentSettings => state.settings);
  const storeEvaluation: ScientificEvaluation | null = useExploration((state): ScientificEvaluation | null => state.evaluation);
  const cursorUtc: string | null = useExploration((state): string | null => state.cursorUtc);
  const [children, setChildren] = useState<Candidate[]>([]);
  const [childrenLoaded, setChildrenLoaded] = useState<boolean>(false);
  const childRef: RefObject<Candidate | null> = useRef<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [contracts, setContracts] = useState<LandingNode[]>([]);
  const [c0Result, setC0Result] = useState<ScientificEvaluation | null>(null);
  const [c1Result, setC1Result] = useState<ScientificEvaluation | null>(null);
  const [c0History, setC0History] = useState<ScientificEvaluation[]>([]);
  const [c1History, setC1History] = useState<ScientificEvaluation[]>([]);
  const [evaluationBusy, setEvaluationBusy] = useState<boolean>(false);
  const [outputRef, setOutputRef] = useState<CandidateRef | null>(null);
  const [graphReady, setGraphReady] = useState<boolean>(false);
  const [focus, setFocus] = useState<{ part: "candidate" | "result"; at: number } | null>(null);
  const graphRef: RefObject<Graph | null> = useRef<Graph | null>(null);
  const refs: RefObject<Map<string, CandidateRef>> = useRef(new Map<string, CandidateRef>());
  const evalGeneration: RefObject<SelectionGuard> = useRef(new SelectionGuard());
  const outputGuard: RefObject<SelectionGuard> = useRef(new SelectionGuard());
  const generation: RefObject<number> = useRef<number>(0);
  const api: RefObject<ScienceApi> = useRef(scienceApi(apiClient));

  // The C1 shown is the selected revision when it is a child, otherwise the latest child.
  const child: Candidate | null = children.find((c: Candidate): boolean => c.candidate_id === selectedRevisionId) ?? children.at(-1) ?? null;
  const selected: Candidate | null = selectedRevisionId === candidate.candidate_id ? candidate
    : child !== null && child.candidate_id === selectedRevisionId ? child : null;
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

  /** Put a committed candidate on Candidate.candidate_ref; returns false if superseded. */
  async function selectOutput(graph: Graph, target: Candidate): Promise<boolean> {
    const node: LandingNode = graph.landing.candidate;
    if ((node.value as CandidateRef | null)?.candidate_id === target.candidate_id) return true;
    const token: number = outputGuard.current.next();
    const ref: CandidateRef = await referenceFor(target);
    if (!outputGuard.current.isCurrent(token) || graphRef.current !== graph) return false;
    node.value = ref;
    graph.engine.reset(node.id);
    graph.landing.committed.setValue(describeRef(ref, labelFor(ref.candidate_id)));
    await graph.area.update("node", node.id);
    setOutputRef(ref);
    return true;
  }

  /** Write parameter values into the Height and Time nodes; the graph stays the only draft store. */
  const applyDraft: (graph: Graph, next: Draft) => void = useCallback((graph: Graph, next: Draft): void => {
    const { height, time } = graph.landing;
    height.value = next.observer_height_m;
    time.value = next.selected_time_utc;
    const heightControl: ClassicPreset.InputControl<"number"> | undefined = height.controls["value"] as ClassicPreset.InputControl<"number"> | undefined;
    const timeControl: ClassicPreset.InputControl<"text"> | undefined = time.controls["value"] as ClassicPreset.InputControl<"text"> | undefined;
    heightControl?.setValue(next.observer_height_m);
    timeControl?.setValue(next.selected_time_utc);
    if (heightControl !== undefined) void graph.area.update("control", heightControl.id);
    if (timeControl !== undefined) void graph.area.update("control", timeControl.id);
    graph.refresh();
  }, []);

  useEffect((): (() => void) => {
    let active: boolean = true;
    const generationRef: RefObject<number> = generation;
    const sequence: number = ++generationRef.current;
    void apiClient.GET("/api/candidates/{candidate_id}/children", { params: { path: { candidate_id: candidate.candidate_id } } })
      .then(({ data }): void => { if (active && sequence === generationRef.current && data !== undefined) { setChildren(data); setChildrenLoaded(true); } })
      .catch((): void => { if (active && sequence === generationRef.current) setError("Could not load saved candidate evolution."); });
    return (): void => { active = false; generationRef.current++; };
  }, [apiClient, candidate.candidate_id]);

  const childId: string | null = child?.candidate_id ?? null;
  useEffect((): (() => void) => {
    const evalRef: SelectionGuard = evalGeneration.current;
    const token: number = evalRef.next();
    const ids: string[] = childId === null ? [candidate.candidate_id] : [candidate.candidate_id, childId];
    void Promise.all(ids.map(async (id: string): Promise<ScientificEvaluation[]> => {
      const { data } = await apiClient.GET("/api/candidates/{candidate_id}/evaluations", { params: { path: { candidate_id: id } } });
      return data ?? [];
    })).then((results): void => {
      if (evalRef.isCurrent(token)) {
        const first: ScientificEvaluation[] = results[0] ?? [];
        const second: ScientificEvaluation[] = results[1] ?? [];
        setC0History(first); setC1History(second);
        // Keep a result already chosen for the same candidate (history pick or graph restore).
        setC0Result((previous: ScientificEvaluation | null): ScientificEvaluation | null => previous?.candidate_id === candidate.candidate_id ? previous : first.at(-1) ?? null);
        setC1Result((previous: ScientificEvaluation | null): ScientificEvaluation | null => previous !== null && previous.candidate_id === childId ? previous : second.at(-1) ?? null);
      }
    }).catch((): void => { if (evalRef.isCurrent(token)) setError("Could not reload saved scientific evaluations."); });
    return (): void => { evalRef.invalidate(); };
  }, [apiClient, candidate.candidate_id, childId]);

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
    render.addPreset(Presets.classic.setup({ customize: {
      node: (context) => KIND_NODES[kindOf(context.payload.label)],
      control: (): typeof ControlView => ControlView,
    } }));
    editor.use(engine); editor.use(area); area.use(connection); area.use(render);
    // Picking a node in the graph points the Inspector at the matching information.
    area.addPipe((context) => {
      if (context.type === "nodepicked") {
        const picked: LandingNode | undefined = editor.getNode(context.data.id);
        const kind: NodeKind | null = picked === undefined ? null : kindOf(picked.label);
        if (kind === "candidate") setFocus({ part: "candidate", at: Date.now() });
        else if (kind === "compute" || kind === "result") setFocus({ part: "result", at: Date.now() });
      }
      return context;
    });
    void (async (): Promise<void> => {
      let ready: boolean = false;
      let landing: LandingNodes | null = null;
      const refresh: (attempt?: number) => void = (attempt: number = 0): void => {
        if (!ready || landing === null || disposed) return;
        const request: number = ++revision;
        const node: LandingNode = landing.candidate;
        const { height, time } = landing;
        store.dispatch({ type: "draft", draft: { observer_height_m: Number(height.value), selected_time_utc: String(time.value) } });
        setPreview(null);
        // Reset the editable parameter nodes (and thus Candidate and its successors); the
        // scientific nodes memoise their backend calls, so this never repeats a calculation.
        engine.reset(height.id);
        engine.reset(time.id);
        void engine.fetch<LandingNode>(node.id).then(async (pending): Promise<void> => {
          const value: Record<string, unknown> = await pending;
          if (disposed || request !== revision) return;
          const result: PreviewResult = value["preview"] as PreviewResult;
          node.contract.execution_status = result.status === "valid" ? "succeeded" : "failed";
          node.contract.errors = result.status === "valid" ? [] : [result.error];
          setContracts([...editor.getNodes()]);
          setPreview(result.status === "valid" ? result.value : null);
          setError(result.status === "valid" ? null : "Enter an observer height of 0–100 m and a UTC time like 2026-11-07T00:00:00Z.");
        }).catch((caught: unknown): void => {
          // A reset elsewhere (e.g. moving candidate_ref) cancelled this fetch: run the latest preview again.
          if (caught instanceof Cancelled && !disposed && request === revision && attempt < 3) refresh(attempt + 1);
        });
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
      // Restore the evaluation inspected before reload (read-only; falls back to the latest).
      const saved: ReturnType<typeof loadSelection> = loadSelection();
      if (saved?.rootId === candidate.candidate_id && typeof saved.evaluationId === "string") science.compute.prefer(saved.revisionId, saved.evaluationId);
      graphRef.current = { engine, area, landing: built, science, refresh };
      setContracts([...built.nodes, ...science.nodes]);
      for (const [index, node] of built.nodes.entries()) {
        await area.translate(node.id, index === 4 ? { x: 600, y: 80 } : { x: Math.floor(index / 2) * 270, y: (index % 2) * 220 });
      }
      for (const [index, node] of science.nodes.entries()) {
        await area.translate(node.id, { x: 930 + index * 320, y: 80 });
      }
      ready = true;
      refresh();
      await AreaExtensions.zoomAt(area, editor.getNodes());
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!disposed) setGraphReady(true);
    })().catch((): void => { if (!disposed) setError("Unable to initialise the landing graph."); });
    return (): void => { disposed = true; revision++; graphRef.current = null; outputs.invalidate(); setGraphReady(false); area.destroy(); wrapper.remove(); };
    // showOutcome reads refs only; the graph is rebuilt per root candidate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiClient, candidate]);

  // The app-level selection drives candidate_ref, the parameter nodes and the restored result.
  const selectedId: string | null = selected?.candidate_id ?? null;
  useEffect((): (() => void) | undefined => {
    const graph: Graph | null = graphRef.current;
    if (!graphReady || graph === null) return undefined;
    if (selected === null) {
      // An unknown or stale revision id falls back to C0 once the children have loaded.
      if (childrenLoaded && !children.some((c: Candidate): boolean => c.candidate_id === selectedRevisionId)) onSelectRevision(candidate);
      return undefined;
    }
    let active: boolean = true;
    applyDraft(graph, { observer_height_m: selected.observer_height_m, selected_time_utc: selected.selected_time_utc });
    void selectOutput(graph, selected).then(async (current: boolean): Promise<void> => {
      if (!current || !active) return;
      const outcome: Outcome = await fetchResults(graph);
      // The selection may have changed during the fetch.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (active) await showOutcome(graph, outcome);
    }).catch((): void => { if (active) setError("Could not load the CandidateRef for this candidate."); });
    return (): void => { active = false; };
    // selectOutput/showOutcome read refs; rerun only when the selection or graph changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphReady, selectedId, children, childrenLoaded]);

  const active: ScientificEvaluation | null = selected === null ? null : selected.candidate_id === candidate.candidate_id ? c0Result : c1Result;
  // Publish the selected revision's displayed (persisted) evaluation as the shared active one.
  useEffect((): void => {
    if (selected !== null && (active === null || active.candidate_id === selected.candidate_id)) store.dispatch({ type: "evaluation", evaluation: active });
  }, [store, selected, active]);

  // Graph shows the committed revision's saved values beside the editable draft.
  useEffect((): void => {
    const graph: Graph | null = graphRef.current;
    if (!graphReady || graph === null || selected === null) return;
    const label: string = revisionLabel(candidate, selected);
    graph.landing.persistedHeight.setValue(`draft above · saved ${label}: ${selected.observer_height_m.toString()} m`);
    graph.landing.persistedTime.setValue(`draft above · saved ${label}: ${selected.selected_time_utc}`);
    void graph.area.update("control", graph.landing.persistedHeight.id);
    void graph.area.update("control", graph.landing.persistedTime.id);
  }, [graphReady, selected, candidate]);

  useEffect((): void => {
    const graph: Graph | null = graphRef.current;
    if (!graphReady || graph === null) return;
    graph.science.nextRun.setValue(`next run: ${settings.duration_hours.toString()} h @ ${settings.step_minutes.toString()} min`);
    void graph.area.update("control", graph.science.nextRun.id);
  }, [graphReady, settings]);

  // The Results node names the stored interval and the inspected sample (display only).
  useEffect((): void => {
    const graph: Graph | null = graphRef.current;
    if (!graphReady || graph === null) return;
    const shown: ScientificEvaluation | null = storeEvaluation;
    const index: number = nearestSample(shown, cursorUtc);
    const sample: ScientificEvaluation["samples"][number] | undefined = index < 0 ? undefined : shown?.samples[index];
    graph.science.interval.setValue(shown === null ? "interval: —" :
      `interval: ${shown.candidate.selected_time_utc.slice(0, 16)}Z + ${shown.request.duration_hours.toString()} h @ ${shown.request.step_minutes.toString()} min`);
    graph.science.cursor.setValue(sample === undefined || shown === null ? "cursor: no stored samples" :
      `cursor ${(index + 1).toString()}/${shown.samples.length.toString()}: ${formatUtc(sample.time_utc)} · Sun ${sample.sun_visible ? "visible" : "hidden"} · Earth ${sample.earth_visible ? "in view" : "not in view"}`);
    void graph.area.update("control", graph.science.interval.id);
    void graph.area.update("control", graph.science.cursor.id);
  }, [graphReady, storeEvaluation, cursorUtc]);

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
      setChildren((current: Candidate[]): Candidate[] => [...current.filter((c: Candidate): boolean => c.candidate_id !== data.candidate_id), data]);
      onSelectRevision(data);
    } catch { if (request === generation.current) setError("Candidate could not be saved."); }
    finally { if (request === generation.current) setSaving(false); }
  }

  async function runScientific(): Promise<void> {
    const graph: Graph | null = graphRef.current;
    const target: Candidate | null = selected;
    if (graph === null || target === null || evaluationBusy) return;
    const { duration_hours: duration, step_minutes: step } = settings;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 168 || !Number.isInteger(step) || step < 1 || step > 360) {
      setError("Choose a duration up to 168 hours and a step between 1 and 360 minutes."); return;
    }
    const evalGuard: SelectionGuard = evalGeneration.current;
    const token: number = evalGuard.next();
    setEvaluationBusy(true); setError(null);
    store.dispatch({ type: "activity", activity: { kind: "running", candidateId: target.candidate_id } });
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
      store.dispatch({ type: "activity", activity: outcome.error === null ? { kind: "idle" } : { kind: "error", message: outcome.error } });
    } catch {
      if (evalGuard.isCurrent(token)) {
        setError("Scientific evaluation failed or was superseded. Retry with a saved candidate.");
        store.dispatch({ type: "activity", activity: { kind: "error", message: "Evaluation failed or was superseded." } });
      }
    } finally { if (evalGuard.isCurrent(token)) setEvaluationBusy(false); }
  }

  /** Inspect another stored evaluation (read-only). The selected revision's choice flows through the graph. */
  async function chooseEvaluation(candidateId: string, evaluationId: string): Promise<void> {
    const graph: Graph | null = graphRef.current;
    const history: ScientificEvaluation[] = candidateId === candidate.candidate_id ? c0History : c1History;
    const chosen: ScientificEvaluation | undefined = history.find((item: ScientificEvaluation): boolean => item.evaluation_id === evaluationId);
    if (graph === null || chosen === undefined) return;
    graph.science.compute.prefer(candidateId, evaluationId);
    if (candidateId !== selected?.candidate_id) { remember(chosen); return; }
    graph.engine.reset(graph.science.compute.id);
    await showOutcome(graph, await fetchResults(graph));
  }

  const label: string = selected === null ? "—" : revisionLabel(candidate, selected);
  return <>
    <section className={`ws-graph card${expanded ? " graph-expanded" : ""}`} aria-label="Landing graph">
      <div className="graph-head">
        <span className="panel-eyebrow">02 / PARAMETRIC DESIGN</span><h2>Landing Graph</h2>
        <p className="muted">Each wire carries real data through the Rete.js dataflow engine. Parameter nodes feed the <strong>Candidate</strong> preview; its <code>candidate_ref</code> output carries the committed {label} to <strong>Scientific computation</strong> (the Python backend) and on to <strong>Results</strong>.</p>
      </div>
      <div className="graph-toolbar" role="toolbar" aria-label="Graph actions">
        <button type="button" aria-pressed={expanded} onClick={(): void => { setExpanded(!expanded); }}>{expanded ? "Compact graph" : "Expand graph"}</button>
        <button type="button" disabled={preview === null || saving || evaluationBusy} onClick={(): void => { void commit(); }}>Create Candidate C1</button>
        <span className="toolbar-sep" aria-hidden="true" />
        <label>Duration (h, max 168) <input type="number" min="0.01" max="168" disabled={evaluationBusy} value={settings.duration_hours} onChange={(event): void => { store.dispatch({ type: "settings", settings: { ...settings, duration_hours: Number(event.target.value) } }); }} /></label>
        <label>Step (min) <input type="number" min="1" max="360" disabled={evaluationBusy} value={settings.step_minutes} onChange={(event): void => { store.dispatch({ type: "settings", settings: { ...settings, step_minutes: Number(event.target.value) } }); }} /></label>
        <button type="button" className="primary" disabled={evaluationBusy || selected === null || !graphReady} onClick={(): void => { void runScientific(); }}>Evaluate {label}</button>
        {evaluationBusy && <span role="status">Computing terrain horizon and SPICE positions…</span>}
        {saving && <span role="status">Saving C1…</span>}
      </div>
      <ul className="graph-legend" aria-label="Node legend">
        <li><span className="kind parameter" /> Parameters</li><li><span className="kind candidate" /> Candidate (preview + candidate_ref)</li>
        <li><span className="kind compute" /> Scientific computation (backend)</li><li><span className="kind result" /> Results (persisted)</li>
      </ul>
      <div ref={host} className="graph-canvas" aria-label="Rete landing graph canvas" />
      <p aria-live="polite" className="muted">Dataflow: {outputRef === null ? "building graph…" : `candidate_ref carries ${labelFor(outputRef.candidate_id)} (${outputRef.candidate_id.slice(0, 22)}…) → Scientific computation → Results.`}</p>
      {preview === null ? <p>Live preview unavailable.</p> : <p>Live preview (unsaved): height {preview.observer_height_m} m · time {preview.selected_time_utc} · elevation {preview.terrain_elevation_m.toFixed(2)} m.</p>}
      {error !== null && <p role="alert">{error}</p>}
      {child !== null && <p className="muted">C1 {child.candidate_id.slice(0, 22)}…: observer height {candidate.observer_height_m} → {child.observer_height_m} m; UTC {candidate.selected_time_utc} → {child.selected_time_utc}; terrain and coordinates retained from C0.</p>}
      {c0History.length > 1 && <label>C0 evaluation history <select value={c0Result?.evaluation_id ?? ""} onChange={(event): void => { void chooseEvaluation(candidate.candidate_id, event.target.value); }}>
        {c0History.map((item): JSX.Element => <option key={item.evaluation_id} value={item.evaluation_id}>{item.status} · {item.request.duration_hours} h · {item.request.step_minutes} min · {item.evaluation_id.slice(-8)}</option>)}
      </select></label>}{" "}
      {c1History.length > 1 && <label>C1 evaluation history <select value={c1Result?.evaluation_id ?? ""} onChange={(event): void => { if (child !== null) void chooseEvaluation(child.candidate_id, event.target.value); }}>
        {c1History.map((item): JSX.Element => <option key={item.evaluation_id} value={item.evaluation_id}>{item.status} · {item.request.duration_hours} h · {item.request.step_minutes} min · {item.evaluation_id.slice(-8)}</option>)}
      </select></label>}
      <details><summary>Scientific node contracts</summary>{contracts.map((node): JSX.Element => <div key={node.id}>
        <h5>{node.label}</h5><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(node.contract, null, 2)}</pre>
      </div>)}</details>
    </section>
    {selected === null ? <aside className="ws-inspector card" aria-label="Inspector"><h2>Inspector</h2><p className="muted">Loading the selected revision…</p></aside> :
      <WorkspaceInspector root={candidate} child={child} selected={selected} selectedRef={outputRef?.candidate_id === selected.candidate_id ? outputRef : null}
        apiClient={apiClient} focus={focus} evaluation={active} c0Result={c0Result} c1Result={child === null ? null : c1Result} draft={draft} mode={mode} busy={evaluationBusy || saving}
        onSelectRevision={onSelectRevision} onDraftChange={(next: Draft): void => { const graph: Graph | null = graphRef.current; if (graph !== null) applyDraft(graph, next); }} />}
  </>;
}
