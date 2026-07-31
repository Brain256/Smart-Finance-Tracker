"""Unit tests for Supabase transaction persistence helpers."""

import asyncio
from datetime import UTC, datetime
from typing import TypedDict

import pytest
from postgrest.exceptions import APIError

from src.core import database
from src.core.database import (
    TRANSACTION_CONFLICT_TARGET,
    TransactionPersistenceStatus,
    build_expense_upsert_payload,
    is_duplicate_transaction_error,
    upsert_expense_transaction,
)
from src.schemas.transaction import CategoryEnum, ResolvedTransaction


class CapturedUpsert(TypedDict):
    """Represents arguments captured by the fake Supabase upsert builder.

    Attributes:
        payload: Row payload passed to the Supabase upsert call.
        on_conflict: Composite conflict target supplied to Supabase.
    """

    payload: database.ExpenseUpsertPayload
    on_conflict: str


class FakeExecuteBuilder:
    """Provides the terminal async execute method for fake Supabase calls."""

    def __init__(self, error: APIError | None = None) -> None:
        """Initializes the fake executable request builder.

        Args:
            error: Optional APIError to raise when execute is called.

        Returns:
            None.
        """
        self.error = error

    async def execute(self) -> None:
        """Completes the fake Supabase request.

        Returns:
            None.

        Raises:
            APIError: If this fake builder was initialized with an error.
        """
        if self.error is not None:
            raise self.error

        return None


class FakeRequestBuilder:
    """Captures upsert arguments from the persistence helper.

    Attributes:
        captured: Shared list where upsert call arguments are stored.
    """

    def __init__(
        self,
        captured: list[CapturedUpsert],
        error: APIError | None = None,
    ) -> None:
        """Initializes the fake request builder.

        Args:
            captured: Shared list where upsert call arguments are stored.
            error: Optional APIError to raise when execute is called.

        Returns:
            None.
        """
        self.captured = captured
        self.error = error

    def upsert(
        self,
        payload: database.ExpenseUpsertPayload,
        *,
        on_conflict: str,
    ) -> FakeExecuteBuilder:
        """Records the upsert call and returns an executable builder.

        Args:
            payload: Row payload passed to Supabase.
            on_conflict: Composite conflict target passed to Supabase.

        Returns:
            A FakeExecuteBuilder with an async execute method.
        """
        self.captured.append({"payload": payload, "on_conflict": on_conflict})

        return FakeExecuteBuilder(self.error)


class FakeSupabaseClient:
    """Provides the minimal table API consumed by the database helper.

    Attributes:
        captured: Shared list where upsert call arguments are stored.
        table_names: Table names requested by the persistence helper.
    """

    def __init__(
        self,
        captured: list[CapturedUpsert],
        error: APIError | None = None,
    ) -> None:
        """Initializes the fake Supabase client.

        Args:
            captured: Shared list where upsert call arguments are stored.
            error: Optional APIError to raise when execute is called.

        Returns:
            None.
        """
        self.captured = captured
        self.error = error
        self.table_names: list[str] = []

    def table(self, table_name: str) -> FakeRequestBuilder:
        """Records the table name and returns a fake request builder.

        Args:
            table_name: Supabase table name requested by the helper.

        Returns:
            A FakeRequestBuilder for the requested table.
        """
        self.table_names.append(table_name)

        return FakeRequestBuilder(self.captured, self.error)


def resolved_transaction() -> ResolvedTransaction:
    """Builds a representative resolved transaction for persistence tests.

    Returns:
        A metadata-bearing ResolvedTransaction ready for persistence.
    """
    return ResolvedTransaction(
        merchant_name="Tim Hortons",
        amount=14.50,
        category=CategoryEnum.FOOD,
        confidence=0.91,
        reviewed=True,
        classification_origin="llm",
    )


def transaction_timestamp() -> datetime:
    """Builds a representative timezone-aware transaction timestamp.

    Returns:
        A UTC datetime for persistence tests.
    """
    return datetime(2026, 6, 17, 20, 55, tzinfo=UTC)


def test_build_expense_upsert_payload_serializes_resolved_transaction() -> None:
    """Verifies resolved metadata maps to the expanded expenses row shape."""
    payload = build_expense_upsert_payload(
        resolved_transaction(),
        transaction_timestamp(),
        transaction_timestamp(),
    )

    assert payload == {
        "merchant_name": "Tim Hortons",
        "amount": 14.50,
        "category": "Food",
        "timestamp": "2026-06-17T20:55:00+00:00",
        "confidence": 0.91,
        "reviewed": True,
        "classified_at": "2026-06-17T20:55:00+00:00",
        "classification_origin": "llm",
    }


