import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { terrainScreen } from "../lib/testFixtures.ts";
import { TerrainScreenCard } from "./TerrainScreenCard.tsx";

afterEach(cleanup);

it("shows backend slope, roughness and coverage metrics with each configured constraint", (): void => {
  render(<TerrainScreenCard screen={terrainScreen()} />);
  const card: HTMLElement = screen.getByRole("region", { name: "Terrain screen" });
  expect(card.dataset["verdict"]).toBe("FAIL");
  expect(within(card).getByText("14.2 °")).toBeTruthy();
  expect(within(card).getByText("0.91 m")).toBeTruthy();
  expect(within(card).getByText("81/81 nodes")).toBeTruthy();
  const checks: HTMLElement = within(card).getByRole("list", { name: "Terrain constraints" });
  expect(within(checks).getByText(/Local slope: 14.20° ≤ 12°/)).toBeTruthy();
  expect(within(checks).getAllByText("FAIL")).toHaveLength(1);
  expect(within(card).getByText(/NOT ASSESSED · DEM vertical uncertainty/)).toBeTruthy();
  expect(within(card).getByText(/LDEM_80S_20MPP_ADJ/)).toBeTruthy();
  expect(within(card).getByText(/not certified landing safety/)).toBeTruthy();
});

it("never presents missing terrain data as passing", (): void => {
  render(<TerrainScreenCard screen={terrainScreen({ status: "UNAVAILABLE", verdict: "NOT_ASSESSED", slope: null, roughness: null, quality: null,
    checks: [], provenance: null, errors: ["LOLA near-field terrain is unavailable"] })} />);
  const card: HTMLElement = screen.getByRole("region", { name: "Terrain screen" });
  expect(within(card).getByText("NOT ASSESSED")).toBeTruthy();
  expect(within(card).getByText(/Terrain metrics unavailable: LOLA near-field terrain is unavailable/)).toBeTruthy();
  expect(within(card).queryByText("PASS")).toBeNull();
});
