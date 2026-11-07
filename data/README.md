# data/

Downloaded scientific inputs and the local candidate database. **Nothing here is versioned**
except this file. The directory is mounted into the API container as `/data` (`CLPS_DATA_DIR`).

| Path | Contents | How to obtain |
| --- | --- | --- |
| `kernels/` | NAIF SPICE kernels (`naif0012.tls`, `pck00011.tpc`, `moon_pa_de421_1900-2050.bpc`, `moon_080317.tf`, `de440s.bsp`) | `make fetch-data` (also run by the `data` service) |
| `terrain/<site>_{near,far}.npz` | LOLA windows: near = `LDEM_80S_20MPP_ADJ` (20 m), far = `LDEM_60S_240MPP_ADJ` (240 m) | catalog sites: `make fetch-terrain`; Shackleton Rim B: `docker compose run --rm --no-deps api python -m clps_pipelines.fetch_roi` |
| `basemap/` | LOLA hillshade for the pole map | `make fetch-basemap` |
| `candidates.sqlite3` | Candidates and evaluations (created on first write) | created by the API |

Back up `candidates.sqlite3` before changing persistence code, and keep SHA-256 hashes of the
terrain windows: candidate identity depends on the near-field window hash. See
[docs/STATUS.md](../docs/STATUS.md#4-data-backup-and-recovery).
