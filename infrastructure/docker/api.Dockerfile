# Backend image (FastAPI + lunar_core + data pipelines). Build context: backend/ (uv workspace).
#   target "dev":  dev dependencies (pytest, ruff, mypy) and auto-reload; used by docker-compose.yml
#   target "prod": runtime dependencies only, no reload, non-root user; used by docker-compose.prod.yml
FROM python:3.12-slim AS base

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

# rasterio's bundled GDAL links against libexpat, which the slim image does not ship.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    CLPS_DATA_DIR=/data

WORKDIR /workspace
COPY pyproject.toml uv.lock .python-version ./
COPY lunar-core/pyproject.toml lunar-core/
COPY api/pyproject.toml api/
COPY pipelines/pyproject.toml pipelines/

FROM base AS dev
RUN uv sync --frozen --no-install-workspace
COPY lunar-core lunar-core
COPY api api
COPY pipelines pipelines
RUN uv sync --frozen
EXPOSE 8000
CMD ["uvicorn", "clps_api.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--reload", "--reload-dir", "api/src", "--reload-dir", "lunar-core/src"]

FROM base AS prod
RUN uv sync --frozen --no-dev --no-install-workspace
COPY lunar-core lunar-core
COPY api api
COPY pipelines pipelines
RUN uv sync --frozen --no-dev --no-editable \
    && useradd --create-home --uid 10001 app \
    && mkdir -p /data && chown app /data
USER app
EXPOSE 8000
CMD ["uvicorn", "clps_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
