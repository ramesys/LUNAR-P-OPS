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
from lunar_core.roi import ROIS
from lunar_core.sites import Site, custom_site
from lunar_core.terrain_patch import LocalTerrainPatch

from clps_api import candidate, candidate_store, evaluation, pole_map, roi_terrain, terrain_store
from clps_api.schemas import (
    AnalysisRequest,
    AnalysisResponse,
    CandidateEvolutionRequest,
    CandidateOut,
    CandidateRefOut,
    CandidateRequest,
    EvaluationOut,
    EvaluationRequest,
    HealthResponse,
    PoleMapOut,
    RoiOut,
    RoiTerrainOut,
    SiteOut,
    TerrainPatchOut,
)
from clps_api.service import CATALOG, resolve_site, run_analysis, site_out


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    before = evaluation.kernel_hashes()
    load_kernels(Path(os.environ.get("CLPS_DATA_DIR", "data")) / "kernels")
    if before != evaluation.kernel_hashes():
        raise RuntimeError("SPICE kernels changed while loading")
    evaluation.record_loaded_kernel_hashes()
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


TERRAIN_PATCH_SOURCE: str = (
    "NASA GSFC LOLA LDEM_80S_20MPP_ADJ (20 m/px), resampled to the local east/north grid"
)


@app.get(
    "/api/sites/{site_id}/terrain",
    operation_id="getSiteTerrain",
    responses={
        404: {"description": "Unknown site, or no terrain for it (custom sites never have)"}
    },
)
def get_site_terrain(site_id: str) -> TerrainPatchOut:
    try:
        site: Site | None = resolve_site(site_id)
    except ValueError:
        site = None
    patch: LocalTerrainPatch | None = None if site is None else terrain_store.patch_for(site)
    if site is None or patch is None:
        raise HTTPException(status_code=404, detail=f"no terrain for site: {site_id}")
    return TerrainPatchOut(
        site_id=site.id,
        half_width_m=patch.half_width_m,
        size=patch.size,
        heights_m=[round(float(v), 1) for v in patch.heights_m.ravel()],
        site_ground_m=round(patch.site_ground_m, 1),
        source=TERRAIN_PATCH_SOURCE,
    )


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


@app.post("/api/sites/{site_id}/candidate", operation_id="createCandidate")
def create_candidate(site_id: str, request: CandidateRequest) -> CandidateOut:
    if site_id != "sample-a":
        raise HTTPException(status_code=404, detail="candidate terrain site unavailable")
    site = resolve_site(site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="unknown terrain site")
    try:
        return candidate_store.save(candidate.create_candidate(site, request))
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/api/rois", operation_id="listRois")
def list_rois() -> list[RoiOut]:
    return [roi_terrain.roi_out(roi) for roi in ROIS.values()]


@app.get(
    "/api/rois/{roi_id}/terrain",
    operation_id="getRoiTerrain",
    responses={404: {"description": "Unknown ROI, or its LOLA windows are not downloaded"}},
)
def get_roi_terrain(roi_id: str) -> RoiTerrainOut:
    try:
        found = roi_terrain.roi_terrain(roi_id)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if found is None:
        raise HTTPException(status_code=404, detail=f"unknown ROI: {roi_id}")
    return found


@app.post(
    "/api/rois/{roi_id}/candidates",
    operation_id="createRoiCandidate",
    responses={
        404: {"description": "Unknown ROI or terrain unavailable"},
        422: {"description": "Outside the ROI or DEM coverage"},
    },
)
def create_roi_candidate(roi_id: str, request: CandidateRequest) -> CandidateOut:
    roi = ROIS.get(roi_id)
    if roi is None:
        raise HTTPException(status_code=404, detail=f"unknown ROI: {roi_id}")
    try:
        return candidate_store.save(candidate.create_roi_candidate(roi, request))
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/api/rois/{roi_id}/candidates", operation_id="listRoiCandidates")
def list_roi_candidates(roi_id: str) -> list[CandidateOut]:
    """Persisted root (C0) candidates created in this ROI, oldest first."""
    if roi_id not in ROIS:
        raise HTTPException(status_code=404, detail=f"unknown ROI: {roi_id}")
    return candidate_store.roots(roi_id)


@app.get("/api/candidates/{candidate_id}/ref", operation_id="getCandidateRef")
def get_candidate_ref(candidate_id: str) -> CandidateRefOut:
    found = candidate_store.ref(candidate_id)
    if found is None:
        raise HTTPException(status_code=404, detail="candidate not found")
    return found


@app.get("/api/candidates/{candidate_id}", operation_id="getCandidate")
def get_candidate(candidate_id: str) -> CandidateOut:
    result = candidate_store.get(candidate_id)
    if result is None:
        raise HTTPException(status_code=404, detail="candidate not found")
    return result


@app.get("/api/candidates/{candidate_id}/children", operation_id="listCandidateChildren")
def list_candidate_children(candidate_id: str) -> list[CandidateOut]:
    if candidate_store.get(candidate_id) is None:
        raise HTTPException(status_code=404, detail="candidate not found")
    return candidate_store.children(candidate_id)


@app.post("/api/candidates/{candidate_id}/evolve", operation_id="evolveCandidate")
def evolve_candidate(candidate_id: str, request: CandidateEvolutionRequest) -> CandidateOut:
    parent = candidate_store.get(candidate_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="candidate not found")
    return candidate_store.evolve(parent, request)


@app.post("/api/candidates/{candidate_id}/evaluations", operation_id="evaluateCandidate")
def evaluate_candidate(candidate_id: str, request: EvaluationRequest) -> EvaluationOut:
    found = candidate_store.get(candidate_id)
    if found is None:
        raise HTTPException(status_code=404, detail="candidate not found")
    return evaluation.evaluate(found, request)


@app.get("/api/candidates/{candidate_id}/evaluations", operation_id="listCandidateEvaluations")
def list_candidate_evaluations(candidate_id: str) -> list[EvaluationOut]:
    if candidate_store.get(candidate_id) is None:
        raise HTTPException(status_code=404, detail="candidate not found")
    return evaluation.list_for(candidate_id)


@app.get("/api/evaluations/{evaluation_id}", operation_id="getEvaluation")
def get_evaluation(evaluation_id: str) -> EvaluationOut:
    found = evaluation.get(evaluation_id)
    if found is None:
        raise HTTPException(status_code=404, detail="evaluation not found")
    return found
