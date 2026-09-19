import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from importlib.metadata import version
from pathlib import Path

import lunar_core
from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from lunar_core.kernels import load_kernels
from lunar_core.sites import Site, custom_site

from clps_api import pole_map
from clps_api.schemas import (
    AnalysisRequest,
    AnalysisResponse,
    HealthResponse,
    PoleMapOut,
    SiteOut,
)
from clps_api.service import CATALOG, resolve_site, run_analysis, site_out


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


@app.get(
    "/api/sites/custom",
    operation_id="createCustomSite",
    responses={422: {"description": "Coordinates outside the south polar region"}},
)
def get_custom_site(latitude: float, longitude: float) -> SiteOut:
    """Canonical custom site (RF-17) for user coordinates: planetocentric °, east longitude."""
    try:
        return site_out(custom_site(latitude, longitude))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get(
    "/api/sites/{site_id}",
    operation_id="getSite",
    responses={404: {"description": "Unknown site id"}},
)
def get_site(site_id: str) -> SiteOut:
    try:
        site: Site | None = resolve_site(site_id)
    except ValueError:
        site = None
    if site is None:
        raise HTTPException(status_code=404, detail=f"unknown site id: {site_id}")
    return site_out(site)


@app.get("/api/map", operation_id="getPoleMap")
def get_pole_map() -> PoleMapOut:
    return pole_map.pole_map()


@app.get(
    "/api/map/hillshade.png",
    operation_id="getPoleMapImage",
    response_class=FileResponse,
    responses={404: {"description": "Basemap not downloaded (run make fetch-basemap)"}},
)
def get_pole_map_image() -> FileResponse:
    path: Path | None = pole_map.image_path()
    if path is None:
        raise HTTPException(status_code=404, detail="basemap not available")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "max-age=3600"})


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
