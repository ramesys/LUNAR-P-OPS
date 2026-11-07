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
