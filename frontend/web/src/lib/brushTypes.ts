import type { LocalPoint } from "./roiFrame.ts";

export type BrushMode = "off" | "draw" | "edit";
export type BrushVerdict = "PASS" | "FAIL" | "UNAVAILABLE" | "ERROR" | "NOT_EVALUATED";
export interface BrushOverlay {
  mode: BrushMode;
  vertices: LocalPoint[];
  closed: boolean;
  samples: (LocalPoint & { verdict: BrushVerdict; index: number })[];
  onAdd: (point: LocalPoint) => void;
  onMove: (index: number, point: LocalPoint) => void;
  onSelect: (index: number) => void;
}
