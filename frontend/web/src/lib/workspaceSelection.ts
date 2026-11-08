import { TERRAIN_PARAM_DEFAULTS, type BrushParams } from "./explorationStore.ts";
/**
 * The one persisted workspace selection: the root candidate (C0) whose graph is open and the
 * committed revision (C0 or its C1) on the graph's `candidate_ref` output. Only identifiers are
 * stored; candidates and evaluations are always re-read from the API.
 */
export interface WorkspaceSelection {
  rootId: string;
  revisionId: string;
  /** Inspected stored evaluation of the revision, if one was chosen. */
  evaluationId?: string | null;
  /** Inspected sample time; display state only. */
  cursorUtc?: string | null;
}

/** Display state that is restored even before any candidate exists. */
export interface ContextSelection { context: "candidate" | "catalog"; catalogAnalysisKey: string | null; catalogCursorUtc: string | null }

const CONTEXT_KEY: string = "lunar-ops-context";

export function loadContext(): ContextSelection {
  const fallback: ContextSelection = { context: "candidate", catalogAnalysisKey: null, catalogCursorUtc: null };
  const raw: string | null = read(CONTEXT_KEY);
  if (raw === null) return fallback;
  try {
    const parsed: Partial<ContextSelection> = JSON.parse(raw) as Partial<ContextSelection>;
    return {
      context: parsed.context === "catalog" ? "catalog" : "candidate",
      catalogAnalysisKey: typeof parsed.catalogAnalysisKey === "string" ? parsed.catalogAnalysisKey : null,
      catalogCursorUtc: typeof parsed.catalogCursorUtc === "string" && Number.isFinite(Date.parse(parsed.catalogCursorUtc)) ? parsed.catalogCursorUtc : null,
    };
  } catch { return fallback; }
}

export function saveContext(selection: ContextSelection): void {
  try { localStorage.setItem(CONTEXT_KEY, JSON.stringify(selection)); } catch { /* not restored */ }
}

const KEY: string = "lunar-ops-selection";
/** Sprint 02–04 pointer to the selected C0; still read so older sessions restore. */
const LEGACY_KEY: string = "lunar-ops-c0";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function loadSelection(): WorkspaceSelection | null {
  const raw: string | null = read(KEY);
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const { rootId, revisionId, evaluationId, cursorUtc } = parsed as Partial<WorkspaceSelection>;
        if (typeof rootId === "string" && rootId !== "") {
          return { rootId, revisionId: typeof revisionId === "string" && revisionId !== "" ? revisionId : rootId,
            evaluationId: typeof evaluationId === "string" ? evaluationId : null,
            cursorUtc: typeof cursorUtc === "string" && Number.isFinite(Date.parse(cursorUtc)) ? cursorUtc : null };
        }
      }
    } catch { /* Fall back to the legacy pointer. */ }
  }
  const legacy: string | null = read(LEGACY_KEY);
  return legacy === null || legacy === "" ? null : { rootId: legacy, revisionId: legacy, evaluationId: null, cursorUtc: null };
}

export function saveSelection(selection: WorkspaceSelection): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(selection));
    localStorage.setItem(LEGACY_KEY, selection.rootId);
  } catch { /* Storage unavailable: the selection simply is not restored after reload. */ }
}

/** Drawn brush regions (definitions only). Previews and results are not stored here; the persisted
 * candidates and evaluations stay in the API database, and exported JSON keeps a run's results. */
export interface StoredRegion { id: string; number: number; vertices: { east_m: number; north_m: number }[]; closed: boolean; params: BrushParams }
export interface StoredRegions { regions: StoredRegion[]; activeRegionId: string | null }

const REGIONS_KEY: string = "lunar-ops-regions";
const MAX_STORED_REGIONS: number = 32;

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

