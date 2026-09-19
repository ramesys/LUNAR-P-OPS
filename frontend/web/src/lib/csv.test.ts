import type { AnalysisResponse, SiteResult, VisibilityWindow } from "@clps/api-client";
import { describe, expect, it } from "vitest";
import {
  exportFileName,
  flagsFromWindows,
  summaryCsv,
  timeSeriesCsv,
  toCsv,
  windowsCsv,
} from "./csv.ts";

const TIMES: string[] = ["2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"];
const END: string = "2026-01-01T03:00:00Z";

function win(start: string, end: string, visible: boolean, hours: number): VisibilityWindow {
  return { start, end, duration_hours: hours, visible, truncated: start === TIMES[0] || end === END };
}

const SITE: SiteResult = {
  rank: 1,
  site: {
    id: "custom:-87.5:10",
    name: 'Site "A", north rim',
    latitude_deg: -87.5,
    longitude_deg: 10,
    origin: "custom",
    note: "",
    terrain_available: false,
    map_x_m: 0,
    map_y_m: 0,
  },
  horizon_model: "flat",
  horizon_mask: null,
  metrics: {
    sun_fraction: 0.666666,
    earth_fraction: 1,
    longest_darkness: win(TIMES[1] ?? "", END, false, 2),
    longest_earth_outage: null,
  },
  sun: { azimuth_deg: [10, 20, 30], elevation_deg: [1, -1, -2], horizon_deg: [0, 0, 0] },
  earth: { azimuth_deg: [5, 5, 5], elevation_deg: [3, 3, 3], horizon_deg: [0, 0, 0] },
  sun_windows: [win(TIMES[0] ?? "", TIMES[1] ?? "", true, 1), win(TIMES[1] ?? "", END, false, 2)],
  earth_windows: [win(TIMES[0] ?? "", END, true, 3)],
};

const RESULT: AnalysisResponse = {
  request: {
    site_ids: ["custom:-87.5:10", "sample-a"],
    start: TIMES[0] ?? "",
    end: END,
    step_minutes: 60,
    observer_height_m: 2,
    horizon: "terrain",
    earth_min_clearance_deg: 1.5,
  },
  times: TIMES,
  sites: [SITE],
  assumptions: [],
  data_sources: [],
};

function lines(csv: string): string[] {
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  return csv.slice(1).split("\r\n").filter((line: string): boolean => line !== "");
}

describe("CSV export (RF-18)", (): void => {
  it("quotes fields per RFC 4180 and starts with a UTF-8 BOM", (): void => {
    expect(lines(toCsv(["a", "b"], [["x,y", 'say "hi"'], [null, true]]))).toEqual([
      "a,b",
      '"x,y","say ""hi"""',
      ",true",
    ]);
  });

  it("writes one summary row per site with metrics and scenario settings", (): void => {
    const [header, row] = lines(summaryCsv(RESULT));
    expect(header?.split(",").slice(0, 3)).toEqual(["rank", "site_id", "site_name"]);
    expect(row).toBe(
      '1,custom:-87.5:10,"Site ""A"", north rim",custom,-87.5,10,flat,66.67,100,2,true,,,' +
        "2026-01-01T00:00:00Z,2026-01-01T03:00:00Z,60,2,terrain,1.5",
    );
  });

  it("derives per-sample visibility from the windows", (): void => {
    expect(flagsFromWindows(TIMES, SITE.sun_windows)).toEqual([true, false, false]);
    expect(flagsFromWindows(TIMES, SITE.earth_windows)).toEqual([true, true, true]);
    expect(flagsFromWindows(TIMES, [])).toEqual([false, false, false]);
  });

  it("exports every sample and every window", (): void => {
    const series: string[] = lines(timeSeriesCsv(RESULT));
    expect(series).toHaveLength(1 + TIMES.length);
    expect(series[2]).toBe("2026-01-01T01:00:00Z,custom:-87.5:10,20,-1,0,false,5,3,0,true");

    const windows: string[] = lines(windowsCsv(RESULT));
    expect(windows).toEqual([
      "site_id,period,start_utc,end_utc,duration_hours,truncated",
      "custom:-87.5:10,sunlight,2026-01-01T00:00:00Z,2026-01-01T01:00:00Z,1,true",
      "custom:-87.5:10,darkness,2026-01-01T01:00:00Z,2026-01-01T03:00:00Z,2,true",
      "custom:-87.5:10,dte,2026-01-01T00:00:00Z,2026-01-01T03:00:00Z,3,true",
    ]);
  });

  it("names files with the inclusive date range", (): void => {
    expect(exportFileName(RESULT, "summary")).toBe("clps-summary_2026-01-01_2026-01-01.csv");
    const year: AnalysisResponse = {
      ...RESULT,
      request: { ...RESULT.request, end: "2027-01-01T00:00:00.000Z" },
    };
    expect(exportFileName(year, "windows")).toBe("clps-windows_2026-01-01_2026-12-31.csv");
  });
});
