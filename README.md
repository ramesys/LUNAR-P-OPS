# CLPS Lunar Mission Browser

Herramienta para comparar sitios de aterrizaje y fechas en el polo sur lunar a partir de la posición del Sol y la Tierra sobre el horizonte, con foco en el potencial de energía solar y las ventanas de comunicación directa con la Tierra (DTE). Proyecto para el **NASA Space Apps Challenge 2026** (desafío #2).

> Estado: **Capas 1 y 2 completas**. En http://localhost:5180 se eligen de 2 a 4 sitios de ejemplo (con checkboxes o en un mapa del polo sobre el relieve LOLA) y un rango de hasta un año, y se obtienen:
>
> - una tabla comparativa con ranking;
> - un diagrama de cielo con la silueta del terreno;
> - una línea de tiempo con bandas de luz y comunicación directa;
> - un control de tiempo animado que sincroniza ambos gráficos;
> - el panel de supuestos y fuentes, y un glosario.
>
> También se puede elegir entre horizonte con terreno o plano, fijar la elevación mínima de la Tierra, agregar un sitio propio por coordenadas (con horizonte plano) y compartir la URL. Las posiciones del Sol y la Tierra están validadas contra JPL Horizons (error máximo de 0,05″) y el horizonte, contra el mapa de sombras permanentes de la NASA. Ver el [roadmap](docs/roadmap.md), el [brief](docs/brief.md), el [modelo de dominio](docs/domain.md) y los [ADR](docs/adr/).

## Requisitos

- Docker Desktop (en Windows, con backend WSL2).
- Opcional: `make`, desde WSL o desde Git Bash (`winget install ezwinports.make`). Cada objetivo equivale a un comando `docker compose` (ver la tabla).
- Opcional, para trabajar fuera de Docker: `uv` y Node 22+ con `pnpm`.

## Cómo correrlo

```sh
docker compose up --build
```

La primera vez, el servicio `data` descarga a `data/`, antes de levantar la API:

- los kernels SPICE de NAIF (~35 MB);
- las ventanas de terreno LOLA de cada sitio (~1 minuto);
- el relieve del mapa del polo (~20 s).

Si el terreno o el relieve no se pueden descargar, la app funciona igual (con horizonte plano o con el mapa sin relieve) y lo indica.

| Servicio | URL |
|---|---|
| Web | http://localhost:5180 |
| API | http://localhost:8000/api/health, `GET /api/sites`, `POST /api/analysis` |
| Docs de la API (Swagger) | http://localhost:8000/docs |

Para la recarga en caliente (sincroniza el código al editar), usa `docker compose up --build --watch` o `make dev`.

## Comandos

| `make` | Qué hace |
|---|---|
| `make up` / `make down` | Levanta en segundo plano (espera a que esté *healthy*) / detiene |
| `make dev` | Levanta con `--watch` |
| `make fetch-data` | Descarga los kernels SPICE que falten (idempotente) |
| `make fetch-terrain` | Descarga las ventanas de terreno LOLA de los sitios del catálogo (~5-12 s por sitio) |
| `make fetch-basemap` | Descarga el relieve LOLA del mapa del polo (1024×1024, ~20 s) |
| `make spike-terrain` | Repite la validación del Spike B (mapa PSR de la NASA + comparación entre horizonte plano y con terreno) |
| `make golden` | Regenera los datos de referencia de JPL Horizons para el test dorado (requiere red) |
| `make test` | `pytest` (Python, incluye el test dorado) + `vitest` (web), dentro de contenedores |
| `make e2e` | Tests end-to-end con Playwright y el Microsoft Edge del sistema, contra el stack levantado (`make up` antes; requiere Node y pnpm en el host) |
| `make lint` | `ruff` + `mypy --strict` / `eslint` + `tsc` |
| `make fmt` | Formatea Python con `ruff` |
| `make openapi` | Regenera `packages/api-client` desde la API |
| `make check-openapi` | Falla si el cliente TS no está sincronizado con la API |

Sin `make`, por ejemplo: `docker compose run --rm --no-deps api pytest`.

## Estructura

```
apps/web/             React + TypeScript (Vite): interfaz
services/api/         FastAPI: expone el cálculo y su contrato OpenAPI
libs/lunar_core/      Python puro: geometría y métricas lunares (sin web)
pipelines/            Tareas puntuales: descarga de kernels, datos de referencia de Horizons
packages/api-client/  Tipos TS generados desde OpenAPI + cliente tipado
data/                 Kernels, DEM y cachés (no versionado)
docs/                 Brief, roadmap, dominio y ADRs
```

## Convenciones

- Documentación en español; código, identificadores, commits e interfaz en inglés.
- TypeScript estricto sin `any` (ESLint lo impide) y Python con `mypy --strict`.
- Si cambias la API, ejecuta `make openapi` y versiona el cliente regenerado.

## Fuentes de datos

- **Kernels SPICE (NASA/JPL NAIF):** `naif0012.tls`, `pck00011.tpc`, `moon_pa_de421_1900-2050.bpc`, `moon_080317.tf`, `de440s.bsp`, desde https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ (detalle en el [ADR 0005](docs/adr/0005-spike-a-geometria-y-donde-se-calcula.md)).
- **Referencia de validación:** JPL Horizons API, https://ssd.jpl.nasa.gov/api/horizons.api.
- **Terreno:** DEM de LOLA del polo sur (`LDEM_80S_20MPP_ADJ`, `LDEM_60S_240MPP_ADJ`) relieve sombreado del mapa (`LDEM_80S_80MPP_ADJ_HILL`) y mapa de sombra permanente (`LPSR_80S_20MPP_ADJ`), de NASA GSFC PGDA, https://pgda.gsfc.nasa.gov/products/90 (Barker et al. 2023, doi:10.3847/PSJ/acf3e1). Ver el [ADR 0009](docs/adr/0009-spike-b-horizonte-con-terreno.md). La lista completa está en [docs/brief.md §8](docs/brief.md).

## Licencia

[MIT](LICENSE)
