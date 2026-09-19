import type { SiteResult, VisibilityWindow } from "@clps/api-client";
import { describe, expect, it } from "vitest";
import {
  modeFromSearch,
  nonDefaultExpertSettings,
  withExpertDefaults,
  withMode,
} from "./mode.ts";
import { darknessSentence, earthSentence, sunSentence, verdict } from "./plainLanguage.ts";
import type { ScenarioForm } from "./scenario.ts";

function window(hours: number, truncated: boolean): VisibilityWindow {
  return {
    start: "2026-01-01T00:00:00Z",
    end: "2026-01-02T00:00:00Z",
    duration_hours: hours,
    visible: false,
    truncated,
  };
}

function site(id: string, sun: number, earth: number, outage: VisibilityWindow | null = null): SiteResult {
  return {
    rank: 1,
    site: {
      id,
      name: `Site ${id}`,
      latitude_deg: -89,
      longitude_deg: 0,
      origin: "sample",
      note: "",
      terrain_available: true,
      map_x_m: 0,
      map_y_m: 0,
    },
    horizon_model: "terrain",
    horizon_mask: null,
    metrics: { sun_fraction: sun, earth_fraction: earth, longest_darkness: null, longest_earth_outage: outage },
    sun: { azimuth_deg: [], elevation_deg: [], horizon_deg: [] },
    earth: { azimuth_deg: [], elevation_deg: [], horizon_deg: [] },
    sun_windows: [],
    earth_windows: [],
  };
}

const FORM: ScenarioForm = {
  siteIds: ["a", "b"],
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  stepMinutes: 60,
  observerHeightM: 2,
  horizon: "terrain",
  earthMinClearanceDeg: 0,
};

describe("plain language (RF-16)", (): void => {
  it("describes sunlight in days per month, with the edge cases", (): void => {
    expect(sunSentence(site("a", 0.298, 0))).toBe(
      "Sunlit 30% of the time: about 9 days of sunlight per month.",
    );
    expect(sunSentence(site("a", 0, 0))).toMatch(/never reaches/);
    expect(sunSentence(site("a", 1, 0))).toMatch(/whole time/);
  });

  it("describes the longest night for batteries, marking truncated windows", (): void => {
    expect(darknessSentence(window(552, false))).toBe(
      "Longest night: 23 days. A solar-powered lander must survive that long on batteries.",
    );
    expect(darknessSentence(window(30, true))).toMatch(/^Longest night: at least 30 hours\./);
    expect(darknessSentence(window(87.2 * 24, false))).toMatch(/87 days/);
    expect(darknessSentence(null)).toBe("No darkness at all in these dates.");
  });

  it("describes contact with Earth and the need for a relay", (): void => {
    expect(earthSentence(site("a", 0.5, 0))).toMatch(/relay satellite/);
    expect(earthSentence(site("a", 0.5, 0.508, window(338, false)))).toBe(
      "The Earth is in view 51% of the time. The longest silence lasts 14 days.",
    );
  });

  it("picks the best site for power and for communication", (): void => {
    expect(verdict([site("b", 0.3, 0.5), site("a", 0.1, 0.4)])).toMatch(/^Site b leads on both/);
    expect(verdict([site("b", 0.3, 0.2), site("a", 0.1, 0.4)])).toMatch(
      /^Most sunlight: Site b\. Most time in contact with Earth: Site a\./,
    );
    expect(verdict([])).toBe("");
  });
});

describe("mode (RF-16)", (): void => {
  it("reads and writes the mode in the URL, defaulting to simple", (): void => {
    expect(modeFromSearch("")).toBe("simple");
    expect(modeFromSearch("?mode=expert")).toBe("expert");
    expect(modeFromSearch("?mode=nonsense")).toBe("simple");
    expect(withMode("?sites=a%2Cb", "expert")).toBe("?sites=a%2Cb&mode=expert");
  });

  it("lists expert-only settings that differ from the defaults, and resets them", (): void => {
    expect(nonDefaultExpertSettings(FORM)).toEqual([]);
    const custom: ScenarioForm = { ...FORM, stepMinutes: 360, horizon: "flat", earthMinClearanceDeg: 2 };
    expect(nonDefaultExpertSettings(custom)).toEqual([
      "sampling step 360 min",
      "flat horizon (terrain ignored)",
      "Earth at least 2° above the horizon",
    ]);
    expect(withExpertDefaults(custom)).toEqual(FORM);
  });
});
