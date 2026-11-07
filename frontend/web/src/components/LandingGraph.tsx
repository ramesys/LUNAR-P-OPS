import type { ApiClient, Candidate } from "@clps/api-client";
import { useEffect, useRef, useState, type JSX, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { NodeEditor } from "rete";
import { AreaExtensions, AreaPlugin } from "rete-area-plugin";
import { ConnectionPlugin, Presets as ConnectionPresets } from "rete-connection-plugin";
import { DataflowEngine } from "rete-engine";
import { ReactPlugin, Presets, type ReactArea2D } from "rete-react-plugin";
import { buildLandingNodes, type LandingConnection, type LandingNode, type LandingNodes, type LandingScheme } from "./landingGraph.ts";

interface Preview { latitude_deg: number; longitude_deg: number; terrain_elevation_m: number; observer_height_m: number; selected_time_utc: string }
type Extra = ReactArea2D<LandingScheme>;

export function LandingGraph({ apiClient, candidate }: { apiClient: ApiClient; candidate: Candidate }): JSX.Element {
  const host: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [child, setChild] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [contracts, setContracts] = useState<LandingNode[]>([]);
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
        void engine.fetch<LandingNode>(result.id).then((value): void => {
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
          if (source === undefined || target?.label !== "Candidate" ||
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
      setContracts(graph.nodes);
      for (const [index, node] of graph.nodes.entries()) {
        await area.translate(node.id, index === 4 ? { x: 650, y: 100 } : { x: Math.floor(index / 2) * 300, y: (index % 2) * 220 });
      }
      ready = true;
      refresh();
      await AreaExtensions.zoomAt(area, editor.getNodes());
    })().catch((): void => { if (!disposed) setError("Unable to initialise the landing graph."); });
    return (): void => { disposed = true; revision++; area.destroy(); wrapper.remove(); };
  }, [candidate]);

  async function commit(): Promise<void> {
    if (preview === null || saving) return;
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
  return <section aria-label="Landing graph">
    <h3>Landing Graph</h3>
    <p>Edit height and UTC time in the nodes. Preview assembles inputs only; no new illumination or visibility calculation is performed.</p>
    <div ref={host} style={{ width: "100%", height: 540, background: "#202832", border: "1px solid #617184" }} aria-label="Rete landing graph canvas" />
    <h4>Live Preview</h4>
    {preview === null ? <p>Preview unavailable.</p> : <p>Height: {preview.observer_height_m} m · Time: {preview.selected_time_utc} · Elevation: {preview.terrain_elevation_m.toFixed(2)} m</p>}
    {error !== null && <p role="alert">{error}</p>}
    <button type="button" disabled={preview === null || saving} onClick={(): void => { void commit(); }}>Create Candidate C1</button>
    {child !== null && <section aria-label="Candidate comparison">
      <h4>Candidate C0 → C1</h4><p>C0: {candidate.candidate_id}</p><p>C1: {child.candidate_id}</p>
      <p>Observer height: {candidate.observer_height_m} m → {child.observer_height_m} m</p>
      <p>UTC time: {candidate.selected_time_utc} → {child.selected_time_utc}</p>
      <p>Terrain and coordinates retained from C0. Validation: not independently validated.</p>
    </section>}
    <details><summary>Scientific node contracts</summary>{contracts.map((node): JSX.Element => <div key={node.id}>
      <h5>{node.label}</h5><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(node.contract, null, 2)}</pre>
    </div>)}</details>
  </section>;
}
