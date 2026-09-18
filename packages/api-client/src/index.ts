import createClient, { type Client, type ClientOptions } from "openapi-fetch";
import type { components, paths } from "./schema.d.ts";

type Schemas = components["schemas"];

export type HealthResponse = Schemas["HealthResponse"];
export type Site = Schemas["SiteOut"];
export type AnalysisRequest = Schemas["AnalysisRequest"];
export type AnalysisResponse = Schemas["AnalysisResponse"];
export type SiteResult = Schemas["SiteResult"];
export type SiteMetrics = Schemas["MetricsOut"];
export type VisibilityWindow = Schemas["WindowOut"];
export type BodySeries = Schemas["BodySeries"];
export type HorizonMask = Schemas["HorizonMaskOut"];
export type HorizonModel = AnalysisRequest["horizon"];
export type Assumption = Schemas["AssumptionOut"];
export type DataSource = Schemas["DataSourceOut"];

export type ApiClient = Client<paths>;

export function createApiClient(options: ClientOptions): ApiClient {
  return createClient<paths>(options);
}
