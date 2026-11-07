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
export type PoleMap = Schemas["PoleMapOut"];
export type Parallel = Schemas["ParallelOut"];
export type Meridian = Schemas["MeridianOut"];
export type HorizonModel = AnalysisRequest["horizon"];
export type Assumption = Schemas["AssumptionOut"];
export type DataSource = Schemas["DataSourceOut"];

export type ApiClient = Client<paths>;

export function createApiClient(options: ClientOptions): ApiClient {
  return createClient<paths>(options);
}
export type Candidate = Schemas["CandidateOut"];
export type ScientificEvaluation = Schemas["EvaluationOut"];
export type CandidateRef = Schemas["CandidateRefOut"];
export type Roi = Schemas["RoiOut"];
export type RoiTerrain = Schemas["RoiTerrainOut"];
export type ExperimentManifest = Schemas["ExperimentManifestOut"];
export type RecomputeReport = Schemas["RecomputeReportOut"];

export type RegionalTerrain = Schemas["RegionalTerrainOut"];
export type BrushDefinition = Schemas["BrushDefinition"];
export type BrushPreview = Schemas["BrushPreviewOut"];
export type BrushExecution = Schemas["BrushExecutionOut"];
export type BrushResult = Schemas["BrushResultOut"];
export type BrushSample = Schemas["BrushSampleOut"];
