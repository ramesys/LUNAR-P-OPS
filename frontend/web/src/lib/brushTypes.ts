import type { LocalPoint } from "./roiFrame.ts";

export type BrushMode = "off" | "draw" | "edit";
export type BrushVerdict = "PASS" | "FAIL" | "UNAVAILABLE" | "ERROR" | "NOT_EVALUATED";

/** One drawn region as the 3D view shows it; plan coordinates are ROI-local projected metres. */
export interface RegionOverlay {
  id: string;
  label: string;
  vertices: LocalPoint[];
  closed: boolean;
  active: boolean;
  samples: (LocalPoint & { verdict: BrushVerdict; index: number; selected: boolean })[];
}

export interface BrushOverlay {
  /** Drawing mode of the active region; "off" leaves terrain clicks to candidate selection. */
  mode: BrushMode;
  regions: RegionOverlay[];
  /** A region evaluation is running: terrain clicks must not create candidates meanwhile. */
  busy: boolean;
  onAdd: (point: LocalPoint) => void;
  onMove: (index: number, point: LocalPoint) => void;
  onSelectSample: (regionId: string, index: number) => void;
}
