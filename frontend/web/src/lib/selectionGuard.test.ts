import { describe, expect, it } from "vitest";
import { SelectionGuard } from "./selectionGuard.ts";

describe("selection request ordering", () => {
  it("rejects an older response after a newer click or scenario change", () => {
    const guard: SelectionGuard = new SelectionGuard();
    const first: number = guard.next();
    const second: number = guard.next();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(second)).toBe(false);
  });
});
