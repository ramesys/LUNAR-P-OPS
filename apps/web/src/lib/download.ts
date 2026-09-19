import type { AnalysisRequest } from "@clps/api-client";

/** Save a blob as a file through a temporary link (works in every modern browser). */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url: string = URL.createObjectURL(blob);
  const link: HTMLAnchorElement = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Inclusive UTC date range of a request: its `end` is exclusive (midnight after the last day). */
export function inclusiveDateRange(request: AnalysisRequest): [string, string] {
  const start: string = request.start.slice(0, 10);
  const lastIncluded: string = new Date(Date.parse(request.end) - 1).toISOString().slice(0, 10);
  return [start, lastIncluded];
}

/** File-name-safe slug, e.g. "Custom 87.50°S 10.00°E" → "custom-87-50s-10-00e". */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
