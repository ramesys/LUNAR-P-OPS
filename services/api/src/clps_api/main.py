import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from importlib.metadata import version
from pathlib import Path

import lunar_core
from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from lunar_core.kernels import load_kernels

from clps_api.schemas import AnalysisRequest, AnalysisResponse, HealthResponse, SiteOut
from clps_api.service import CATALOG, run_analysis, site_out


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    load_kernels(Path(os.environ.get("CLPS_DATA_DIR", "data")) / "kernels")
    yield


app = FastAPI(
    title="CLPS Lunar Mission Browser API", version=version("clps-api"), lifespan=lifespan
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.get("/api/health", operation_id="getHealth")
def get_health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        api_version=version("clps-api"),
        lunar_core_version=lunar_core.__version__,
    )


@app.get("/api/sites", operation_id="listSites")
def list_sites() -> list[SiteOut]:
    return [site_out(site) for site in CATALOG]


@app.post(
    "/api/analysis",
    operation_id="analyzeScenario",
    responses={422: {"description": "Invalid scenario (sites, dates, step or height)"}},
)
def analyze_scenario(request: AnalysisRequest) -> AnalysisResponse:
    try:
        return run_analysis(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
