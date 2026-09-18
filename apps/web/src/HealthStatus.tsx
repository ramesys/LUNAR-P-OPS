import type { ApiClient, HealthResponse } from "@clps/api-client";
import { useEffect, useState, type JSX } from "react";

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

interface HealthStatusProps {
  apiClient: ApiClient;
}

export function HealthStatus({ apiClient }: HealthStatusProps): JSX.Element {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect((): (() => void) => {
    const controller: AbortController = new AbortController();
    apiClient
      .GET("/api/health", { signal: controller.signal })
      .then(({ data, response }): void => {
        if (data === undefined) {
          setState({ kind: "error", message: `HTTP ${response.status.toString()}` });
          return;
        }
        setState({ kind: "ok", health: data });
      })
      .catch((error: unknown): void => {
        if (controller.signal.aborted) {
          return;
        }
        const message: string = error instanceof Error ? error.message : String(error);
        setState({ kind: "error", message });
      });
    return (): void => {
      controller.abort();
    };
  }, [apiClient]);

  switch (state.kind) {
    case "loading":
      return <p>API: checking…</p>;
    case "ok":
      return (
        <p>
          API: {state.health.status} (api {state.health.api_version}, lunar_core{" "}
          {state.health.lunar_core_version})
        </p>
      );
    case "error":
      return <p role="alert">API: unavailable ({state.message})</p>;
  }
}
