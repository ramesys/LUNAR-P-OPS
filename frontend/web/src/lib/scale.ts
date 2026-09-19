export type Scale = (value: number) => number;

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span: number = d1 - d0;
  return (value: number): number => (span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0));
}

/** Evenly spaced "nice" ticks (1, 2, 5 × 10^n) covering [min, max]. */
export function niceTicks(min: number, max: number, targetCount: number): number[] {
  if (max <= min) {
    return [min];
  }
  const rawStep: number = (max - min) / Math.max(1, targetCount);
  const magnitude: number = 10 ** Math.floor(Math.log10(rawStep));
  const normalized: number = rawStep / magnitude;
  const niceNormalized: number = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step: number = niceNormalized * magnitude;
  const ticks: number[] = [];
  for (let tick: number = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step) {
    ticks.push(Math.round(tick / step) * step);
  }
  return ticks;
}

/** Elevation domain padded to whole degrees, always showing the horizon with some margin. */
export function elevationDomain(values: readonly number[]): [number, number] {
  let min: number = -2;
  let max: number = 2;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return [Math.floor(min - 1), Math.ceil(max + 1)];
}
