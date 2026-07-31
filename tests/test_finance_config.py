"""Tests for validated server-side finance configuration."""

import pytest

from src.core.finance_config import (
    DEFAULT_FINANCE_TIMEZONE,
    DEFAULT_REVIEW_THRESHOLD,
    FinanceConfigurationError,
    load_finance_config,
)


def test_load_finance_config_uses_documented_defaults() -> None:
    """Uses safe defaults when finance settings are absent."""
    assert load_finance_config({}).finance_timezone == DEFAULT_FINANCE_TIMEZONE
    assert load_finance_config({}).review_threshold == DEFAULT_REVIEW_THRESHOLD


def test_load_finance_config_accepts_valid_explicit_values() -> None:
    """Accepts an IANA timezone and review-threshold boundaries."""
    configuration = load_finance_config(
        {"FINANCE_TIMEZONE": "Europe/London", "REVIEW_THRESHOLD": "1"}
    )

    assert configuration.finance_timezone == "Europe/London"
    assert configuration.review_threshold == 1.0


@pytest.mark.parametrize("timezone", ["", "Not/AZone"])
def test_load_finance_config_rejects_invalid_timezones(timezone: str) -> None:
    """Returns an actionable error for malformed timezone configuration."""
    with pytest.raises(FinanceConfigurationError, match="FINANCE_TIMEZONE"):
        load_finance_config({"FINANCE_TIMEZONE": timezone})


@pytest.mark.parametrize("threshold", ["", "-0.01", "1.01", "NaN", "Infinity", "invalid"])
def test_load_finance_config_rejects_invalid_thresholds(threshold: str) -> None:
    """Returns an actionable error for non-finite or out-of-range thresholds."""
    with pytest.raises(FinanceConfigurationError, match="REVIEW_THRESHOLD"):
        load_finance_config({"REVIEW_THRESHOLD": threshold})
