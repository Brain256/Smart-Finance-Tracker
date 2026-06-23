"""Async Supabase persistence helpers for transaction storage."""

import os
from datetime import datetime
from enum import Enum
from typing import TypedDict

from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import AsyncClient, create_async_client

from src.schemas.transaction import CleanTransaction

EXPENSES_TABLE = "expenses"
TRANSACTION_CONFLICT_TARGET = "merchant_name,amount,timestamp"
POSTGRES_UNIQUE_VIOLATION_CODE = "23505"


class ExpenseUpsertPayload(TypedDict):
    """Represents the row payload sent to the Supabase expenses table.

    Attributes:
        merchant_name: Normalized merchant or payer name.
        amount: Positive transaction amount in dollar units.
        category: Strict transaction category string.
        timestamp: Timezone-aware transaction timestamp serialized for Postgres.
    """

    merchant_name: str
    amount: float
    category: str
    timestamp: str


class TransactionPersistenceStatus(str, Enum):
    """Represents the outcome of a database persistence attempt.

    Attributes:
        STORED: The transaction was inserted or updated through the upsert path.
        DUPLICATE: A duplicate transaction collision was safely ignored.
    """

    STORED = "stored"
    DUPLICATE = "duplicate"


async def get_supabase_client() -> AsyncClient:
    """Builds an async Supabase client from environment configuration.

    Returns:
        An AsyncClient authenticated with the service role key.

    Raises:
        RuntimeError: If Supabase URL or service role key configuration is absent.
    """
    load_dotenv()
    supabase_url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if supabase_url is None or supabase_url == "":
        raise RuntimeError("SUPABASE_URL is not configured.")

    if service_role_key is None or service_role_key == "":
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not configured.")

    return await create_async_client(supabase_url, service_role_key)


def build_expense_upsert_payload(
    transaction: CleanTransaction,
    timestamp: datetime,
) -> ExpenseUpsertPayload:
    """Builds the exact expenses row payload for Supabase upsert operations.

    Args:
        transaction: Clean transaction entities extracted from notification text.
        timestamp: Timezone-aware notification timestamp to persist.

    Returns:
        An ExpenseUpsertPayload matching the database table columns.
    """
    return {
        "merchant_name": transaction.merchant_name,
        "amount": transaction.amount,
        "category": transaction.category.value,
        "timestamp": timestamp.isoformat(),
    }


def is_duplicate_transaction_error(error: APIError) -> bool:
    """Determines whether a Supabase API error is a duplicate-key collision.

    Args:
        error: APIError raised by the PostgREST client.

    Returns:
        True when the error represents a PostgreSQL unique-constraint collision.
    """
    return error.json().get("code") == POSTGRES_UNIQUE_VIOLATION_CODE


async def upsert_expense_transaction(
    transaction: CleanTransaction,
    timestamp: datetime,
) -> TransactionPersistenceStatus:
    """Persists a clean transaction into Supabase with idempotency controls.

    Args:
        transaction: Clean transaction entities extracted from notification text.
        timestamp: Timezone-aware notification timestamp to persist.

    Returns:
        TransactionPersistenceStatus.STORED after a successful upsert, or
        TransactionPersistenceStatus.DUPLICATE when a unique collision is ignored.

    Raises:
        RuntimeError: If Supabase configuration is absent.
        APIError: If Supabase rejects the operation for a non-duplicate reason.
    """
    client = await get_supabase_client()
    payload = build_expense_upsert_payload(transaction, timestamp)

    try:
        # The composite conflict target makes cellular retry delivery idempotent.
        await (
            client.table(EXPENSES_TABLE)
            .upsert(
                payload,
                on_conflict=TRANSACTION_CONFLICT_TARGET,
            )
            .execute()
        )
    except APIError as error:
        if is_duplicate_transaction_error(error):
            return TransactionPersistenceStatus.DUPLICATE

        raise

    return TransactionPersistenceStatus.STORED
