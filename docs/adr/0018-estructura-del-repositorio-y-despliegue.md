# ADR 0018: Estructura del repositorio y despliegue de producción

- Estado: aceptada. Reemplaza la estructura de carpetas del ADR 0002.
- Fecha: 2026-09-18

## Contexto

Antes de publicar el repositorio, el objetivo era que se notara a simple vista qué es infraestructura, frontend, backend y documentación. Además, el contenedor web usaba el servidor de desarrollo de Vite y la API corría con `--reload` y las dependencias de desarrollo, lo que no sirve para desplegar.

## Decisión

- **Cuatro áreas en la raíz**, cada una con sus propias herramientas:
  - `backend/`: workspace de `uv` (`pyproject.toml`, `uv.lock`), con `lunar-core/` (librería de cálculo), `api/` (FastAPI) y `pipelines/` (tareas de datos).
  - `frontend/`: workspace de `pnpm` (`package.json`, `pnpm-lock.yaml`, `tsconfig.base.json`), con `web/` (React) y `api-client/` (tipos OpenAPI).
  - `infrastructure/`: `docker-compose.yml` (desarrollo), `docker-compose.prod.yml` (producción) y `docker/` (Dockerfiles, `.dockerignore` por imagen y `nginx.conf`).
  - `docs/`: ADR, modelo de dominio y capturas.
  - La raíz solo conserva `README.md`, `LICENSE`, `Makefile`, `compose.yaml` (que incluye `infrastructure/docker-compose.yml`, para que `docker compose up` siga funcionando desde la raíz) y `data/` (ignorado).
- **La carpeta del paquete Python se llama `backend/lunar-core`**, con guion. Si se llamara `lunar_core`, al ejecutar desde `backend/` Python la tomaría como paquete de espacio de nombres y taparía al paquete real (`No module named 'lunar_core.kernels'`). El guion la vuelve no importable y además coincide con el nombre de la distribución.
- **Imágenes multi-etapa con dos targets:**
  - `api.Dockerfile`:
    - `dev`: dependencias de desarrollo y `--reload`.
    - `prod`: solo dependencias de ejecución, instalación no editable, usuario sin privilegios `app` y sin recarga.
  - `web.Dockerfile`:
    - `dev`: servidor de Vite.
    - `prod`: build estático servido por **nginx**, que además hace de proxy de `/api` hacia la API. Así hay un único origen y no hace falta CORS.
    - `nginx.conf` vive en `infrastructure/docker/` y llega al build como contexto adicional (`additional_contexts: infra`), sin copiarse dentro de `frontend/`.
- **Producción** (`infrastructure/docker-compose.prod.yml`):
  - un único puerto público (`WEB_PORT`, por defecto 8080) y la API solo en la red interna;
  - datos en un volumen con nombre (`clps-data`), cargados por el mismo servicio `data` de una sola ejecución;
  - `restart: unless-stopped` y healthchecks. El de nginx usa `127.0.0.1`, porque en Alpine `localhost` resuelve a `::1` y nginx escucha en IPv4.
- **Capturas reproducibles:** un proyecto de Playwright aparte (`make screenshots`) regenera `docs/screenshots/`, que no forma parte de la suite e2e normal.
- **Planificación fuera del repositorio:** el brief del proyecto, el roadmap y los borradores de la demo y del envío quedan en `planning/` (ignorado) y no forman parte del historial publicado. Los ADR que citan "el brief" conservan esas referencias como contexto histórico.

## Consecuencias

- **Verificado tras la reorganización:**
  - backend: 109 tests, `ruff` y `mypy --strict`;
  - web: 40 tests, ESLint y `tsc`;
  - contrato OpenAPI sincronizado;
  - 10 pruebas e2e contra el stack de desarrollo.
- **Stack de producción desde cero:** construyó las imágenes, descargó los datos en un volumen vacío y quedó *healthy* en ~3,5 min, y las **10 pruebas e2e pasan contra nginx** (`E2E_BASE_URL=http://localhost:8080`).
- Para correr herramientas del backend en el host, los comandos se ejecutan desde `backend/`. El `conftest.py` de ese directorio apunta los tests a `../data`. La API y los pipelines usan `CLPS_DATA_DIR` (en Docker, `/data`).
