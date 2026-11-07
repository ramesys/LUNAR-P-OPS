import { readFile } from "node:fs/promises";
import { expect, test, type APIResponse, type Download, type Response as PageResponse, type Locator } from "@playwright/test";

interface BatchItem { verdict: string; persisted: boolean; candidate: { candidate_id: string } | null; evaluation: { evaluation_id: string; status: string } | null }
interface BatchResponse { results: BatchItem[] }

/** Uses the isolated stack and its temporary database, with the real LOLA and SPICE engine. */
test("draws, previews, evaluates and inspects a brush candidate", async ({ page, request }): Promise<void> => {
  const existing: { candidate_id: string }[] = await (await request.get("/api/rois/shackleton-rim-b/candidates")).json() as { candidate_id: string }[];
  await page.goto("/?sites=sample-a,sample-b&from=2026-01-01&to=2026-01-02&step=120&height=2&horizon=terrain&dte=0&mode=expert");
  await expect(page.getByRole("button", { name: "Regional explore · 20 km" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Scientific detail · 4 km" }).click();
  await page.getByRole("button", { name: "Top view" }).click();
  await page.getByRole("button", { name: "Draw region" }).click();
  const canvas: Locator = page.locator(".terrain-canvas canvas");
  const box: { width: number; height: number } | null = await canvas.boundingBox();
  if (box === null) throw new Error("Terrain canvas unavailable");
  for (const [x, y] of [[0.38, 0.38], [0.62, 0.38], [0.62, 0.62], [0.38, 0.62]] as const) {
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
  }
  await expect(page.getByText(/4 vertices ·/)).toBeVisible();
  const afterDraw: { candidate_id: string }[] = await (await request.get("/api/rois/shackleton-rim-b/candidates")).json() as { candidate_id: string }[];
  expect(afterDraw).toEqual(existing);
  await page.getByRole("button", { name: "Finish region" }).click();
  await page.getByRole("button", { name: "Edit vertices" }).click();
  const firstVertex: Locator = page.getByRole("button", { name: /^Remove vertex 1/ });
  const beforeDrag: string = await firstVertex.innerText();
  await canvas.scrollIntoViewIfNeeded();
  const dragBox: { x: number; y: number; width: number; height: number } | null = await canvas.boundingBox();
  if (dragBox === null) throw new Error("Terrain canvas unavailable during editing");
  await page.mouse.move(dragBox.x + dragBox.width * 0.38, dragBox.y + dragBox.height * 0.38);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + dragBox.width * 0.40, dragBox.y + dragBox.height * 0.40, { steps: 4 });
  await page.mouse.up();
  await expect(firstVertex).not.toHaveText(beforeDrag);
  await page.getByRole("button", { name: "Edit vertices" }).click();
  await page.getByLabel("Grid spacing (m)").fill("1000");
  await page.getByLabel("Duration (h)", { exact: true }).fill("2");
  await page.getByLabel("Step (min)", { exact: true }).fill("60");
  await page.getByLabel("Minimum Sun (%)").fill("100");
  const previewResponse: Promise<PageResponse> = page.waitForResponse((r): boolean => r.url().endsWith("/brush/preview") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Preview locations" }).click();
  const preview: { ready_count: number; samples: unknown[] } = await (await previewResponse).json() as { ready_count: number; samples: unknown[] };
  expect(preview.ready_count).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Regional explore · 20 km" }).click();
  await expect(page.getByText(/4 vertices ·/)).toBeVisible();
  await page.getByRole("button", { name: "Scientific detail · 4 km" }).click();
  const afterPreview: { candidate_id: string }[] = await (await request.get("/api/rois/shackleton-rim-b/candidates")).json() as { candidate_id: string }[];
  expect(afterPreview).toEqual(existing);
  const execute: Locator = page.getByRole("button", { name: "Evaluate region & create candidates" });
  await expect(execute).toBeDisabled();
  await page.getByRole("checkbox", { name: /I approve evaluating/ }).check();
  const response: Promise<PageResponse> = page.waitForResponse((r): boolean => r.url().endsWith("/brush/execute") && r.request().method() === "POST", { timeout: 60000 });
  await execute.click();
  const result: BatchResponse = await (await response).json() as BatchResponse;
  const item: BatchItem | undefined = result.results.find((r): boolean => r.persisted && r.evaluation?.status === "COMPUTED_UNVERIFIED");
  expect(item).toBeDefined();
  if (item?.candidate === null || item?.candidate === undefined || item.evaluation === null) throw new Error("No computed candidate");
  const alternateResponse: APIResponse = await request.post(`/api/candidates/${item.candidate.candidate_id}/evaluations`, {
    data: { duration_hours: 3, step_minutes: 60 },
  });
  expect(alternateResponse.ok()).toBe(true);
  const alternate: { evaluation_id: string } = await alternateResponse.json() as { evaluation_id: string };
  await expect(page.getByRole("heading", { name: "Experiment results" })).toBeVisible();
  const downloadPromise: Promise<Download> = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export experiment JSON" }).click();
  const downloaded: Download = await downloadPromise;
  const exported: { schema_version: string; preview: { definition: { polygon: unknown[] } }; results: { evaluation: { evaluation_id: string } }[] } = JSON.parse(await readFile(await downloaded.path(), "utf8")) as { schema_version: string; preview: { definition: { polygon: unknown[] } }; results: { evaluation: { evaluation_id: string } }[] };
  expect(exported.schema_version).toBe("lunar-ops-brush/1");
  expect(exported.preview.definition.polygon).toHaveLength(4);
  expect(exported.results[0]?.evaluation.evaluation_id).toBe(item.evaluation.evaluation_id);
  await page.getByRole("list", { name: "Brush results" }).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: /^Candidate evaluation/ })).toContainText(item.evaluation.evaluation_id.slice(0, 22));
  await expect(page.locator(".node-kind-result")).toContainText("cursor 1/2");
  await page.getByLabel("C0 evaluation history").selectOption(alternate.evaluation_id);
  await expect(page.getByRole("button", { name: /^Candidate evaluation/ })).toContainText(alternate.evaluation_id.slice(0, 22));
  await page.getByRole("list", { name: "Brush results" }).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: /^Candidate evaluation/ })).toContainText(item.evaluation.evaluation_id.slice(0, 22));
  await page.getByRole("complementary", { name: "Inspector" }).getByRole("button", { name: "Step forward" }).click();
  await expect(page.locator(".terrain-time")).toContainText("stored sample 2/2");
  await expect(page.locator(".terrain-time")).toContainText("centre clearance");
  await expect(page.locator(".node-kind-result")).toContainText("cursor 2/2");
  await expect(page.getByRole("heading", { name: "Experiment results" })).toBeVisible();
});

