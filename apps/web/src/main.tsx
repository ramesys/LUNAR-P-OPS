import { createApiClient, type ApiClient } from "@clps/api-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const rootElement: HTMLElement | null = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root not found");
}

const apiClient: ApiClient = createApiClient({ baseUrl: window.location.origin });

createRoot(rootElement).render(
  <StrictMode>
    <App apiClient={apiClient} />
  </StrictMode>,
);
