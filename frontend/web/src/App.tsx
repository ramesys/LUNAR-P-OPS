import type { AnalysisResponse, ApiClient, Candidate, PoleMap as PoleMapData, Site, SiteResult } from "@clps/api-client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type JSX, type RefObject } from "react";
import { AssumptionsPanel } from "./components/AssumptionsPanel.tsx";
import { LandingGraph } from "./components/LandingGraph.tsx";
import { ShackletonWorkspace } from "./components/ShackletonWorkspace.tsx";
import { SelectionGuard } from "./lib/selectionGuard.ts";
import { loadContext, loadSelection, saveContext, saveSelection, type ContextSelection, type WorkspaceSelection } from "./lib/workspaceSelection.ts";
import { analysisKey, analysisLabel } from "./lib/analysisKey.ts";
import { ContextBar } from "./components/ContextBar.tsx";
import { createExplorationStore, ExplorationContext, INITIAL, INITIAL_CATALOG, type ExplorationState, type ExplorationStore } from "./lib/explorationStore.ts";
import { ChartsPanel } from "./components/ChartsPanel.tsx";
import { ComparisonTable } from "./components/ComparisonTable.tsx";
import { ExportPanel } from "./components/ExportPanel.tsx";
import { WhySouthPole, WhyTerrainMatters } from "./components/Learn.tsx";
import { ModeToggle } from "./components/ModeToggle.tsx";
import { SimpleSummary } from "./components/SimpleSummary.tsx";
import { Glossary } from "./components/Glossary.tsx";
import { ScenarioForm } from "./components/ScenarioForm.tsx";
import { PoleMap } from "./components/PoleMap.tsx";
import { HealthStatus } from "./HealthStatus.tsx";
import { describeApiError } from "./lib/apiError.ts";
import { siteIdsInSearch } from "./lib/customSite.ts";
import {
  modeFromSearch,
  nonDefaultExpertSettings,
  withExpertDefaults,
  withMode,
  type Mode,
} from "./lib/mode.ts";
import {
  formFromSearch,
  formToSearch,
  MAX_SITES,
  toRequest,
  toggleSite,
  validateForm,
  type ScenarioForm as Form,
} from "./lib/scenario.ts";

const DEFAULT_SITE_COUNT: number = 3;
const DEFAULT_RANGE_DAYS: number = 30;

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

