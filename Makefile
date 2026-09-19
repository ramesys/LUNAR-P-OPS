# Developer shortcuts. Every target is a thin wrapper around `docker compose` (see README).
# Backend and frontend tasks run inside the dev containers, so the host only needs Docker
# (plus Node + pnpm for the end-to-end tests and screenshots, which drive the host's Edge).

.PHONY: up dev down logs prod-up prod-down prod-logs \
	fetch-data fetch-terrain fetch-basemap spike-terrain golden \
	test test-py test-web lint lint-py lint-web fmt e2e screenshots openapi check-openapi

# Git Bash on Windows rewrites /container/paths into C:/...; harmless elsewhere.
export MSYS_NO_PATHCONV := 1

PROD = docker compose -f infrastructure/docker-compose.prod.yml

# Backend tasks: the whole backend/ is mounted, so they always see the current code.
PY_RUN  = docker compose run --rm --no-deps -T -v ./backend:/workspace api
# Frontend tasks: sources are mounted; node_modules stay inside the image.
WEB_RUN = docker compose run --rm --no-deps -T --build \
	-v ./frontend/web/src:/workspace/web/src \
	-v ./frontend/api-client/src:/workspace/api-client/src \
	-v ./frontend/api-client/openapi.json:/workspace/api-client/openapi.json \
	web

# --- Development stack -------------------------------------------------------------------
up:
	docker compose up --build -d --wait

dev:
	docker compose up --build --watch

down:
	docker compose down

logs:
	docker compose logs -f

# --- Production stack (nginx + API, one public port: WEB_PORT, default 8080) --------------
prod-up:
	$(PROD) up --build -d --wait

prod-down:
	$(PROD) down

prod-logs:
	$(PROD) logs -f

# --- Data ---------------------------------------------------------------------------------
fetch-data:
	$(PY_RUN) clps-fetch-kernels

fetch-terrain:
	$(PY_RUN) clps-fetch-terrain

fetch-basemap:
	$(PY_RUN) clps-fetch-basemap

spike-terrain: fetch-data
	$(PY_RUN) clps-spike-terrain

golden:
	$(PY_RUN) clps-fetch-horizons-golden lunar-core/tests/golden/horizons_2026.json

# --- Quality ------------------------------------------------------------------------------
test: test-py test-web

test-py: fetch-data
	$(PY_RUN) pytest -q -p no:cacheprovider

test-web:
	$(WEB_RUN) pnpm -r --workspace-root test

lint: lint-py lint-web

lint-py:
	$(PY_RUN) sh -c "ruff check . && ruff format --check . && mypy"

lint-web:
	$(WEB_RUN) sh -c "pnpm -r --workspace-root lint && pnpm -r --workspace-root typecheck"

fmt:
	$(PY_RUN) sh -c "ruff check --fix . && ruff format ."

# Host-side (Node + pnpm + Microsoft Edge) against the running dev stack: `make up` first.
e2e:
	cd frontend && pnpm --filter @clps/web e2e

# Regenerates the README screenshots in docs/screenshots (dev stack must be running).
screenshots:
	cd frontend && pnpm --filter @clps/web screenshots

# --- API contract -------------------------------------------------------------------------
openapi:
	$(PY_RUN) python -m clps_api.export_openapi openapi.tmp.json
	mv backend/openapi.tmp.json frontend/api-client/openapi.json
	$(WEB_RUN) pnpm --filter @clps/api-client generate

check-openapi: openapi
	git diff --exit-code -- frontend/api-client
