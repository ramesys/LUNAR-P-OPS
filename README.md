# CLPS Lunar Mission Browser

Herramienta para comparar sitios de aterrizaje y fechas en el polo sur lunar a partir de la posición del Sol y la Tierra sobre el horizonte, con foco en el potencial de energía solar y las ventanas de comunicación directa con la Tierra (DTE). Proyecto para el **NASA Space Apps Challenge 2026** (desafío #2).

> Estado: **Paso 1, andamiaje**. La web muestra el estado de la API; todavía no hay cálculo lunar. El contexto completo está en [docs/brief.md](docs/brief.md) y las decisiones en [docs/adr/](docs/adr/).

## Requisitos

- Docker Desktop (en Windows, con backend WSL2).
- Opcional: `make`, desde WSL o desde Git Bash (`winget install ezwinports.make`). Cada objetivo equivale a un comando `docker compose` (ver la tabla).
- Opcional, para trabajar fuera de Docker: `uv` y Node 22+ con `pnpm`.

## Cómo correrlo

```sh
docker compose up --build
```

| Servicio | URL |
|---|---|
| Web | http://localhost:5180 |
| API | http://localhost:8000/api/health |
| Docs de la API (Swagger) | http://localhost:8000/docs |

Para la recarga en caliente (sincroniza el código al editar), usa `docker compose up --build --watch` o `make dev`.

## Comandos

| `make` | Qué hace |
|---|---|
| `make up` / `make down` | Levanta en segundo plano (espera a que esté *healthy*) / detiene |
| `make dev` | Levanta con `--watch` |
| `make test` | `pytest` (Python) + `vitest` (web), dentro de contenedores |
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
packages/api-client/  Tipos TS generados desde OpenAPI + cliente tipado
data/                 Kernels, DEM y cachés (no versionado)
docs/                 Brief y ADRs
```

## Convenciones

- Documentación en español; código, identificadores, commits e interfaz en inglés.
- TypeScript estricto sin `any` (ESLint lo impide) y Python con `mypy --strict`.
- Si cambias la API, ejecuta `make openapi` y versiona el cliente regenerado.

## Fuentes de datos

Se citarán aquí y en la interfaz a medida que se incorporen (efemérides JPL/NAIF, DEM de LOLA). La lista verificada inicial está en [docs/brief.md §8](docs/brief.md).

## Licencia

[MIT](LICENSE)