interface AppProps {
  apiClient: ApiClient;
  now?: Date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function defaultForm(now: Date): Form {
  const start: Date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end: Date = new Date(start.getTime() + (DEFAULT_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000);
  return {
    siteIds: [],
    startDate: isoDate(start),
    endDate: isoDate(end),
    stepMinutes: 60,
    observerHeightM: 2,
    horizon: "terrain",
    earthMinClearanceDeg: 0,
  };
}

export function App({ apiClient, now = new Date() }: AppProps): JSX.Element {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  // The single space–time exploration state (selection, active evaluation, draft, cursor).
  const [store] = useState<ExplorationStore>((): ExplorationStore => {
    const saved: WorkspaceSelection | null = loadSelection();
    const context: ContextSelection = loadContext();
    const base: ExplorationState = { ...INITIAL, context: context.context,
      catalog: { ...INITIAL_CATALOG, analysisKey: context.catalogAnalysisKey, cursorUtc: context.catalogCursorUtc } };
    return createExplorationStore(saved === null ? base :
      { ...base, rootId: saved.rootId, revisionId: saved.revisionId, cursorUtc: saved.cursorUtc ?? null });
  });
  const revisionId: string | null = useSyncExternalStore(store.subscribe, (): string | null => store.getState().revisionId);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const candidateGuard: RefObject<SelectionGuard> = useRef(new SelectionGuard());
  const [sites, setSites] = useState<Site[]>([]);
  const [poleMap, setPoleMap] = useState<PoleMapData | null>(null);
  const [form, setForm] = useState<Form>((): Form => defaultForm(now));
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [resultVersion, setResultVersion] = useState<number>(0);
  const [mode, setMode] = useState<Mode>((): Mode => modeFromSearch(window.location.search));
  const modeRef: RefObject<Mode> = useRef<Mode>(mode);
  const latestRequest: RefObject<number> = useRef<number>(0);

  const onSelectionStarted: () => void = useCallback((): void => {
    candidateGuard.current.invalidate();
  }, []);
  const onCandidateSelected: (value: Candidate) => void = useCallback((value: Candidate): void => {
    candidateGuard.current.invalidate();
    setCandidateError(null);
    setCandidate(value);
    store.dispatch({ type: "select-root", rootId: value.candidate_id });
  }, [store]);
  const onSelectRevision: (revision: Candidate) => void = useCallback((revision: Candidate): void => {
    store.dispatch({ type: "select-revision", revisionId: revision.candidate_id, rootId: revision.parent_candidate_id ?? revision.candidate_id });
  }, [store]);
  // Persist identifiers only (debounced: playback moves the cursor many times per second).
  useEffect((): (() => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe: () => void = store.subscribe((): void => {
      clearTimeout(timer);
      timer = setTimeout((): void => {
        const state: ExplorationState = store.getState();
        saveContext({ context: state.context, catalogAnalysisKey: state.catalog.analysisKey, catalogCursorUtc: state.catalog.cursorUtc });
        if (state.rootId === null || state.revisionId === null) return;
        saveSelection({ rootId: state.rootId, revisionId: state.revisionId,
          evaluationId: state.evaluation?.evaluation_id ?? null, cursorUtc: state.cursorUtc });
      }, 300);
    });
    return (): void => { clearTimeout(timer); unsubscribe(); };
  }, [store]);
  useEffect((): (() => void) => {
    const guard: SelectionGuard = candidateGuard.current;
    const sequence: number = guard.next();
    const saved: WorkspaceSelection | null = loadSelection();
    if (saved !== null) {
      void apiClient.GET("/api/candidates/{candidate_id}", { params: { path: { candidate_id: saved.rootId } } })
        .then(({ data }): void => {
          if (!guard.isCurrent(sequence)) return;
          if (data === undefined) setCandidateError("The saved candidate is unavailable. Select a terrain point to continue.");
          else setCandidate(data);
        }).catch((): void => {
          if (guard.isCurrent(sequence)) setCandidateError("Could not restore the saved candidate. Check the API connection.");
        });
    }
    return (): void => { guard.invalidate(); };
  }, [apiClient]);

  function changeMode(next: Mode): void {
    modeRef.current = next;
    setMode(next);
    window.history.replaceState(null, "", withMode(window.location.search, next));
  }

  const runAnalysis: (current: Form) => Promise<void> = useCallback(
    async (current: Form): Promise<void> => {
      const requestId: number = latestRequest.current + 1;
      latestRequest.current = requestId;
      setStatus({ kind: "loading" });
      window.history.replaceState(null, "", withMode(formToSearch(current), modeRef.current));
      try {
        const { data, error, response } = await apiClient.POST("/api/analysis", {
          body: toRequest(current),
        });
        if (requestId !== latestRequest.current) {
          return;
        }
        if (data === undefined) {
          setStatus({ kind: "error", message: describeApiError(error, response.status) });
          return;
        }
        setResult(data);
        setResultVersion((v: number): number => v + 1);
        store.dispatch({ type: "catalog-analysis", analysisKey: analysisKey(data.request), label: analysisLabel(data.request),
          times: data.times, stepMinutes: data.request.step_minutes });
        setFocusedId((previous: string | null): string | null => {
          const ids: string[] = data.sites.map((s: SiteResult): string => s.site.id);
          return previous !== null && ids.includes(previous) ? previous : (ids[0] ?? null);
        });
        setStatus({ kind: "idle" });
      } catch (caught: unknown) {
        if (requestId === latestRequest.current) {
          setStatus({ kind: "error", message: caught instanceof Error ? caught.message : String(caught) });
        }
      }
    },
    [apiClient, store],
  );

  useEffect((): void => {
    apiClient
      .GET("/api/map")
      .then(({ data }): void => {
        setPoleMap(data ?? null);
      })
      .catch((): void => {
        setPoleMap(null);
      });
    const loadSites: () => Promise<void> = async (): Promise<void> => {
      const { data, error, response } = await apiClient.GET("/api/sites");
      if (data === undefined) {
        setStatus({ kind: "error", message: describeApiError(error, response.status) });
        return;
      }
      // Custom sites (RF-17) in a shared link are resolved by the API; invalid ones are dropped.
      const catalogIds: string[] = data.map((s: Site): string => s.id);
      const extraIds: string[] = siteIdsInSearch(window.location.search).filter(
        (id: string): boolean => !catalogIds.includes(id),
      );
      const extras: Site[] = (
        await Promise.all(
          extraIds.map(async (id: string): Promise<Site | null> => {
            const found: { data?: Site } = await apiClient.GET("/api/sites/{site_id}", {
              params: { path: { site_id: id } },
            });
            return found.data ?? null;
          }),
        )
      ).filter((s: Site | null): s is Site => s !== null);
      const allSites: Site[] = [...data, ...extras];
      setSites(allSites);
      const fallback: Form = {
        ...defaultForm(now),
        siteIds: catalogIds.slice(0, DEFAULT_SITE_COUNT),
      };
      const initial: Form = formFromSearch(
        window.location.search,
        fallback,
        allSites.map((s: Site): string => s.id),
      );
      setForm(initial);
      void runAnalysis(initial);
    };
    loadSites().catch((caught: unknown): void => {
      setStatus({ kind: "error", message: caught instanceof Error ? caught.message : String(caught) });
    });
    // Load the catalog (and any scenario in the URL) once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addCustomSite: (latitude: number, longitude: number) => Promise<string | null> = async (
    latitude: number,
    longitude: number,
  ): Promise<string | null> => {
    try {
      const { data, error, response } = await apiClient.GET("/api/sites/custom", {
        params: { query: { latitude, longitude } },
      });
      if (data === undefined) {
        return describeApiError(error, response.status);
      }
      setSites((previous: Site[]): Site[] =>
        previous.some((s: Site): boolean => s.id === data.id) ? previous : [...previous, data],
      );
      setForm((previous: Form): Form =>
        previous.siteIds.includes(data.id) || previous.siteIds.length >= MAX_SITES
          ? previous
          : { ...previous, siteIds: [...previous.siteIds, data.id] },
      );
      return null;
    } catch (caught: unknown) {
      return caught instanceof Error ? caught.message : String(caught);
    }
  };

  const errors: string[] = validateForm(form);
  const ranks: Map<string, number> = new Map<string, number>(
    (result?.sites ?? []).map((s: SiteResult): [string, number] => [s.site.id, s.rank]),
  );
  const focused: SiteResult | undefined =
    result?.sites.find((s: SiteResult): boolean => s.site.id === focusedId) ?? result?.sites[0];
  const focusedSite: Site | undefined = focused?.site;
  useEffect((): void => {
    store.dispatch({ type: "catalog-focus", focus: focusedSite === undefined ? null :
      { siteId: focusedSite.id, name: focusedSite.name, latitude_deg: focusedSite.latitude_deg, longitude_deg: focusedSite.longitude_deg } });
  }, [store, focusedSite]);

  return (
    <ExplorationContext.Provider value={store}>
    <div className="context-bar-wrap"><ContextBar /></div>
    <div className="page">
      <header className="page-header">
        <div className="title-row">
          <h1>CLPS Lunar Mission Browser</h1>
          <ModeToggle mode={mode} onChange={changeMode} />
        </div>
        <p className="lede">
          Compare candidate landing sites near the lunar south pole: when is the Sun up for solar power, and
          when is the Earth in view for direct-to-Earth communication?
        </p>
        <p className="notice" role="note">
          The sites below are <strong>placeholder samples</strong> with arbitrary coordinates, not official
          CLPS landing sites. Horizons use NASA LOLA terrain where it is available. The page address keeps
          your selection, so you can share it.
        </p>
      </header>

      <ol className="workflow" aria-label="Workflow">
        <li className={candidate === null ? "current" : "done"}>Explore the terrain and click a point (or a marker)</li>
        <li className={candidate === null ? "" : "done"}>Candidate C0 is saved from the LOLA DEM</li>
        <li className={candidate === null ? "" : "current"}>Edit height or time, then <strong>Create Candidate C1</strong></li>
        <li className={candidate === null ? "" : "current"}><strong>Evaluate</strong> the selected revision</li>
        <li>Compare and read the results in the Inspector</li>
      </ol>

      <section className="workspace" id="candidate-context" aria-label="Landing workspace">
        <ShackletonWorkspace
          apiClient={apiClient}
          selectedCandidateId={candidate?.candidate_id ?? null}
          onCandidateSelected={onCandidateSelected}
          defaultTimeUtc={`${defaultForm(now).startDate}T00:00:00Z`}
          defaultObserverHeightM={defaultForm(now).observerHeightM}
        />
        {candidate === null ? <>
          <section className="ws-graph card" aria-label="Landing graph"><h2>Landing Graph</h2><p>Select a terrain point to create a candidate.</p></section>
          <aside className="ws-inspector card" aria-label="Inspector"><h2>Inspector</h2><p className="muted">No candidate selected. Click the Shackleton terrain, pick a marker, or click the Sample A 3D view below.</p></aside>
        </> : <LandingGraph key={candidate.candidate_id} apiClient={apiClient} candidate={candidate}
            selectedRevisionId={revisionId ?? candidate.candidate_id} onSelectRevision={onSelectRevision} mode={mode} />}
        {candidateError !== null && <p role="alert" className="ws-alert">{candidateError}</p>}
      </section>

      <h2 className="section-title" id="catalog-title">Catalog site comparison</h2>
      <p className="muted section-lede">The original CLPS browser: compare 2–4 sites over a date range with terrain horizons, sky diagrams and timelines.</p>
      <div className="setup">
        <ScenarioForm
          sites={sites}
          form={form}
          errors={errors}
          busy={status.kind === "loading"}
          onChange={setForm}
          onSubmit={(): void => {
            void runAnalysis(form);
          }}
          onAddCustomSite={addCustomSite}
          mode={mode}
          expertNotes={nonDefaultExpertSettings(form)}
          onResetExpert={(): void => {
            setForm(withExpertDefaults(form));
          }}
        />
        {poleMap !== null && (
          <section className="card" aria-labelledby="map-title">
            <h2 id="map-title">South pole map</h2>
            <PoleMap
              map={poleMap}
              sites={sites}
              selectedIds={form.siteIds}
              ranks={ranks}
              maxSelected={MAX_SITES}
              onToggle={(siteId: string): void => {
                setForm({ ...form, siteIds: toggleSite(form.siteIds, siteId) });
              }}
            />
          </section>
        )}
      </div>


      {status.kind === "error" && (
        <p className="error-banner" role="alert">
          {status.message}
        </p>
      )}

      {result !== null && focused !== undefined && (
        <main className={status.kind === "loading" ? "results stale" : "results"} aria-busy={status.kind === "loading"}>
          <section className="card" aria-labelledby="comparison-title">
            <h2 id="comparison-title">Comparison</h2>
            {mode === "simple" && <SimpleSummary sites={result.sites} />}
            <ComparisonTable
              sites={result.sites}
              focusedId={focused.site.id}
              onFocus={setFocusedId}
              expert={mode === "expert"}
            />
            {mode === "expert" && <ExportPanel result={result} />}
          </section>

          <ChartsPanel
            key={resultVersion}
            result={result}
            focused={focused}
            onFocus={setFocusedId}
            mode={mode}
            apiClient={apiClient}
            onCandidateSelected={onCandidateSelected}
            onSelectionStarted={onSelectionStarted}
          />

          <section className="card" aria-labelledby="learn-title">
            <h2 id="learn-title">Learn more</h2>
            <WhySouthPole open={mode === "simple"} />
            <WhyTerrainMatters open={mode === "simple"} />
          </section>

          <div className="two-col">
            <AssumptionsPanel assumptions={result.assumptions} dataSources={result.data_sources} />
            <Glossary />
          </div>
        </main>
      )}

      <footer className="page-footer muted">
        <HealthStatus apiClient={apiClient} /> · NASA Space Apps Challenge 2026
      </footer>
    </div>
    </ExplorationContext.Provider>
  );
}
