import type { SiteResult, VisibilityWindow } from "@clps/api-client";
import type { JSX } from "react";
import { formatHours, formatUtc } from "../lib/format.ts";

interface WindowsTableProps {
  result: SiteResult;
}

interface Row {
  kind: string;
  window: VisibilityWindow;
}

function label(kind: "sun" | "earth", visible: boolean): string {
  if (kind === "sun") {
    return visible ? "Sunlight" : "Darkness";
  }
  return visible ? "DTE available" : "No DTE";
}

/** Table twin of the timeline bands: every window with exact start, end and duration. */
export function WindowsTable({ result }: WindowsTableProps): JSX.Element {
  const rows: Row[] = [
    ...result.sun_windows.map((w: VisibilityWindow): Row => ({ kind: label("sun", w.visible), window: w })),
    ...result.earth_windows.map(
      (w: VisibilityWindow): Row => ({ kind: label("earth", w.visible), window: w }),
    ),
  ].sort((a: Row, b: Row): number => a.window.start.localeCompare(b.window.start));

  return (
    <details className="windows">
      <summary>
        All windows for {result.site.name} ({rows.length.toString()})
      </summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Start</th>
              <th scope="col">End</th>
              <th scope="col" className="num">
                Duration
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(
              (row: Row): JSX.Element => (
                <tr key={`${row.kind}-${row.window.start}`}>
                  <td>{row.kind}</td>
                  <td>{formatUtc(row.window.start)}</td>
                  <td>{formatUtc(row.window.end)}</td>
                  <td className="num">
                    {row.window.truncated ? "≥ " : ""}
                    {formatHours(row.window.duration_hours)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}
