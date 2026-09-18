export interface SkyPoint {
  azimuthDeg: number;
  elevationDeg: number;
}

/**
 * Split a sky track wherever azimuth jumps across north (e.g. 359° → 1°), so a polyline on an
 * azimuth axis from 0 to 360 does not draw a line across the whole chart.
 */
export function splitAtAzimuthWrap(
  azimuthDeg: readonly number[],
  elevationDeg: readonly number[],
): SkyPoint[][] {
  const segments: SkyPoint[][] = [];
  let current: SkyPoint[] = [];
  let previousAzimuth: number | null = null;
  azimuthDeg.forEach((azimuth: number, index: number): void => {
    const elevation: number | undefined = elevationDeg[index];
    if (elevation === undefined) {
      return;
    }
    if (previousAzimuth !== null && Math.abs(azimuth - previousAzimuth) > 180) {
      segments.push(current);
      current = [];
    }
    current.push({ azimuthDeg: azimuth, elevationDeg: elevation });
    previousAzimuth = azimuth;
  });
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}
