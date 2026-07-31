"""Async Supabase persistence helpers for transaction storage."""

import os
from collections.abc import Mapping
from datetime import datetime
from enum import Enum
from typing import TypedDict

from dotenv import load_dotenv
from postgrest.exceptions import APIError
from supabase import AsyncClient, create_async_client

from src.schemas.transaction import CategoryEnum, ResolvedTransaction

EXPENSES_TABLE = "expenses"
RESOLVE_LATEST_CORRECTION_RPC = "resolve_latest_correction"
TRANSACTION_CONFLICT_TARGET = "merchant_name,amount,timestamp"
POSTGRES_UNIQUE_VIOLATION_CODE = "23505"


class ExpenseUpsertPayload(TypedDict):
    """Represents the complete notification-derived expenses row payload."""

    merchant_name: str
    amount: float
    category: str
    timestamp: str
    confidence: float
    reviewed: bool
    classified_at: str
    classification_origin: str


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
    transaction: ResolvedTransaction,
    timestamp: datetime,
    classified_at: datetime,
) -> ExpenseUpsertPayload:
    """Builds the complete metadata-bearing payload for a resolved expense.

    Args:
        transaction: LLM classification after correction lookup resolution.
        timestamp: Timezone-aware notification timestamp to persist.
        classified_at: Time at which the accepted LLM classification was stored.

    Returns:
        An ExpenseUpsertPayload matching all enabled ingestion columns.
    """
    return {
        "merchant_name": transaction.merchant_name,
        "amount": transaction.amount,
        "category": transaction.category.value,
        "timestamp": timestamp.isoformat(),
        "confidence": transaction.confidence,
        "reviewed": transaction.reviewed,
        "classified_at": classified_at.isoformat(),
        "classification_origin": transaction.classification_origin,
    }


async def resolve_latest_correction(merchant_name: str) -> CategoryEnum | None:
    """Looks up the newest corrected category for a canonical merchant.

    The RPC is the sole category-reuse source. An unexpected RPC result is a
    lookup failure, not a safe-to-ignore cache miss.

    Args:
        merchant_name: Display merchant name to normalize in the database RPC.

    Returns:
        The corrected category, or None when no correction matches.

    Raises:
        RuntimeError: If the RPC response does not represent zero or one valid row.
        APIError: If Supabase cannot complete the RPC.
    """
    client = await get_supabase_client()
    result = await client.rpc(
        RESOLVE_LATEST_CORRECTION_RPC,
        {"p_merchant_name": merchant_name},
    ).execute()
    rows = result.data

    if rows is None:
        return None

    if not isinstance(rows, list) or len(rows) > 1:
        raise RuntimeError("Correction lookup returned an invalid result.")

    if not rows:
        return None

    row = rows[0]
    if not isinstance(row, Mapping):
        raise RuntimeError("Correction lookup returned an invalid result.")

    corrected_category = row.get("corrected_category")
    if not isinstance(corrected_category, str):
        raise RuntimeError("Correction lookup returned an invalid result.")

    try:
        return CategoryEnum(corrected_category)
    except ValueError as error:
        raise RuntimeError("Correction lookup returned an invalid result.") from error


def is_duplicate_transaction_error(error: APIError) -> bool:
    """Determines whether a Supabase API error is a duplicate-key collision.

    Args:
        error: APIError raised by the PostgREST client.

    Returns:
        True when the error represents a PostgreSQL unique-constraint collision.
    """
    return error.json().get("code") == POSTGRES_UNIQUE_VIOLATION_CODE


async def upsert_expense_transaction(
    transaction: ResolvedTransaction,
    timestamp: datetime,
    classified_at: datetime,
) -> TransactionPersistenceStatus:
    """Persists a resolved transaction with all ingestion metadata.

    Existing composite-conflict behavior remains intentionally unchanged while
    exactly-once retry guarantees remain deferred.

    Args:
        transaction: LLM classification after correction lookup resolution.
        timestamp: Timezone-aware notification timestamp to persist.
        classified_at: Time at which the accepted LLM classification was stored.

    Returns:
        TransactionPersistenceStatus.STORED after a successful upsert, or
        TransactionPersistenceStatus.DUPLICATE when a unique collision is ignored.

    Raises:
        RuntimeError: If Supabase configuration is absent.
        APIError: If Supabase rejects the operation for a non-duplicate reason.
    """
    client = await get_supabase_client()
    payload = build_expense_upsert_payload(transaction, timestamp, classified_at)

    try:
        # Preserve the existing deferred idempotency behavior and conflict target.
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
