"""Unit tests for transaction DTO validation contracts."""

from math import inf, nan

import pytest
from pydantic import ValidationError

from src.schemas.transaction import (
    CategoryEnum,
    CleanTransaction,
    LlmClassification,
    ResolvedTransaction,
)


@pytest.mark.parametrize("confidence", [0.0, 0.70, 1.0])
def test_llm_classification_accepts_inclusive_category_confidence_bounds(
    confidence: float,
) -> None:
    """Accepts finite category confidence at both inclusive bounds."""
    transaction = LlmClassification(
        merchant_name="Tim Hortons",
        amount=14.50,
        category="Food",
        confidence=confidence,
    )

    assert transaction.category == CategoryEnum.FOOD
    assert transaction.confidence == confidence
    assert CleanTransaction is LlmClassification

def test_llm_classification_requires_confidence() -> None:
    """Rejects LLM classifications that omit category confidence."""
    with pytest.raises(ValidationError):
        LlmClassification(
            merchant_name="Tim Hortons",
            amount=14.50,
            category="Food",
        )


@pytest.mark.parametrize("confidence", [-0.01, 1.01, nan, inf, -inf])
def test_llm_classification_rejects_invalid_confidence(confidence: float) -> None:
    """Rejects out-of-range and non-finite category confidence values."""
    with pytest.raises(ValidationError):
        LlmClassification(
            merchant_name="Tim Hortons",
            amount=14.50,
            category="Food",
            confidence=confidence,
        )


def test_resolved_transaction_retains_confidence_and_review_metadata() -> None:
    """Represents a correction-resolved transaction without changing confidence."""
    transaction = ResolvedTransaction(
        merchant_name="Tim Hortons",
        amount=14.50,
        category="Bills",
        confidence=0.42,
        reviewed=True,
        classification_origin="correction_lookup",
    )

    assert transaction.confidence == 0.42
    assert transaction.reviewed is True
    assert transaction.classification_origin == "correction_lookup"
