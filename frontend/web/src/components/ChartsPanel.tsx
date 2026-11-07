import type { AnalysisResponse, ApiClient, Candidate, SiteResult } from "@clps/api-client";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type JSX,
  type LazyExoticComponent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { chartToPng, type LegendEntry } from "../lib/chartImage.ts";
import { downloadBlob, inclusiveDateRange, slug } from "../lib/download.ts";
import { formatUtc } from "../lib/format.ts";
import {
  clampIndex,
  DEFAULT_SPEED,
  samplesPerTick,
  TICK_MS,
  trailSamples,
  visibleAt,
} from "../lib/playback.ts";
import type { Mode } from "../lib/mode.ts";
import { useElementWidth } from "../lib/useElementWidth.ts";
import { HoverReadout } from "./HoverReadout.tsx";
import { HowToReadSky, HowToReadTimeline } from "./Learn.tsx";
import { SkyChart } from "./SkyChart.tsx";
import { TimeControl } from "./TimeControl.tsx";
import { Timeline } from "./Timeline.tsx";
import type { Terrain3DProps } from "./Terrain3D.tsx";
import { WindowsTable } from "./WindowsTable.tsx";

/** three.js is only downloaded when the 3D view is opened (RF-19). */
const Terrain3D: LazyExoticComponent<ComponentType<Terrain3DProps>> = lazy(
  async (): Promise<{ default: ComponentType<Terrain3DProps> }> => ({
    default: (await import("./Terrain3D.tsx")).Terrain3D,
  }),
);

const DEFAULT_CHART_WIDTH: number = 960;
const MIN_CHART_WIDTH: number = 320;

type ChartKind = "sky" | "timeline";

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface ChartsPanelProps {
  result: AnalysisResponse;
  focused: SiteResult;
  onFocus: (siteId: string) => void;
  mode: Mode;
  apiClient: ApiClient;
  onCandidateSelected: (candidate: Candidate) => void;
  onSelectionStarted: () => void;
}

/**
 * Sky diagram + timeline sharing one instant (RF-12). Time state lives here, not in App, so
 * playback re-renders only the charts. Mount with a new `key` per result to reset it.
 */
