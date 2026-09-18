from importlib.metadata import version
from typing import Literal

import lunar_core
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="CLPS Lunar Mission Browser API", version=version("clps-api"))


class HealthResponse(BaseModel):
    status: Literal["ok"]
    api_version: str
    lunar_core_version: str


@app.get("/api/health", operation_id="getHealth")
def get_health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        api_version=version("clps-api"),
        lunar_core_version=lunar_core.__version__,
    )