test("@phone draws and clears a brush without creating a candidate", async ({ page, request }): Promise<void> => {
  const before: { candidate_id: string }[] = await (await request.get("/api/rois/shackleton-rim-b/candidates")).json() as { candidate_id: string }[];
  await page.goto("/?sites=sample-a,sample-b&from=2026-01-01&to=2026-01-02&step=120&height=2&horizon=terrain&dte=0&mode=expert");
  await expect(page.getByRole("button", { name: "Regional explore · 20 km" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Scientific detail · 4 km" }).click();
  await page.getByRole("button", { name: "Top view" }).click();
  await page.getByRole("button", { name: "Draw region" }).click();
  const canvas: Locator = page.locator(".terrain-canvas canvas");
  const box: { width: number; height: number } | null = await canvas.boundingBox();
  if (box === null) throw new Error("Terrain canvas unavailable");
  for (const [x, y] of [[0.38, 0.38], [0.62, 0.38], [0.5, 0.6]] as const) {
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
  }
  await expect(page.getByText(/3 vertices ·/)).toBeVisible();
  await page.getByRole("button", { name: "Clear region" }).click();
  await expect(page.getByText(/0 vertices ·/)).toBeVisible();
  const after: { candidate_id: string }[] = await (await request.get("/api/rois/shackleton-rim-b/candidates")).json() as { candidate_id: string }[];
  expect(after).toEqual(before);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
