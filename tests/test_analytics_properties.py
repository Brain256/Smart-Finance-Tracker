"""Property tests for the pure classification-resolution contracts.

Each test maps to one correctness property in the finance-tracker-expansion
design document and runs at least 100 generated examples.
"""

import math

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from api.index import resolve_transaction
from src.core.finance_config import FinanceConfigurationError, load_finance_config
from src.schemas.transaction import CategoryEnum, LlmClassification

PROPERTY_RUNS = settings(max_examples=100)

confidences = st.floats(
    min_value=0, max_value=1, allow_nan=False, allow_infinity=False
)
amounts = st.floats(
    min_value=0.01, max_value=1_000_000, allow_nan=False, allow_infinity=False
)
categories = st.sampled_from(list(CategoryEnum))
merchants = st.text(min_size=1, max_size=40).filter(lambda value: value.strip())


@st.composite
def classifications(draw: st.DrawFn) -> LlmClassification:
    """Builds a valid LLM classification for resolution properties."""
    return LlmClassification(
        merchant_name=draw(merchants),
        amount=draw(amounts),
        category=draw(categories),
        confidence=draw(confidences),
    )


# Feature: finance-tracker-expansion, Property 1: Classification confidence and
# review resolution
@PROPERTY_RUNS
@given(classification=classifications(), threshold=confidences)
def test_property_1_llm_resolution_preserves_confidence_and_threshold_review(
    classification: LlmClassification, threshold: float
) -> None:
    """Stored confidence is the LLM value and review follows the threshold."""
    resolved = resolve_transaction(classification, None, threshold)

    assert resolved.confidence == classification.confidence
    assert resolved.category == classification.category
    assert resolved.classification_origin == "llm"
    assert resolved.reviewed is (classification.confidence >= threshold)


# Feature: finance-tracker-expansion, Property 1: Classification confidence and
# review resolution
@PROPERTY_RUNS
@given(
    merchant=merchants,
    amount=amounts,
    category=categories,
    confidence=st.one_of(
        st.floats(max_value=-0.000001, allow_nan=False, allow_infinity=False),
        st.floats(min_value=1.000001, allow_nan=False, allow_infinity=False),
        st.just(math.nan),
        st.just(math.inf),
        st.just(-math.inf),
    ),
)
def test_property_1_out_of_range_confidence_never_validates(
    merchant: str, amount: float, category: CategoryEnum, confidence: float
) -> None:
    """A non-finite or out-of-range confidence fails before any insertion."""
    with pytest.raises(ValidationError):
        LlmClassification(
            merchant_name=merchant,
            amount=amount,
            category=category,
            confidence=confidence,
        )


# Feature: finance-tracker-expansion, Property 3: Canonical latest correction
# resolution
@PROPERTY_RUNS
@given(
    classification=classifications(),
    corrected_category=categories,
    threshold=confidences,
)
def test_property_3_correction_lookup_overrides_category_and_keeps_confidence(
    classification: LlmClassification,
    corrected_category: CategoryEnum,
    threshold: float,
) -> None:
    """A lookup hit changes only category, review state, and origin."""
    resolved = resolve_transaction(classification, corrected_category, threshold)

    assert resolved.category == corrected_category
    assert resolved.confidence == classification.confidence
    assert resolved.amount == classification.amount
    assert resolved.merchant_name == classification.merchant_name
    assert resolved.reviewed is True
    assert resolved.classification_origin == "correction_lookup"


# Feature: finance-tracker-expansion, Property 12: Mutation validation and safe
# errors
@PROPERTY_RUNS
@given(
    threshold=st.floats(allow_nan=True, allow_infinity=True).filter(
        lambda value: not (math.isfinite(value) and 0 <= value <= 1)
    )
)
def test_property_12_invalid_review_threshold_is_rejected(threshold: float) -> None:
    """An unusable review threshold makes the dependent service unavailable."""
    with pytest.raises(FinanceConfigurationError):
        load_finance_config({"REVIEW_THRESHOLD": str(threshold)})
