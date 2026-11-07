import type { AnalysisRequest } from "@clps/api-client";

/**
 * Deterministic identifier of a catalog comparison: FNV-1a over its exact request. The analysis is
 * not persisted, so this key (not a database id) is what links cursors and labels to one scenario.
 */
export function analysisKey(request: AnalysisRequest): string {
  const text: string = JSON.stringify(request, Object.keys(request).sort());
  let hash: number = 0x811c9dc5;
  for (let i: number = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `analysis-${hash.toString(16).padStart(8, "0")}`;
}

export function analysisLabel(request: AnalysisRequest): string {
  const end: string = new Date(Date.parse(request.end) - 1).toISOString().slice(0, 10);
  return `${request.site_ids.length.toString()} sites · ${request.start.slice(0, 10)} → ${end} · ${request.step_minutes.toString()} min · ${request.horizon} horizon`;
}
