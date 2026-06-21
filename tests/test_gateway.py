"""Regression tests for the Phase 1 FastAPI ingestion gateway."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from api.index import app

TEST_TOKEN = "phase-one-test-token"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """Builds a FastAPI test client with a deterministic inbound secret.

    Args:
        monkeypatch: Pytest fixture used to isolate environment variables.

    Yields:
        A TestClient instance bound to the FastAPI application.
    """
    monkeypatch.setenv("INBOUND_SECRET_TOKEN", TEST_TOKEN)

    with TestClient(app) as test_client:
        yield test_client


def valid_payload() -> dict[str, str]:
    """Returns a MacroDroid-shaped transaction notification payload.

    Returns:
        A JSON-serializable payload matching the inbound ingestion contract.
    """
    return {
        "notification_text": "BMO Credit Card: Approved $14.50 at Tim Hortons",
        "timestamp": "2026-06-17T20:55:00Z",
    }


def auth_headers(token: str = TEST_TOKEN) -> dict[str, str]:
    """Returns bearer-token headers for ingestion gate requests.

    Args:
        token: Static bearer token to place in the Authorization header.

    Returns:
        Header mapping suitable for FastAPI TestClient requests.
    """
    return {"Authorization": f"Bearer {token}"}


def test_health_check_returns_healthy_status(client: TestClient) -> None:
    """Verifies the serverless gateway health endpoint is reachable.

    Args:
        client: FastAPI test client configured for the application.

    Returns:
        None.
    """
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_ingest_rejects_missing_authorization(client: TestClient) -> None:
    """Verifies the ingestion route blocks requests without bearer auth.

    Args:
        client: FastAPI test client configured for the application.

    Returns:
        None.
    """
    response = client.post("/api/v1/ingest", json=valid_payload())

    assert response.status_code == 401


def test_ingest_rejects_invalid_authorization(client: TestClient) -> None:
    """Verifies the ingestion route blocks incorrect bearer tokens.

    Args:
        client: FastAPI test client configured for the application.

    Returns:
        None.
    """
    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers("wrong-token"),
        json=valid_payload(),
    )

    assert response.status_code == 401


def test_ingest_rejects_invalid_payload_shape(client: TestClient) -> None:
    """Verifies Pydantic rejects empty text and unexpected JSON fields.

    Args:
        client: FastAPI test client configured for the application.

    Returns:
        None.
    """
    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json={
            "notification_text": "",
            "timestamp": "2026-06-17T20:55:00Z",
            "extra": "blocked",
        },
    )

    assert response.status_code == 422


def test_ingest_rejects_timezone_naive_timestamp(client: TestClient) -> None:
    """Verifies timestamps must include explicit timezone context.

    Args:
        client: FastAPI test client configured for the application.

    Returns:
        None.
    """
    payload = valid_payload()
    payload["timestamp"] = "2026-06-17T20:55:00"

    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=payload,
    )

    assert response.status_code == 422


def test_ingest_accepts_macrodroid_millisecond_timestamp(
    client: TestClient,
) -> None:
    """Verifies MacroDroid Unix millisecond timestamps are normalized.

    Args:
        client: FastAPI test client configured for the application.

    Returns:
        None.
    """
    payload = valid_payload()
    payload["timestamp"] = "1782057637417"

    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=payload,
    )

    assert response.status_code == 202
    assert response.json() == {
        "status": "accepted",
        "timestamp": "2026-06-21T16:00:37.417000Z",
    }


def test_ingest_accepts_macrodroid_second_timestamp(client: TestClient) -> None:
    """Verifies MacroDroid Unix second timestamps are normalized.

    Args:
        client: FastAPI test client configured for the application.

    Returns:
        None.
    """
    payload = valid_payload()
    payload["timestamp"] = "1782057883"

    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=payload,
    )

    assert response.status_code == 202
    assert response.json() == {
        "status": "accepted",
        "timestamp": "2026-06-21T16:04:43Z",
    }


def test_ingest_accepts_valid_macrodroid_payload(client: TestClient) -> None:
    """Verifies valid signed MacroDroid-shaped payloads pass the gate.

    Args:
        client: FastAPI test client configured for the application.

    Returns:
        None.
    """
    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=valid_payload(),
    )

    assert response.status_code == 202
    assert response.json() == {
        "status": "accepted",
        "timestamp": "2026-06-17T20:55:00Z",
    }
