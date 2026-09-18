from clps_api.main import app
from fastapi.testclient import TestClient


def test_health_reports_versions():
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "api_version": "0.1.0",
        "lunar_core_version": "0.1.0",
    }