def test_is_duplicate_transaction_error_detects_postgres_unique_collision() -> None:
    """Verifies PostgreSQL unique-constraint errors are recognized.

    Returns:
        None.
    """
    error = APIError(
        {
            "message": "duplicate key value violates unique constraint",
            "code": "23505",
            "hint": None,
            "details": "Key already exists.",
        }
    )

    assert is_duplicate_transaction_error(error)


def test_is_duplicate_transaction_error_rejects_other_api_errors() -> None:
    """Verifies unrelated Supabase API errors are not suppressed.

    Returns:
        None.
    """
    error = APIError(
        {
            "message": "relation expenses does not exist",
            "code": "42P01",
            "hint": None,
            "details": None,
        }
    )

    assert not is_duplicate_transaction_error(error)


class FakeCorrectionLookupResponse:
    """Supplies the response shape returned by the correction RPC."""

    def __init__(self, data: list[dict[str, str]] | None) -> None:
        self.data = data


class FakeCorrectionLookupBuilder:
    """Returns a predetermined correction RPC response."""

    def __init__(self, data: list[dict[str, str]] | None) -> None:
        self.data = data

    async def execute(self) -> FakeCorrectionLookupResponse:
        return FakeCorrectionLookupResponse(self.data)


class FakeCorrectionLookupClient:
    """Captures correction RPC requests without accessing Supabase."""

    def __init__(self, data: list[dict[str, str]] | None) -> None:
        self.data = data
        self.calls: list[tuple[str, dict[str, str]]] = []

    def rpc(
        self,
        function_name: str,
        arguments: dict[str, str],
    ) -> FakeCorrectionLookupBuilder:
        self.calls.append((function_name, arguments))
        return FakeCorrectionLookupBuilder(self.data)


def test_resolve_latest_correction_returns_the_rpc_category(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Maps the authoritative correction-lookup RPC hit to a category enum."""
    fake_client = FakeCorrectionLookupClient([{"corrected_category": "Bills"}])

    async def fake_get_supabase_client() -> FakeCorrectionLookupClient:
        return fake_client

    monkeypatch.setattr(database, "get_supabase_client", fake_get_supabase_client)

    assert asyncio.run(database.resolve_latest_correction("  TIM   HORTONS  ")) == (
        CategoryEnum.BILLS
    )
    assert fake_client.calls == [
        ("resolve_latest_correction", {"p_merchant_name": "  TIM   HORTONS  "})
    ]


def test_resolve_latest_correction_preserves_a_no_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Treats an empty RPC result as no learned correction rather than an error."""
    fake_client = FakeCorrectionLookupClient([])

    async def fake_get_supabase_client() -> FakeCorrectionLookupClient:
        return fake_client

    monkeypatch.setattr(database, "get_supabase_client", fake_get_supabase_client)

    assert asyncio.run(database.resolve_latest_correction("Tim Hortons")) is None


def test_upsert_expense_transaction_uses_composite_conflict_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies the persistence helper writes all resolved metadata."""
    captured: list[CapturedUpsert] = []
    fake_client = FakeSupabaseClient(captured)

    async def fake_get_supabase_client() -> FakeSupabaseClient:
        return fake_client

    monkeypatch.setattr(database, "get_supabase_client", fake_get_supabase_client)

    status = asyncio.run(
        upsert_expense_transaction(
            resolved_transaction(),
            transaction_timestamp(),
            transaction_timestamp(),
        )
    )

    assert status == TransactionPersistenceStatus.STORED
    assert fake_client.table_names == ["expenses"]
    assert captured == [
        {
            "payload": {
                "merchant_name": "Tim Hortons",
                "amount": 14.50,
                "category": "Food",
                "timestamp": "2026-06-17T20:55:00+00:00",
                "confidence": 0.91,
                "reviewed": True,
                "classified_at": "2026-06-17T20:55:00+00:00",
                "classification_origin": "llm",
            },
            "on_conflict": TRANSACTION_CONFLICT_TARGET,
        }
    ]


def test_upsert_expense_transaction_suppresses_duplicate_collision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies unique-constraint collisions retain deferred retry behavior."""
    duplicate_error = APIError(
        {
            "message": "duplicate key value violates unique constraint",
            "code": "23505",
            "hint": None,
            "details": "Key already exists.",
        }
    )
    fake_client = FakeSupabaseClient([], duplicate_error)

    async def fake_get_supabase_client() -> FakeSupabaseClient:
        return fake_client

    monkeypatch.setattr(database, "get_supabase_client", fake_get_supabase_client)

    status = asyncio.run(
        upsert_expense_transaction(
            resolved_transaction(),
            transaction_timestamp(),
            transaction_timestamp(),
        )
    )

    assert status == TransactionPersistenceStatus.DUPLICATE