export function ChartsPanel({ result, focused, onFocus, mode, apiClient, onCandidateSelected, onSelectionStarted }: ChartsPanelProps): JSX.Element {
  const expert: boolean = mode === "expert";
  const [index, setIndex] = useState<number>(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState<boolean>(false);
  const [hoursPerSecond, setHoursPerSecond] = useState<number>(DEFAULT_SPEED);
  const position: RefObject<number> = useRef<number>(0);
  const chartsRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const skyRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const timelineRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [show3d, setShow3d] = useState<boolean>(false);
  const measuredWidth: number = useElementWidth(chartsRef, DEFAULT_CHART_WIDTH);
  const chartWidth: number = Math.max(MIN_CHART_WIDTH, measuredWidth);
  const count: number = result.times.length;
  const stepMinutes: number = result.request.step_minutes;

  useEffect((): (() => void) | undefined => {
    if (!playing) {
      return undefined;
    }
    position.current = index;
    const perTick: number = samplesPerTick(hoursPerSecond, stepMinutes);
    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      position.current = Math.min(count - 1, position.current + perTick);
      // Tolerance: repeated fractional sums (0.3 × 20 = 5.999…) must not lose a sample.
      setIndex(Math.floor(position.current + 1e-9));
      if (position.current >= count - 1) {
        setPlaying(false);
      }
    }, TICK_MS);
    return (): void => {
      clearInterval(timer);
    };
    // Restart the timer only when playback settings change, not on every index update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, hoursPerSecond, stepMinutes, count]);

  const shown: number = hoverIndex ?? index;

  async function exportChart(kind: ChartKind): Promise<void> {
    const svg: SVGSVGElement | null | undefined = (kind === "sky" ? skyRef : timelineRef).current?.querySelector("svg");
    if (svg === null || svg === undefined) {
      return;
    }
    const [start, end] = inclusiveDateRange(result.request);
    const terrain: boolean = focused.horizon_model === "terrain";
    const legend: LegendEntry[] = [
      { label: "Sun", color: cssColor("--sun"), kind: "line" },
      { label: "Earth", color: cssColor("--earth"), kind: "line" },
      kind === "sky" && terrain
        ? { label: "Terrain horizon (LOLA)", color: cssColor("--terrain-edge"), kind: "area" }
        : {
            label: terrain ? "Below the terrain horizon" : "Below the flat horizon",
            color: cssColor("--axis"),
            kind: "area",
          },
    ];
    const hasSamples: boolean = result.sites.some((s: SiteResult): boolean => s.site.origin === "sample");
    const credit: string = [
      "CLPS Lunar Mission Browser",
      "Ephemerides: NASA/JPL NAIF SPICE (DE440, DE421 lunar frame)",
      ...(terrain ? ["Terrain: NASA GSFC LOLA"] : []),
      ...(hasSamples ? ["Sample sites are placeholders, not CLPS sites"] : []),
    ].join(" · ");
    const title: string =
      kind === "sky"
        ? `Sky diagram · ${focused.site.name}`
        : `Timeline · height above the horizon at ${focused.site.name}; Sun and DTE bands for all sites`;
    try {
      const blob: Blob = await chartToPng(svg, {
        title,
        subtitle: `${start} to ${end} UTC · ${terrain ? "LOLA terrain horizon" : "flat horizon"} · shown instant ${formatUtc(result.times[shown] ?? "")}`,
        legend,
        credit,
        background: cssColor("--surface"),
        textColor: cssColor("--text-primary"),
        mutedColor: cssColor("--text-muted"),
      });
      const subject: string = kind === "sky" ? `_${slug(focused.site.name)}` : "";
      downloadBlob(`clps-${kind}${subject}_${start}_${end}.png`, blob);
      setExportError(null);
    } catch (caught: unknown) {
      setExportError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function pngButton(kind: ChartKind, label: string): JSX.Element | null {
    if (!expert) {
      return null;
    }
    return (
      <button
        type="button"
        className="small"
        aria-label={`Download ${label} as PNG`}
        onClick={(): void => {
          void exportChart(kind);
        }}
      >
        PNG
      </button>
    );
  }

  const select: (i: number) => void = (i: number): void => {
    setPlaying(false);
    const next: number = clampIndex(i, count);
    position.current = next;
    setIndex(next);
  };

  return (
    <section className="card" aria-labelledby="charts-title">
      <div className="charts-header">
        <h2 id="charts-title">Sky &amp; timeline</h2>
        <div className="site-tabs" role="group" aria-label="Site shown in the charts">
          {result.sites.map(
            (s: SiteResult): JSX.Element => (
              <button
                key={s.site.id}
                type="button"
                aria-pressed={s.site.id === focused.site.id}
                onClick={(): void => {
                  onFocus(s.site.id);
                }}
              >
                {s.site.name}
              </button>
            ),
          )}
        </div>
      </div>
      <div className="legend" aria-label="Legend">
        <span>
          <span className="swatch sun" aria-hidden="true" /> Sun
        </span>
        <span>
          <span className="swatch earth" aria-hidden="true" /> Earth
        </span>
        {focused.horizon_model === "terrain" ? (
          <span>
            <span className="swatch terrain" aria-hidden="true" /> Terrain horizon (LOLA)
          </span>
        ) : (
          <span>
            <span className="swatch below" aria-hidden="true" /> Below the flat horizon
          </span>
        )}
        <span className="muted">Thick segment: last 24 h · click a chart to move the time</span>
      </div>
      <TimeControl
        times={result.times}
        index={index}
        playing={playing}
        hoursPerSecond={hoursPerSecond}
        onIndex={(i: number): void => {
          const next: number = clampIndex(i, count);
          position.current = next;
          setIndex(next);
        }}
        onPlayingChange={setPlaying}
        onSpeed={setHoursPerSecond}
      />
      <HoverReadout times={result.times} focused={focused} index={shown} previewing={hoverIndex !== null} />
      <div ref={chartsRef}>
        <h3 className="chart-title">
          Sky diagram · {focused.site.name} {pngButton("sky", "sky diagram")}
        </h3>
        <HowToReadSky open={!expert} />
        <div ref={skyRef}>
          <SkyChart
          result={focused}
          width={chartWidth}
          index={shown}
          trailSamples={trailSamples(stepMinutes)}
          onHover={setHoverIndex}
          onSelect={select}
          />
        </div>
        <h3 className="chart-title">Timeline {pngButton("timeline", "timeline")}</h3>
        <HowToReadTimeline open={!expert} />
        <div ref={timelineRef}>
          <Timeline
          times={result.times}
          width={chartWidth}
          sites={result.sites}
          focused={focused}
          rangeEnd={result.request.end}
          index={shown}
          onHover={setHoverIndex}
          onSelect={select}
          />
        </div>
      </div>
      <details
        className="view-3d"
        onToggle={(event: SyntheticEvent<HTMLDetailsElement>): void => {
          setShow3d(event.currentTarget.open);
        }}
      >
        <summary>3D view · {focused.site.name}</summary>
        {show3d &&
          (focused.horizon_model === "terrain" ? (
            <Suspense fallback={<p className="muted">Loading 3D view…</p>}>
              <Terrain3D
                key={focused.site.id}
                apiClient={apiClient}
                site={focused}
                onCandidateSelected={onCandidateSelected}
                onSelectionStarted={onSelectionStarted}
                selectedTimeUtc={result.times[shown] ?? ""}
                observerHeightM={result.request.observer_height_m}
                sunAzimuthDeg={focused.sun.azimuth_deg[shown] ?? 0}
                sunElevationDeg={focused.sun.elevation_deg[shown] ?? 0}
                earthAzimuthDeg={focused.earth.azimuth_deg[shown] ?? 0}
                earthElevationDeg={focused.earth.elevation_deg[shown] ?? 0}
                sunVisible={visibleAt(focused.sun_windows, result.times[shown] ?? "")}
                earthVisible={visibleAt(focused.earth_windows, result.times[shown] ?? "")}
              />
            </Suspense>
          ) : (
            <p className="muted">
              The 3D view needs terrain data. This site uses a flat horizon (custom site, or terrain not
              downloaded).
            </p>
          ))}
      </details>
      {exportError !== null && (
        <p className="form-errors" role="alert">
          {exportError}
        </p>
      )}
      {expert && <WindowsTable result={focused} />}
    </section>
  );
}
