import type { AnalysisResponse, SiteResult } from "@clps/api-client";
import { useEffect, useRef, useState, type JSX, type RefObject } from "react";
import { clampIndex, DEFAULT_SPEED, samplesPerTick, TICK_MS, trailSamples } from "../lib/playback.ts";
import { useElementWidth } from "../lib/useElementWidth.ts";
import { HoverReadout } from "./HoverReadout.tsx";
import { SkyChart } from "./SkyChart.tsx";
import { TimeControl } from "./TimeControl.tsx";
import { Timeline } from "./Timeline.tsx";
import { WindowsTable } from "./WindowsTable.tsx";

const DEFAULT_CHART_WIDTH: number = 960;
const MIN_CHART_WIDTH: number = 320;

interface ChartsPanelProps {
  result: AnalysisResponse;
  focused: SiteResult;
  onFocus: (siteId: string) => void;
}

/**
 * Sky diagram + timeline sharing one instant (RF-12). Time state lives here, not in App, so
 * playback re-renders only the charts. Mount with a new `key` per result to reset it.
 */
export function ChartsPanel({ result, focused, onFocus }: ChartsPanelProps): JSX.Element {
  const [index, setIndex] = useState<number>(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState<boolean>(false);
  const [hoursPerSecond, setHoursPerSecond] = useState<number>(DEFAULT_SPEED);
  const position: RefObject<number> = useRef<number>(0);
  const chartsRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement | null>(null);
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
        <h3 className="chart-title">Sky diagram · {focused.site.name}</h3>
        <SkyChart
          result={focused}
          width={chartWidth}
          index={shown}
          trailSamples={trailSamples(stepMinutes)}
          onHover={setHoverIndex}
          onSelect={select}
        />
        <h3 className="chart-title">Timeline</h3>
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
      <WindowsTable result={focused} />
    </section>
  );
}
