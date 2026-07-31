"""Regression tests for the Phase 1 FastAPI ingestion gateway."""

from collections.abc import Iterator
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

import api.index
from api.index import app
from src.core.database import TransactionPersistenceStatus
from src.schemas.transaction import CategoryEnum, LlmClassification, ResolvedTransaction

TEST_TOKEN = "phase-one-test-token"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """Builds a test client with deterministic security and finance settings."""
    monkeypatch.setenv("INBOUND_SECRET_TOKEN", TEST_TOKEN)
    monkeypatch.setenv("FINANCE_TIMEZONE", "America/Toronto")
    monkeypatch.setenv("REVIEW_THRESHOLD", "0.70")

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def extractor_stub(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    """Replaces the network extractor with a valid LLM classification."""
    captured_notifications: list[tuple[str, str]] = []

    async def fake_extract_transaction_entities(
        notification_title: str,
        notification_text: str,
    ) -> LlmClassification:
        captured_notifications.append((notification_title, notification_text))
        return LlmClassification(
            merchant_name="Tim Hortons",
            amount=14.50,
            category=CategoryEnum.FOOD,
            confidence=0.91,
        )

    monkeypatch.setattr(
        api.index,
        "extract_transaction_entities",
        fake_extract_transaction_entities,
    )
    return captured_notifications


@pytest.fixture(autouse=True)
def correction_lookup_stub(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Makes correction lookup an explicit, deterministic no-match by default."""
    captured_merchants: list[str] = []

    async def fake_resolve_latest_correction(merchant_name: str) -> None:
        captured_merchants.append(merchant_name)
        return None

    monkeypatch.setattr(
        api.index,
        "resolve_latest_correction",
        fake_resolve_latest_correction,
    )
    return captured_merchants


@pytest.fixture(autouse=True)
def persistence_stub(
    monkeypatch: pytest.MonkeyPatch,
) -> list[tuple[ResolvedTransaction, str, str]]:
    """Replaces persistence and records its complete resolved-row contract."""
    captured_records: list[tuple[ResolvedTransaction, str, str]] = []

    async def fake_upsert_expense_transaction(
        transaction: ResolvedTransaction,
        timestamp: datetime,
        classified_at: datetime,
    ) -> TransactionPersistenceStatus:
        captured_records.append(
            (transaction, timestamp.isoformat(), classified_at.isoformat())
        )
        return TransactionPersistenceStatus.STORED

    monkeypatch.setattr(
        api.index,
        "upsert_expense_transaction",
        fake_upsert_expense_transaction,
    )
    return captured_records


def valid_payload() -> dict[str, str]:
    """Returns a Google Wallet-shaped transaction notification payload."""
    return {
        "notification_title": "Tim Hortons",
        "notification_text": "BMO Credit Card ending in 1234: Approved $14.50",
        "timestamp": "2026-06-17T20:55:00Z",
    }


def auth_headers(token: str = TEST_TOKEN) -> dict[str, str]:
    """Returns bearer-token headers for ingestion gate requests."""
    return {"Authorization": f"Bearer {token}"}


def expected_ingest_response(
    timestamp: str,
    *,
    category: str = "Food",
    confidence: float = 0.91,
    reviewed: bool = True,
    classification_origin: str = "llm",
) -> dict[str, object]:
    """Builds the expected acknowledgement for a resolved transaction."""
    return {
        "status": "accepted",
        "timestamp": timestamp,
        "transaction": {
            "merchant_name": "Tim Hortons",
            "amount": 14.5,
            "category": category,
            "confidence": confidence,
            "reviewed": reviewed,
            "classification_origin": classification_origin,
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


def test_ingest_accepts_wallet_millisecond_timestamp(
    client: TestClient,
) -> None:
    """Verifies inbound Unix millisecond timestamps are normalized.

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


def test_ingest_accepts_wallet_second_timestamp(client: TestClient) -> None:
    """Verifies inbound Unix second timestamps are normalized.

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


def test_ingest_accepts_valid_wallet_payload(
    client: TestClient,
    extractor_stub: list[tuple[str, str]],
    correction_lookup_stub: list[str],
    persistence_stub: list[tuple[ResolvedTransaction, str, str]],
) -> None:
    """Persists a confidence-bearing resolved LLM classification."""
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
    assert correction_lookup_stub == ["Tim Hortons"]
    stored_transaction, timestamp, classified_at = persistence_stub[0]
    assert stored_transaction == ResolvedTransaction(
        merchant_name="Tim Hortons",
        amount=14.50,
        category=CategoryEnum.FOOD,
        confidence=0.91,
        reviewed=True,
        classification_origin="llm",
    )
    assert timestamp == "2026-06-17T20:55:00+00:00"
    assert classified_at.endswith("+00:00")


@pytest.mark.parametrize(
    ("confidence", "expected_reviewed"),
    [(0.0, False), (0.699, False), (0.70, True), (1.0, True)],
)
def test_ingest_derives_review_state_from_the_inclusive_threshold(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    persistence_stub: list[tuple[ResolvedTransaction, str, str]],
    confidence: float,
    expected_reviewed: bool,
) -> None:
    """Marks only confidence at or above the configured threshold reviewed."""

    async def fake_extract_transaction_entities(
        notification_title: str,
        notification_text: str,
    ) -> LlmClassification:
        return LlmClassification(
            merchant_name="Tim Hortons",
            amount=14.50,
            category=CategoryEnum.FOOD,
            confidence=confidence,
        )

    monkeypatch.setattr(
        api.index,
        "extract_transaction_entities",
        fake_extract_transaction_entities,
    )

    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=valid_payload(),
    )

    assert response.status_code == 202
    assert response.json() == expected_ingest_response(
        "2026-06-17T20:55:00Z",
        confidence=confidence,
        reviewed=expected_reviewed,
    )
    assert persistence_stub[0][0].reviewed is expected_reviewed


def test_ingest_correction_lookup_overrides_category_and_keeps_confidence(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    persistence_stub: list[tuple[ResolvedTransaction, str, str]],
) -> None:
    """Applies a learned correction before insertion without changing confidence."""

    async def fake_resolve_latest_correction(merchant_name: str) -> CategoryEnum:
        assert merchant_name == "Tim Hortons"
        return CategoryEnum.BILLS

    monkeypatch.setattr(
        api.index,
        "resolve_latest_correction",
        fake_resolve_latest_correction,
    )

    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=valid_payload(),
    )

    assert response.status_code == 202
    assert response.json() == expected_ingest_response(
        "2026-06-17T20:55:00Z",
        category="Bills",
        classification_origin="correction_lookup",
    )
    assert persistence_stub[0][0] == ResolvedTransaction(
        merchant_name="Tim Hortons",
        amount=14.50,
        category=CategoryEnum.BILLS,
        confidence=0.91,
        reviewed=True,
        classification_origin="correction_lookup",
    )


def test_ingest_lookup_failure_returns_safe_error_without_persistence(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    persistence_stub: list[tuple[ResolvedTransaction, str, str]],
) -> None:
    """Fails closed when correction lookup cannot determine learned category."""

    async def fake_resolve_latest_correction(merchant_name: str) -> None:
        raise RuntimeError("Supabase is unavailable")

    monkeypatch.setattr(
        api.index,
        "resolve_latest_correction",
        fake_resolve_latest_correction,
    )

    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=valid_payload(),
    )

    assert response.status_code == 503
    assert response.json() == {"detail": api.index.SAFE_INGESTION_ERROR}
    assert persistence_stub == []


def test_ingest_invalid_llm_classification_does_not_insert(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    persistence_stub: list[tuple[ResolvedTransaction, str, str]],
) -> None:
    """Rejects a confidence-omitting LLM response before lookup or insertion."""

    async def fake_extract_transaction_entities(
        notification_title: str,
        notification_text: str,
    ) -> object:
        return {
            "merchant_name": "Tim Hortons",
            "amount": 14.50,
            "category": "Food",
        }

    monkeypatch.setattr(
        api.index,
        "extract_transaction_entities",
        fake_extract_transaction_entities,
    )

    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=valid_payload(),
    )

    assert response.status_code == 422
    assert response.json() == {"detail": api.index.SAFE_CLASSIFICATION_ERROR}
    assert persistence_stub == []


def test_ingest_invalid_configuration_does_not_extract_or_insert(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    extractor_stub: list[tuple[str, str]],
    persistence_stub: list[tuple[ResolvedTransaction, str, str]],
) -> None:
    """Fails before processing a notification when the review setting is invalid."""

    def fake_load_finance_config() -> object:
        raise api.index.FinanceConfigurationError("invalid threshold")

    monkeypatch.setattr(api.index, "load_finance_config", fake_load_finance_config)

    response = client.post(
        "/api/v1/ingest",
        headers=auth_headers(),
        json=valid_payload(),
    )

    assert response.status_code == 503
    assert response.json() == {"detail": api.index.SAFE_INGESTION_ERROR}
    assert extractor_stub == []
    assert persistence_stub == []


def test_ingest_returns_ok_for_duplicate_transaction_retry(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Keeps the existing duplicate-success contract after resolution."""

    async def fake_duplicate_upsert(
        transaction: ResolvedTransaction,
        timestamp: datetime,
        classified_at: datetime,
    ) -> TransactionPersistenceStatus:
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
