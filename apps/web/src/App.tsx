import type { AnalysisResponse, ApiClient, PoleMap as PoleMapData, Site, SiteResult } from "@clps/api-client";
import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from "react";
import { AssumptionsPanel } from "./components/AssumptionsPanel.tsx";
import { ChartsPanel } from "./components/ChartsPanel.tsx";
import { ComparisonTable } from "./components/ComparisonTable.tsx";
import { ExportPanel } from "./components/ExportPanel.tsx";
import { Glossary } from "./components/Glossary.tsx";
import { ScenarioForm } from "./components/ScenarioForm.tsx";
import { PoleMap } from "./components/PoleMap.tsx";
import { HealthStatus } from "./HealthStatus.tsx";
import { describeApiError } from "./lib/apiError.ts";
import { siteIdsInSearch } from "./lib/customSite.ts";
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
  const [sites, setSites] = useState<Site[]>([]);
  const [poleMap, setPoleMap] = useState<PoleMapData | null>(null);
  const [form, setForm] = useState<Form>((): Form => defaultForm(now));
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [resultVersion, setResultVersion] = useState<number>(0);
  const latestRequest: RefObject<number> = useRef<number>(0);

  const runAnalysis: (current: Form) => Promise<void> = useCallback(
    async (current: Form): Promise<void> => {
      const requestId: number = latestRequest.current + 1;
      latestRequest.current = requestId;
      setStatus({ kind: "loading" });
      window.history.replaceState(null, "", formToSearch(current));
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
    [apiClient],
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

  return (
    <div className="page">
      <header className="page-header">
        <h1>CLPS Lunar Mission Browser</h1>
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
            <ComparisonTable sites={result.sites} focusedId={focused.site.id} onFocus={setFocusedId} />
            <ExportPanel result={result} />
          </section>

          <ChartsPanel
            key={resultVersion}
            result={result}
            focused={focused}
            onFocus={setFocusedId}
          />

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
  );
}
