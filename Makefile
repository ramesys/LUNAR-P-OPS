.PHONY: up dev down logs fetch-data fetch-terrain fetch-basemap spike-terrain golden e2e test test-py test-web lint lint-py lint-web fmt openapi check-openapi

# Git Bash on Windows rewrites /container/paths into C:/...; harmless elsewhere.
export MSYS_NO_PATHCONV := 1

PY_RUN  = docker compose run --rm --no-deps -T \
	-v ./pyproject.toml:/workspace/pyproject.toml \
	-v ./libs/lunar_core:/workspace/libs/lunar_core \
	-v ./services/api:/workspace/services/api \
	-v ./pipelines:/workspace/pipelines \
	api
WEB_RUN = docker compose run --rm --no-deps -T --build \
	-v ./apps/web/src:/workspace/apps/web/src \
	-v ./packages/api-client/src:/workspace/packages/api-client/src \
	-v ./packages/api-client/openapi.json:/workspace/packages/api-client/openapi.json \
	web

up:
	docker compose up --build -d --wait

dev:
	docker compose up --build --watch

down:
	docker compose down

logs:
	docker compose logs -f

fetch-data:
	$(PY_RUN) clps-fetch-kernels

fetch-terrain:
	$(PY_RUN) clps-fetch-terrain

fetch-basemap:
	$(PY_RUN) clps-fetch-basemap

spike-terrain: fetch-data
	$(PY_RUN) clps-spike-terrain

golden:
	$(PY_RUN) clps-fetch-horizons-golden libs/lunar_core/tests/golden/horizons_2026.json

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

openapi:
	$(PY_RUN) python -m clps_api.export_openapi services/api/openapi.tmp.json
	mv services/api/openapi.tmp.json packages/api-client/openapi.json
	$(WEB_RUN) pnpm --filter @clps/api-client generate

check-openapi: openapi
	git diff --exit-code -- packages/api-client
