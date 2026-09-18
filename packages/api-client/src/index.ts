import createClient, { type Client, type ClientOptions } from "openapi-fetch";
import type { components, paths } from "./schema.d.ts";

export type HealthResponse = components["schemas"]["HealthResponse"];

export type ApiClient = Client<paths>;

export function createApiClient(options: ClientOptions): ApiClient {
  return createClient<paths>(options);
}
