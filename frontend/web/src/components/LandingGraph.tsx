import type { ApiClient, Candidate, ScientificEvaluation } from "@clps/api-client";
import { useEffect, useRef, useState, type JSX, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { NodeEditor } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { DataflowEngine } from "rete-engine";
import { ReactPlugin, Presets, type ReactArea2D } from "rete-react-plugin";
import { addScientificNodes, buildLandingNodes, type LandingConnection, type LandingNode, type LandingNodes, type LandingScheme, type ScientificNodes } from "./landingGraph.ts";

import { SelectionGuard } from "../lib/selectionGuard.ts";
import { ScientificResults } from "./ScientificResults.tsx";

interface Preview { latitude_deg: number; longitude_deg: number; terrain_elevation_m: number; observer_height_m: number; selected_time_utc: string }
type Extra = ReactArea2D<LandingScheme>;

export function LandingGraph({ apiClient, candidate }: { apiClient: ApiClient; candidate: Candidate }): JSX.Element {
  const host: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [child, setChild] = useState<Candidate | null>(null);
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
  const config: RefObject<{ duration_hours: number; step_minutes: number }> = useRef({ duration_hours: 24, step_minutes: 60 });
  const scientific: RefObject<{ engine: DataflowEngine<LandingScheme>; nodes: ScientificNodes; area: AreaPlugin<LandingScheme, Extra> } | null> = useRef(null);
  const evalGeneration: RefObject<SelectionGuard> = useRef(new SelectionGuard());
  const generation: RefObject<number> = useRef<number>(0);

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
      let result: LandingNode | null = null;
      const refresh: () => void = (): void => {
        if (!ready || result === null || disposed) return;
        const request: number = ++revision;
        setPreview(null);
        engine.reset();
        void engine.fetch<LandingNode>(result.id).then(async (pending): Promise<void> => {
          const value: Record<string, unknown> = await pending;
          if (!disposed && request === revision && result !== null) {
            result.contract.execution_status = "succeeded"; result.contract.errors = [];
            setContracts([...editor.getNodes()]); setPreview(value["value"] as Preview); setError(null); }
        }).catch((): void => { if (!disposed && request === revision && result !== null) {
            result.contract.execution_status = "failed"; result.contract.errors = ["Missing or invalid inputs."];
            setContracts([...editor.getNodes()]); setPreview(null); setError("Connect all inputs and enter a valid height and UTC time."); } });
      };
      editor.addPipe((context) => {
        if (context.type === "connectioncreate") {
          const wire: LandingConnection = context.data;
          const source: LandingNode | undefined = editor.getNode(wire.source);
          const target: LandingNode | undefined = editor.getNode(wire.target);
          if (source === undefined || target === undefined || !(["Candidate", "Scientific computation", "Scientific result"].includes(target.label)) ||
              source.outputs[wire.sourceOutput] === undefined || target.inputs[wire.targetInput] === undefined ||
              source.outputs[wire.sourceOutput]?.socket !== target.inputs[wire.targetInput]?.socket ||
              editor.getConnections().some((existing): boolean => existing.target === wire.target && existing.targetInput === wire.targetInput)) return undefined;
        }
        if (context.type === "connectioncreated" || context.type === "connectionremoved") queueMicrotask(refresh);
        return context;
      });
      const graph: LandingNodes = await buildLandingNodes(editor, candidate, refresh, (): boolean => !disposed);
      // The component may have unmounted while nodes were being added.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (disposed) return;
      result = graph.result;
      const science: ScientificNodes = await addScientificNodes(editor, candidate, async (id: string): Promise<ScientificEvaluation> => {
        const { data } = await apiClient.POST("/api/candidates/{candidate_id}/evaluations", {
          params: { path: { candidate_id: id } }, body: config.current,
        });
        if (data === undefined) throw new Error("Scientific evaluation request failed.");
        return data;
      }, (): boolean => !disposed);
      // The effect can be disposed while nodes are being connected.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (disposed) return;
      scientific.current = { engine, nodes: science, area };
      setContracts([...graph.nodes, ...science.nodes]);
      for (const [index, node] of graph.nodes.entries()) {
        await area.translate(node.id, index === 4 ? { x: 650, y: 100 } : { x: Math.floor(index / 2) * 300, y: (index % 2) * 220 });
      }
      for (const [index, node] of science.nodes.entries()) {
        await area.translate(node.id, { x: index * 330, y: 500 });
      }
      ready = true;
      refresh();
      await AreaExtensions.zoomAt(area, editor.getNodes());
    })().catch((): void => { if (!disposed) setError("Unable to initialise the landing graph."); });
    return (): void => { disposed = true; revision++; scientific.current = null; area.destroy(); wrapper.remove(); };
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
      setChild(data);
    } catch { if (request === generation.current) setError("Candidate could not be saved."); }
    finally { if (request === generation.current) setSaving(false); }
  }
  async function runScientific(target: Candidate, label: "C0" | "C1"): Promise<void> {
    const graph: { engine: DataflowEngine<LandingScheme>; nodes: ScientificNodes; area: AreaPlugin<LandingScheme, Extra> } | null = scientific.current;
    if (graph === null || evaluationBusy) return;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 168 || !Number.isInteger(step) || step < 1 || step > 360) {
      setError("Choose a duration up to 168 hours and a step between 1 and 360 minutes."); return;
    }
    const evalGuard: SelectionGuard = evalGeneration.current;
    const token: number = evalGuard.next();
    config.current = { duration_hours: duration, step_minutes: step };
    graph.nodes.saved.value = target.candidate_id;
    graph.engine.reset();
    setEvaluationBusy(true); setError(null);
    try {
      const output: Record<string, unknown> = await graph.engine.fetch<LandingNode>(graph.nodes.result.id);
      const evaluation: ScientificEvaluation = output["value"] as ScientificEvaluation;
      if (!evalGuard.isCurrent(token)) return;
      if (label === "C0") {
        setC0Result(evaluation);
        setC0History((history: ScientificEvaluation[]): ScientificEvaluation[] => [...history.filter((item): boolean => item.evaluation_id !== evaluation.evaluation_id), evaluation]);
      } else {
        setC1Result(evaluation);
        setC1History((history: ScientificEvaluation[]): ScientificEvaluation[] => [...history.filter((item): boolean => item.evaluation_id !== evaluation.evaluation_id), evaluation]);
      }
      graph.nodes.compute.contract.execution_status = evaluation.status === "COMPUTED_UNVERIFIED" || evaluation.status === "VALIDATED" ? "succeeded" : evaluation.status === "UNAVAILABLE" ? "unavailable" : "failed";
      graph.nodes.compute.contract.validation_status = evaluation.status === "VALIDATED" ? "independently_validated" : "unverified";
      graph.nodes.compute.contract.errors = evaluation.errors;
      graph.nodes.compute.contract.warnings = evaluation.warnings;
      graph.nodes.compute.contract.data_sources = [JSON.stringify(evaluation.provenance)];
      graph.nodes.result.contract.execution_status = graph.nodes.compute.contract.execution_status;
      graph.nodes.result.contract.validation_status = graph.nodes.compute.contract.validation_status;
      graph.nodes.result.contract.errors = evaluation.errors;
      graph.nodes.result.contract.warnings = evaluation.warnings;
      const first: ScientificEvaluation["samples"][number] | undefined = evaluation.samples[0];
      graph.nodes.display.setValue(first === undefined ? evaluation.status : `${evaluation.status}: Sun ${first.sun_elevation_deg.toFixed(2)}°, Earth ${first.earth_elevation_deg.toFixed(2)}°`);
      await graph.area.update("node", graph.nodes.result.id);
      setContracts((nodes: LandingNode[]): LandingNode[] => [...nodes]);
    } catch {
      if (evalGuard.isCurrent(token)) {
        graph.nodes.compute.contract.execution_status = "failed";
        graph.nodes.compute.contract.errors = ["Scientific request failed or was superseded."];
        graph.nodes.display.setValue("ERROR: evaluation request failed");
        void graph.area.update("node", graph.nodes.result.id);
        setContracts((nodes: LandingNode[]): LandingNode[] => [...nodes]);
        setError("Scientific evaluation failed or was superseded. Retry with a saved candidate.");
      }
    } finally { if (evalGuard.isCurrent(token)) setEvaluationBusy(false); }
  }
  return <section aria-label="Landing graph">
    <h3>Landing Graph</h3>
    <p>Edit height and UTC time in the nodes. Preview assembles inputs only; no new illumination or visibility calculation is performed.</p>
    <div ref={host} style={{ width: "100%", height: 540, background: "#202832", border: "1px solid #617184" }} aria-label="Rete landing graph canvas" />
    <h4>Live Preview</h4>
    {preview === null ? <p>Preview unavailable.</p> : <p>Height: {preview.observer_height_m} m · Time: {preview.selected_time_utc} · Elevation: {preview.terrain_elevation_m.toFixed(2)} m</p>}
    {error !== null && <p role="alert">{error}</p>}
    <button type="button" disabled={preview === null || saving || evaluationBusy} onClick={(): void => { void commit(); }}>Create Candidate C1</button>
    {child !== null && <section aria-label="Candidate comparison">
      <h4>Candidate C0 → C1</h4><p>C0: {candidate.candidate_id}</p><p>C1: {child.candidate_id}</p>
      <p>Observer height: {candidate.observer_height_m} m → {child.observer_height_m} m</p>
      <p>UTC time: {candidate.selected_time_utc} → {child.selected_time_utc}</p>
      <p>Terrain and coordinates retained from C0. Validation: not independently validated.</p>
    </section>}
    <section aria-label="Scientific evaluation controls">
      <h4>Evaluate saved candidates</h4>
      <label>Duration (hours, max 168) <input type="number" min="0.01" max="168" disabled={evaluationBusy} value={duration} onChange={(event): void => { setDuration(Number(event.target.value)); }} /></label>{" "}
      <label>Sampling step (minutes) <input type="number" min="1" max="360" disabled={evaluationBusy} value={step} onChange={(event): void => { setStep(Number(event.target.value)); }} /></label>{" "}
      <button type="button" disabled={evaluationBusy} onClick={(): void => { void runScientific(candidate, "C0"); }}>Evaluate C0</button>{" "}
      <button type="button" disabled={evaluationBusy || child === null} onClick={(): void => { if (child !== null) void runScientific(child, "C1"); }}>Evaluate C1</button>
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
