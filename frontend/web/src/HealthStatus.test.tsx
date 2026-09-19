import { createApiClient, type ApiClient, type HealthResponse } from "@clps/api-client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HealthStatus } from "./HealthStatus.tsx";

function clientReturning(response: Response): ApiClient {
  return createApiClient({
    baseUrl: "http://api.test",
    fetch: (): Promise<Response> => Promise.resolve(response),
  });
}

afterEach((): void => {
  cleanup();
});

describe("HealthStatus", (): void => {
  it("shows versions when the API is healthy", async (): Promise<void> => {
    const body: HealthResponse = { status: "ok", api_version: "0.1.0", lunar_core_version: "0.2.0" };
    const client: ApiClient = clientReturning(Response.json(body));

    render(<HealthStatus apiClient={client} />);

    expect(await screen.findByText("API: ok (api 0.1.0, lunar_core 0.2.0)")).toBeDefined();
  });

  it("shows an error when the API fails", async (): Promise<void> => {
    const client: ApiClient = clientReturning(new Response("boom", { status: 503 }));

    render(<HealthStatus apiClient={client} />);

    const alert: HTMLElement = await screen.findByRole("alert");
    expect(alert.textContent).toBe("API: unavailable (HTTP 503)");
  });
});
