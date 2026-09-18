import type { VisibilityWindow } from "@clps/api-client";

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function formatHours(hours: number): string {
  if (hours < 48) {
    return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  }
  return `${(hours / 24).toFixed(1)} d`;
}

export function formatWindowDuration(window: VisibilityWindow | null): string {
  if (window === null) {
    return "none";
  }
  const prefix: string = window.truncated ? "≥ " : "";
  return `${prefix}${formatHours(window.duration_hours)}`;
}

export function formatUtc(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function formatUtcDate(iso: string): string {
  return iso.slice(0, 10);
}

export function formatLatLon(latitudeDeg: number, longitudeDeg: number): string {
  const ns: string = latitudeDeg < 0 ? "S" : "N";
  return `${Math.abs(latitudeDeg).toFixed(2)}°${ns}, ${longitudeDeg.toFixed(2)}°E`;
}

export function formatDegrees(value: number): string {
  return `${value.toFixed(2)}°`;
}
