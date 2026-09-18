import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiProxyTarget: string = process.env["API_PROXY_TARGET"] ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": apiProxyTarget,
    },
  },
  test: {
    environment: "jsdom",
  },
});
