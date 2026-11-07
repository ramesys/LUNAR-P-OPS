import type { Candidate } from "@clps/api-client";
import type { JSX } from "react";

export function CandidateInspector({ candidate }: { candidate: Candidate }): JSX.Element {
  return <section aria-label="Candidate C0 inspector">
    <h3>Candidate C0</h3>
    <p>Candidate ID: {candidate.candidate_id}</p>
    <p>Geographical site ID: {candidate.site_id}</p>
    <p>Position: {candidate.latitude_deg.toFixed(6)}° latitude, {candidate.longitude_deg.toFixed(6)}° east</p>
    <p>Terrain elevation: {candidate.terrain_elevation_m.toFixed(1)} m above the 1737.4 km reference sphere</p>
    <p>Observer height: {candidate.observer_height_m} m</p>
    <p>Selected time: {candidate.selected_time_utc} UTC</p>
    <p>Source DEM: <a href={candidate.terrain_source_url}>{candidate.terrain_dataset_id}</a> · {candidate.dem_resolution_m} m/pixel</p>
    <p>Local DEM window SHA-256: {candidate.terrain_dataset_sha256}</p>
    <p>Source nodata: {candidate.terrain_nodata}; coverage: {candidate.coverage_bounds_m.join(", ")} m (south polar stereographic bounds)</p>
    <p>Coordinate reference: {candidate.coordinate_reference}</p>
    <p>Data availability: {candidate.data_availability}</p>
    <p>Validation: not independently validated</p>
  </section>;
}
