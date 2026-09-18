import type { ApiClient } from "@clps/api-client";
import type { JSX } from "react";
import { HealthStatus } from "./HealthStatus.tsx";

interface AppProps {
  apiClient: ApiClient;
}

export function App({ apiClient }: AppProps): JSX.Element {
  return (
    <main>
      <h1>CLPS Lunar Mission Browser</h1>
      <HealthStatus apiClient={apiClient} />
    </main>
  );
}
