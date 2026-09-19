import type { AnalysisResponse } from "@clps/api-client";
import type { JSX } from "react";
import { exportFileName, summaryCsv, timeSeriesCsv, windowsCsv } from "../lib/csv.ts";
import { downloadBlob } from "../lib/download.ts";
import { InfoTip } from "./InfoTip.tsx";

interface ExportPanelProps {
  result: AnalysisResponse;
}

interface ExportOption {
  kind: string;
  label: string;
  build: (result: AnalysisResponse) => string;
}

const OPTIONS: readonly ExportOption[] = [
  { kind: "summary", label: "Summary", build: summaryCsv },
  { kind: "timeseries", label: "Time series", build: timeSeriesCsv },
  { kind: "windows", label: "Windows", build: windowsCsv },
];

/** RF-18: download the current comparison as CSV (UTC times, degrees, hours). */
export function ExportPanel({ result }: ExportPanelProps): JSX.Element {
  return (
    <div className="export" role="group" aria-label="Export">
      <span className="muted">
        Download CSV{" "}
        <InfoTip text="Summary: one row per site with its metrics and the scenario settings. Time series: every sample with Sun and Earth positions, horizon and visibility. Windows: every sunlight, darkness and DTE period. Times in UTC." />
      </span>
      {OPTIONS.map(
        (option: ExportOption): JSX.Element => (
          <button
            key={option.kind}
            type="button"
            onClick={(): void => {
              downloadBlob(
                exportFileName(result, option.kind),
                new Blob([option.build(result)], { type: "text/csv;charset=utf-8" }),
              );
            }}
          >
            {option.label}
          </button>
        ),
      )}
    </div>
  );
}
