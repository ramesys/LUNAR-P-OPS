# Build context: repository root (uv workspace).
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH

WORKDIR /workspace

COPY pyproject.toml uv.lock .python-version ./
COPY libs/lunar_core/pyproject.toml libs/lunar_core/
COPY services/api/pyproject.toml services/api/
COPY pipelines/pyproject.toml pipelines/
RUN uv sync --frozen --no-install-workspace

COPY libs/lunar_core libs/lunar_core
COPY services/api services/api
COPY pipelines pipelines
RUN uv sync --frozen

ENV CLPS_DATA_DIR=/data

EXPOSE 8000
CMD ["uvicorn", "clps_api.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--reload", "--reload-dir", "services/api/src", "--reload-dir", "libs/lunar_core/src"]
