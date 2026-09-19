# Architecture Decision Records

Each significant decision is recorded as a short ADR (context → decision → consequences). The
records are written in **Spanish**, the team's working language; the main [README](../../README.md)
summarizes them in English. Some records cite "the brief" (§ sections): that was the internal
project brief used during development, which is not part of this repository — each ADR restates
the context it needs.

| # | Decision |
|---|---|
| [0001](0001-registro-de-decisiones.md) | Record decisions as ADRs |
| [0002](0002-monorepo-y-herramientas.md) | Monorepo, stack and tooling (FastAPI over Express/Spring, uv, pnpm, strict typing) |
| [0003](0003-supuestos-de-producto.md) | Product assumptions (English UI, ≤ 1 year, 2–4 sites) |
| [0004](0004-gpu-fuera-de-alcance.md) | GPU out of scope; CPU only |
| [0005](0005-spike-a-geometria-y-donde-se-calcula.md) | Spike A: SPICE geometry validated against JPL Horizons (0.05″); compute on demand |
| [0006](0006-reglas-de-visibilidad-y-metricas.md) | Visibility rules (Sun upper limb, Earth center), windows, ranking |
| [0007](0007-contrato-api-de-analisis.md) | Analysis API contract (columnar series, validation, caching, gzip) |
| [0008](0008-interfaz-del-mvp.md) | MVP interface (hand-rolled SVG charts, CVD-safe palette, accessibility) |
| [0009](0009-spike-b-horizonte-con-terreno.md) | Spike B: LOLA terrain horizons, 100 % agreement with NASA's PSR map |
| [0010](0010-horizonte-con-terreno-en-la-app.md) | Terrain horizons in the app, DTE clearance, shareable URL |
| [0011](0011-control-de-tiempo-animado.md) | Animated time control synchronized across charts |
| [0012](0012-mapa-2d-del-polo.md) | 2D south pole map on the LOLA hillshade |
| [0013](0013-endurecimiento-y-pruebas-e2e.md) | Hardening: responsive charts, Playwright e2e, clean-clone test |
| [0014](0014-sitio-por-coordenadas.md) | Custom sites by coordinates (flat horizon) |
| [0015](0015-exportar-csv.md) | CSV and PNG export |
| [0016](0016-modo-simple-experto.md) | Simple and Expert modes, plain-language results |
| [0017](0017-vista-3d.md) | 3D terrain view lit by the Sun |
| [0018](0018-estructura-del-repositorio-y-despliegue.md) | Repository layout and production deployment |
