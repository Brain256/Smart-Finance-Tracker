"""Regression tests for the Phase 1 FastAPI ingestion gateway."""

from collections.abc import Iterator
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

import api.index
from api.index import app
from src.core.database import TransactionPersistenceStatus
from src.schemas.transaction import CategoryEnum, CleanTransaction

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


@pytest.fixture(autouse=True)
def extractor_stub(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    """Replaces the network AI extractor with a deterministic fake.

    Args:
        monkeypatch: Pytest fixture used to swap the endpoint dependency.

    Returns:
        The list of notification title/body pairs passed into the fake extractor.
    """
    captured_notifications: list[tuple[str, str]] = []

    async def fake_extract_transaction_entities(
        notification_title: str,
        notification_text: str,
    ) -> CleanTransaction:
        """Returns a fixed clean transaction for gateway integration tests.

        Args:
            notification_title: Raw notification title forwarded by the endpoint.
            notification_text: Raw notification body forwarded by the endpoint.

        Returns:
            A CleanTransaction object suitable for response serialization.
        """
        captured_notifications.append((notification_title, notification_text))

        return CleanTransaction(
            merchant_name="Tim Hortons",
            amount=14.50,
            category=CategoryEnum.FOOD,
        )

    monkeypatch.setattr(
        api.index,
        "extract_transaction_entities",
        fake_extract_transaction_entities,
    )

    return captured_notifications


@pytest.fixture(autouse=True)
def persistence_stub(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    """Replaces Supabase persistence with a deterministic fake.

    Args:
        monkeypatch: Pytest fixture used to swap the database dependency.

    Returns:
        Captured merchant and timestamp values sent into the fake persistence.
    """
    captured_records: list[tuple[str, str]] = []

    async def fake_upsert_expense_transaction(
        transaction: CleanTransaction,
        timestamp: datetime,
    ) -> TransactionPersistenceStatus:
        """Records the transaction persistence call and returns stored status.

        Args:
            transaction: Clean transaction emitted by the fake extractor.
            timestamp: Parsed timestamp forwarded by the endpoint.

        Returns:
            TransactionPersistenceStatus.STORED for standard gateway tests.
        """
        captured_records.append((transaction.merchant_name, str(timestamp)))

        return TransactionPersistenceStatus.STORED

    monkeypatch.setattr(
        api.index,
        "upsert_expense_transaction",
        fake_upsert_expense_transaction,
    )

    return captured_records


def valid_payload() -> dict[str, str]:
    """Returns a MacroDroid-shaped transaction notification payload.

    Returns:
        A JSON-serializable payload matching the inbound ingestion contract.
    """
    return {
        "notification_title": "Tim Hortons",
        "notification_text": "BMO Credit Card ending in 1234: Approved $14.50",
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


def expected_ingest_response(timestamp: str) -> dict[str, object]:
    """Builds the expected successful ingest response body.

    Args:
        timestamp: Expected ISO timestamp serialized by FastAPI.

    Returns:
        A JSON-compatible response payload.
    """
    return {
        "status": "accepted",
        "timestamp": timestamp,
        "transaction": {
            "merchant_name": "Tim Hortons",
            "amount": 14.5,
            "category": "Food",
        },
    }


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
    assert response.json() == expected_ingest_response(
        "2026-06-21T16:00:37.417000Z"
    )


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
    assert response.json() == expected_ingest_response("2026-06-21T16:04:43Z")


def test_ingest_accepts_valid_macrodroid_payload(
    client: TestClient,
    extractor_stub: list[tuple[str, str]],
    persistence_stub: list[tuple[str, str]],
) -> None:
    """Verifies valid signed MacroDroid-shaped payloads pass the gate.

    Args:
        client: FastAPI test client configured for the application.
        extractor_stub: Captured title/body values sent to the fake extractor.
        persistence_stub: Captured records sent to the fake persistence layer.

    Returns:
        None.
    """
    payload = valid_payload()

    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=payload,
    )

    assert response.status_code == 202
    assert response.json() == expected_ingest_response("2026-06-17T20:55:00Z")
    assert extractor_stub == [
        (payload["notification_title"], payload["notification_text"])
    ]
    assert persistence_stub == [("Tim Hortons", "2026-06-17 20:55:00+00:00")]


def test_ingest_returns_ok_for_duplicate_transaction_retry(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies duplicate database collisions are treated as successful retries.

    Args:
        client: FastAPI test client configured for the application.
        monkeypatch: Pytest fixture used to override persistence behavior.

    Returns:
        None.
    """

    async def fake_duplicate_upsert(
        transaction: CleanTransaction,
        timestamp: datetime,
    ) -> TransactionPersistenceStatus:
        """Returns a duplicate status for retry simulation.

        Args:
            transaction: Clean transaction emitted by the fake extractor.
            timestamp: Parsed timestamp forwarded by the endpoint.

        Returns:
            TransactionPersistenceStatus.DUPLICATE.
        """
        return TransactionPersistenceStatus.DUPLICATE

    monkeypatch.setattr(
        api.index,
        "upsert_expense_transaction",
        fake_duplicate_upsert,
    )

    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=valid_payload(),
    )

    assert response.status_code == 200
    assert response.json() == expected_ingest_response("2026-06-17T20:55:00Z")
