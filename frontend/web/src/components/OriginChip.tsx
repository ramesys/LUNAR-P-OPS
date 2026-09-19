import type { Site } from "@clps/api-client";
import type { JSX } from "react";

/** Marks non-official sites so placeholders and user coordinates are never mistaken for NASA data. */
export function OriginChip({ origin }: { origin: Site["origin"] }): JSX.Element | null {
  if (origin === "official") {
    return null;
  }
  return <span className={origin === "custom" ? "chip chip-custom" : "chip"}>{origin}</span>;
}
