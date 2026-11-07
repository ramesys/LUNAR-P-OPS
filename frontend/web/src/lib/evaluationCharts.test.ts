import { describe, expect, it } from "vitest";
import { computationState, evaluationChart, visibleHours, type EvaluationChart } from "./evaluationCharts.ts";
import { evaluation } from "./testFixtures.ts";

describe("evaluation charts", (): void => {
  it("copies persisted values into the original chart model without recomputing", (): void => {
    const chart: EvaluationChart | null = evaluationChart(evaluation(), "C0");
    expect(chart?.times).toEqual(["2026-11-07T00:00:00Z", "2026-11-07T01:00:00Z"]);
    expect(chart?.rangeEnd).toBe("2026-11-07T02:00:00.000Z");
    expect(chart?.site.sun).toEqual({ azimuth_deg: [10, 25], elevation_deg: [3, 1], horizon_deg: [1.5, 1.6] });
    expect(chart?.site.earth.horizon_deg).toEqual([2, 2]);
    expect(chart?.site.horizon_mask).toEqual({ azimuth_deg: [0, 180], elevation_deg: [1.5, 2.5] });
    expect(chart?.site.sun_windows).toEqual([{ start: "2026-11-07T00:00:00Z", end: "2026-11-07T01:00:00Z", duration_hours: 1, visible: true, truncated: true }]);
    expect(chart?.site.earth_windows).toEqual([]);
    expect(chart?.site.horizon_model).toBe("terrain");
    expect(visibleHours(evaluation(), "sun")).toBe(1);
  });

  it("draws nothing for an unavailable evaluation and keeps the states separate", (): void => {
    expect(evaluationChart(evaluation("UNAVAILABLE"), "C0")).toBeNull();
    expect(computationState(null)).toBe("not-run");
    expect(computationState(evaluation())).toBe("succeeded");
    expect(computationState(evaluation("UNAVAILABLE"))).toBe("unavailable");
    expect(computationState(evaluation("ERROR"))).toBe("failed");
  });
});
