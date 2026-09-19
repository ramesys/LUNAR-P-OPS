import type { ChangeEvent, JSX } from "react";
import { formatUtc } from "../lib/format.ts";
import { SPEED_OPTIONS } from "../lib/playback.ts";

interface TimeControlProps {
  times: readonly string[];
  index: number;
  playing: boolean;
  hoursPerSecond: number;
  onIndex: (index: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onSpeed: (hoursPerSecond: number) => void;
}

export function TimeControl({
  times,
  index,
  playing,
  hoursPerSecond,
  onIndex,
  onPlayingChange,
  onSpeed,
}: TimeControlProps): JSX.Element {
  const last: number = times.length - 1;
  const current: string = times[index] ?? times[0] ?? "";

  return (
    <div className="time-control" role="group" aria-label="Time control">
      <button
        type="button"
        aria-label="Go to start"
        onClick={(): void => {
          onPlayingChange(false);
          onIndex(0);
        }}
      >
        ⏮
      </button>
      <button
        type="button"
        aria-label="Step back"
        onClick={(): void => {
          onIndex(Math.max(0, index - 1));
        }}
      >
        ◀
      </button>
      <button
        type="button"
        className="play"
        aria-label={playing ? "Pause" : "Play"}
        onClick={(): void => {
          if (!playing && index >= last) {
            onIndex(0);
          }
          onPlayingChange(!playing);
        }}
      >
        {playing ? "❚❚ Pause" : "▶ Play"}
      </button>
      <button
        type="button"
        aria-label="Step forward"
        onClick={(): void => {
          onIndex(Math.min(last, index + 1));
        }}
      >
        ▶
      </button>
      <input
        type="range"
        className="time-slider"
        min={0}
        max={Math.max(0, last)}
        step={1}
        value={index}
        aria-label="Time"
        aria-valuetext={formatUtc(current)}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => {
          onPlayingChange(false);
          onIndex(Number(event.target.value));
        }}
      />
      <output className="time-label" aria-live="off">
        {formatUtc(current)}
      </output>
      <label className="speed">
        Speed
        <select
          value={hoursPerSecond}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
            onSpeed(Number(event.target.value));
          }}
        >
          {SPEED_OPTIONS.map(
            (option: { hoursPerSecond: number; label: string }): JSX.Element => (
              <option key={option.hoursPerSecond} value={option.hoursPerSecond}>
                {option.label}
              </option>
            ),
          )}
        </select>
      </label>
    </div>
  );
}
