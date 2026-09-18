import type { VisibilityWindow } from "@clps/api-client";
import { describe, expect, it } from "vitest";
import { describeApiError } from "./apiError.ts";
import { formatHours, formatLatLon, formatPercent, formatWindowDuration } from "./format.ts";
import { elevationDomain, linearScale, niceTicks, type Scale } from "./scale.ts";
import { toRequest, toggleSite, validateForm, type ScenarioForm } from "./scenario.ts";
import { splitAtAzimuthWrap, type SkyPoint } from "./sky.ts";

const window: VisibilityWindow = {
  start: "2026-01-01T00:00:00Z",
  end: "2026-01-03T12:00:00Z",
  duration_hours: 60,
  visible: false,
  truncated: true,
};

const form: ScenarioForm = {
  siteIds: ["sample-a", "sample-b"],
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  stepMinutes: 60,
  observerHeightM: 2,
};

describe("format", (): void => {
  it("formats percentages, hours, days and coordinates", (): void => {
    expect(formatPercent(0.5751)).toBe("57.5%");
    expect(formatHours(5)).toBe("5.0 h");
    expect(formatHours(23)).toBe("23 h");
    expect(formatHours(72)).toBe("3.0 d");
    expect(formatLatLon(-89.5, 0)).toBe("89.50°S, 0.00°E");
  });

  it("marks truncated windows with ≥ and handles missing windows", (): void => {
    expect(formatWindowDuration(window)).toBe("≥ 2.5 d");
    expect(formatWindowDuration({ ...window, truncated: false })).toBe("2.5 d");
    expect(formatWindowDuration(null)).toBe("none");
  });
});

describe("scale", (): void => {
  it("maps linearly, including inverted ranges", (): void => {
    const y: Scale = linearScale([-5, 5], [100, 0]);
    expect(y(-5)).toBe(100);
    expect(y(0)).toBe(50);
    expect(y(5)).toBe(0);
  });

  it("produces nice ticks and a padded elevation domain around the horizon", (): void => {
    expect(niceTicks(-3, 7, 5)).toEqual([-2, 0, 2, 4, 6]);
    expect(elevationDomain([-1.2, 6.4])).toEqual([-3, 8]);
    expect(elevationDomain([-5.5, 0])).toEqual([-7, 3]);
    expect(elevationDomain([])).toEqual([-3, 3]);
  });
});

describe("sky", (): void => {
  it("splits tracks where azimuth wraps across north", (): void => {
    const segments: SkyPoint[][] = splitAtAzimuthWrap([350, 355, 2, 8], [1, 2, 3, 4]);
    expect(segments.map((s: SkyPoint[]): number => s.length)).toEqual([2, 2]);
    expect(segments[1]?.[0]).toEqual({ azimuthDeg: 2, elevationDeg: 3 });
  });
});

describe("scenario", (): void => {
  it("turns inclusive dates into a half-open UTC range", (): void => {
    expect(toRequest(form)).toEqual({
      site_ids: ["sample-a", "sample-b"],
      start: "2026-01-01T00:00:00Z",
      end: "2026-02-01T00:00:00.000Z",
      step_minutes: 60,
      observer_height_m: 2,
    });
  });

  it("validates site count, date order, range length and height", (): void => {
    expect(validateForm(form)).toEqual([]);
    expect(validateForm({ ...form, siteIds: ["sample-a"] })).toEqual(["Select between 2 and 4 sites."]);
    expect(validateForm({ ...form, endDate: "2025-12-31" })).toEqual([
      "The end date must not be before the start date.",
    ]);
    expect(validateForm({ ...form, endDate: "2027-01-02" })).toEqual([
      "The date range can be at most one year.",
    ]);
    expect(validateForm({ ...form, endDate: "2027-01-01" })).toEqual([]);
    expect(validateForm({ ...form, observerHeightM: -1 })).toEqual(["Observer height must be 0 m or more."]);
  });

  it("toggles site selection", (): void => {
    expect(toggleSite(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSite(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("describeApiError", (): void => {
  it("reads string details, pydantic error lists, and falls back to the status", (): void => {
    expect(describeApiError({ detail: "unknown site ids: x" }, 422)).toBe("unknown site ids: x");
    expect(describeApiError({ detail: [{ msg: "a" }, { msg: "b" }] }, 422)).toBe("a; b");
    expect(describeApiError(undefined, 500)).toBe("Request failed (HTTP 500)");
  });
});
