import type { PoleMap as PoleMapData, Site } from "@clps/api-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PoleMap } from "./PoleMap.tsx";

function site(id: string, name: string, x: number, y: number): Site {
  return {
    id,
    name,
    latitude_deg: -89,
    longitude_deg: 0,
    origin: "sample",
    note: "",
    terrain_available: true,
    map_x_m: x,
    map_y_m: y,
  };
}

const SITES: Site[] = [
  site("a", "Site A", 0, 15_000),
  site("b", "Site B", 20_000, -10_000),
  site("c", "Site C", -50_000, 0),
];

const MAP: PoleMapData = {
  half_width_m: 100_000,
  image_url: "/api/map/hillshade.png",
  parallels: [{ latitude_deg: -89, radius_m: 30_323 }],
  meridians: [{ longitude_deg: 0, x_m: 0, y_m: 100_000 }],
  source_name: "LOLA hillshade",
  source_url: "https://pgda.gsfc.nasa.gov/products/90",
};

afterEach((): void => {
  cleanup();
});

describe("PoleMap (RF-15)", (): void => {
  it("shows every site, marks selection and ranks, and toggles by click or keyboard", (): void => {
    const toggled: string[] = [];
    render(
      <PoleMap
        map={MAP}
        sites={SITES}
        selectedIds={["a", "b"]}
        ranks={new Map<string, number>([["b", 1]])}
        maxSelected={4}
        onToggle={(id: string): void => {
          toggled.push(id);
        }}
      />,
    );

    const b: HTMLElement = screen.getByRole("button", { name: /Site B.*rank 1/ });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("#1 Site B")).toBeDefined();
    expect(screen.getByRole("button", { name: /Site C/ }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /Site C/ }));
    fireEvent.keyDown(screen.getByRole("button", { name: /Site A/ }), { key: "Enter" });
    expect(toggled).toEqual(["c", "a"]);
    expect(screen.getByRole("link", { name: "LOLA hillshade" })).toBeDefined();
    expect(screen.getByText("89°S")).toBeDefined();
  });

  it("blocks adding sites past the limit and works without a relief image", (): void => {
    const toggled: string[] = [];
    render(
      <PoleMap
        map={{ ...MAP, image_url: null }}
        sites={SITES}
        selectedIds={["a", "b"]}
        ranks={new Map<string, number>()}
        maxSelected={2}
        onToggle={(id: string): void => {
          toggled.push(id);
        }}
      />,
    );

    const c: HTMLElement = screen.getByRole("button", { name: /Site C.*limit reached/ });
    expect(c.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(c);
    fireEvent.click(screen.getByRole("button", { name: /Site A/ }));
    expect(toggled).toEqual(["a"]);
    expect(screen.getByText(/Relief image not downloaded yet/)).toBeDefined();
  });
});
