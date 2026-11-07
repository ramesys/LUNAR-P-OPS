import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CandidateInspector } from './CandidateInspector.tsx';

describe('Candidate inspector', () => {
  it('displays the API scientific values and validation status', () => {
    render(<CandidateInspector candidate={{ terrain_dataset_sha256: "hash", terrain_nodata: "NaN", coverage_bounds_m: [0, 0, 1, 1], candidate_id: 'candidate-test', site_id: 'site-test',
      latitude_deg: -89.5, longitude_deg: 12, terrain_elevation_m: 123.4, observer_height_m: 2,
      selected_time_utc: '2026-02-01T00:00:00Z', terrain_dataset_id: 'LDEM_80S_20MPP_ADJ',
      terrain_source_url: 'https://example.org/dem', dem_resolution_m: 20,
      coordinate_reference: 'MOON_ME', validation_status: 'not_independently_validated',
      data_availability: 'available' }} />);
    expect(screen.getByText(/123.4 m/)).toBeDefined();
    expect(screen.getByText(/MOON_ME/)).toBeDefined();
    expect(screen.getByText(/not independently validated/i)).toBeDefined();
    expect(screen.getByText(/LDEM_80S_20MPP_ADJ/)).toBeDefined();
  });
});