function validParams(value: unknown): value is BrushParams {
  if (typeof value !== "object" || value === null) return false;
  const p: Record<string, unknown> = value as Record<string, unknown>;
  return ["spacing_m", "max_points", "observer_height_m", "duration_hours", "step_minutes", "min_sun_pct", "min_earth_pct", "min_both_pct"]
    .every((key: string): boolean => finite(p[key])) && typeof p["start_utc"] === "string"
    && typeof p["max_darkness_hours"] === "string" && typeof p["max_earth_gap_hours"] === "string"
    && (p["retention"] === "all" || p["retention"] === "passing");
}

/** Fill terrain fields missing from regions stored before terrain screening; drop invalid ones. */
function withTerrainDefaults(params: BrushParams): BrushParams {
  const p: Partial<BrushParams> = params;
  const text: (value: unknown, fallback: string) => string = (value: unknown, fallback: string): string => typeof value === "string" ? value : fallback;
  const merged: BrushParams = {
    ...params,
    terrain_enabled: typeof p.terrain_enabled === "boolean" ? p.terrain_enabled : TERRAIN_PARAM_DEFAULTS.terrain_enabled,
    terrain_radius_m: finite(p.terrain_radius_m) ? p.terrain_radius_m : TERRAIN_PARAM_DEFAULTS.terrain_radius_m,
    max_local_slope_deg: text(p.max_local_slope_deg, TERRAIN_PARAM_DEFAULTS.max_local_slope_deg),
    max_neighborhood_slope_deg: text(p.max_neighborhood_slope_deg, TERRAIN_PARAM_DEFAULTS.max_neighborhood_slope_deg),
    max_roughness_rms_m: text(p.max_roughness_rms_m, TERRAIN_PARAM_DEFAULTS.max_roughness_rms_m),
    max_relief_m: text(p.max_relief_m, TERRAIN_PARAM_DEFAULTS.max_relief_m),
    min_coverage_pct: finite(p.min_coverage_pct) ? p.min_coverage_pct : TERRAIN_PARAM_DEFAULTS.min_coverage_pct,
    evidence: p.evidence === "visibility_terrain" ? "visibility_terrain" : "visibility",
  };
  return merged;
}

export function loadRegions(): StoredRegions {
  const empty: StoredRegions = { regions: [], activeRegionId: null };
  const raw: string | null = read(REGIONS_KEY);
  if (raw === null) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty;
    const list: unknown = (parsed as { regions?: unknown }).regions;
    if (!Array.isArray(list)) return empty;
    const regions: StoredRegion[] = list.slice(0, MAX_STORED_REGIONS).flatMap((item: unknown): StoredRegion[] => {
      if (typeof item !== "object" || item === null) return [];
      const r: Record<string, unknown> = item as Record<string, unknown>;
      const vertices: unknown = r["vertices"];
      if (typeof r["id"] !== "string" || !finite(r["number"]) || typeof r["closed"] !== "boolean" || !Array.isArray(vertices) || !validParams(r["params"])) return [];
      const points: { east_m: number; north_m: number }[] = vertices.flatMap((v: unknown): { east_m: number; north_m: number }[] => {
        const point: Record<string, unknown> = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
        return finite(point["east_m"]) && finite(point["north_m"]) ? [{ east_m: point["east_m"], north_m: point["north_m"] }] : [];
      });
      if (points.length !== vertices.length) return [];
      return [{ id: r["id"], number: r["number"], vertices: points, closed: r["closed"] && points.length >= 3, params: withTerrainDefaults(r["params"]) }];
    });
    const active: unknown = (parsed as { activeRegionId?: unknown }).activeRegionId;
    return { regions, activeRegionId: typeof active === "string" && regions.some((r: StoredRegion): boolean => r.id === active) ? active : regions.at(-1)?.id ?? null };
  } catch { return empty; }
}

export function saveRegions(stored: StoredRegions): void {
  try { localStorage.setItem(REGIONS_KEY, JSON.stringify(stored)); } catch { /* not restored */ }
}
