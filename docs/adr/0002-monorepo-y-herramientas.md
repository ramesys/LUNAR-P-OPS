# ADR 0002: Monorepo, stack y herramientas

- Estado: aceptada
- Fecha: 2026-09-18

## Contexto

El usuario decidió usar un monorepo que corra todo localmente en Docker, sin hosting por ahora (brief §7.1). Quedaban abiertos el sistema operativo, el nombre, los gestores de paquetes, la licencia y el framework del backend (brief §10).

## Decisión

- **Entorno:** Windows 11 con Docker Desktop y backend WSL2.
- **Nombre del repositorio:** `clps-lunar-mission-browser`. **Licencia:** MIT.
- **Backend:** Python 3.12 con FastAPI. Se consideraron **Express + TypeScript** y **Spring Boot**. Se eligió FastAPI por la madurez de `spiceypy` para el cálculo con SPICE:
  - En Node, la única vía es CSPICE compilado a WebAssembly (timecraftjs), menos probada; la alternativa en JS puro (astronomy-engine) no maneja el marco MOON_ME y obligaría a escribir las transformaciones a mano, que es el riesgo que advierte el brief (§5, §9).
  - En Java, JNISpice es oficial pero no está en Maven y requiere librerías nativas.
- **Python:** workspace de `uv` (`backend/lunar-core`, `backend/api`), con `ruff` (lint y formato), `mypy --strict` y `pytest`.
- **JS/TS:** workspaces de `pnpm` (`frontend/web`, `frontend/api-client`), con React + Vite y TypeScript 5.9. TypeScript 7 queda descartado por ahora porque `typescript-eslint` y `openapi-typescript` todavía no lo soportan.
  - Tipado estricto sin `any`: `strict`, `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes` en `tsconfig.base.json`.
  - ESLint con `strictTypeChecked`, `no-explicit-any`, `explicit-function-return-type`, `explicit-module-boundary-types` y `typedef` en las declaraciones de variables.
  - Tests con `vitest`.
- **Contrato web ↔ api:** la API exporta OpenAPI (`frontend/api-client/openapi.json`), `openapi-typescript` genera los tipos y `openapi-fetch` actúa como cliente. Los archivos generados se versionan, y `make check-openapi` detecta si quedaron desincronizados.
- **Docker:** `docker compose up` levanta `api` (puerto 8000) y `web` (servidor de desarrollo de Vite, puerto 5180 en el host), ambos con healthcheck. `docker compose up --watch` ofrece recarga en caliente sin depender de bind mounts. El puerto 5173 queda libre porque el host lo usa para otros proyectos Vite.
- **Makefile:** envoltorios finos sobre `docker compose run`, sin necesidad de Python ni Node en el host.

## Consecuencias

- Hay dos lenguajes, pero los tipos se comparten mediante OpenAPI, así que la web no duplica contratos a mano.
- `make` no viene con Windows: se ejecuta desde WSL o desde Git Bash con `make` instalado (ver README).
- `backend/pipelines/` se crea en el Paso 2, cuando exista algo que descargar.
