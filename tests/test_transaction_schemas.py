"""Unit tests for transaction DTO validation contracts."""

import pytest
from pydantic import ValidationError

from src.schemas.transaction import CategoryEnum, CleanTransaction


def test_clean_transaction_accepts_supported_category() -> None:
    """Verifies CleanTransaction accepts the exact category enum values.

    Returns:
        None.
    """
    transaction = CleanTransaction(
        merchant_name="Tim Hortons",
        amount=14.50,
        category="Food",
    )

    assert transaction.category == CategoryEnum.FOOD


def test_clean_transaction_rejects_unknown_category() -> None:
    """Verifies CleanTransaction rejects category values outside the enum.

    Returns:
        None.
    """
    with pytest.raises(ValidationError):
        CleanTransaction(
            merchant_name="Tim Hortons",
            amount=14.50,
            category="Coffee",
        )


def test_clean_transaction_rejects_extra_fields() -> None:
    """Verifies CleanTransaction remains a closed internal data contract.

    Returns:
        None.
    """
    with pytest.raises(ValidationError):
        CleanTransaction(
            merchant_name="Tim Hortons",
            amount=14.50,
            category="Food",
            raw_text="blocked",
        )
