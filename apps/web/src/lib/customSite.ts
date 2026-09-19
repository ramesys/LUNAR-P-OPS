/** Client-side checks for custom coordinates (RF-17); the API is the source of truth. */
export const CUSTOM_MAX_LATITUDE_DEG: number = -60;

export function validateCustomCoordinates(latitude: number, longitude: number): string | null {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > CUSTOM_MAX_LATITUDE_DEG) {
    return `Latitude must be between -90° and ${CUSTOM_MAX_LATITUDE_DEG.toString()}° (south polar region).`;
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 360) {
    return "Longitude must be between -180° and 360° (east positive).";
  }
  return null;
}

/** Site ids listed in a shared URL, in order (before any validation). */
export function siteIdsInSearch(search: string): string[] {
  const raw: string | null = new URLSearchParams(search).get("sites");
  return raw === null ? [] : raw.split(",").filter((id: string): boolean => id !== "");
}
