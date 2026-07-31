"""Validated finance settings shared by FastAPI server code."""

import math
import os
from collections.abc import Mapping
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv

DEFAULT_FINANCE_TIMEZONE = "America/Toronto"
DEFAULT_REVIEW_THRESHOLD = 0.70


class FinanceConfigurationError(ValueError):
    """Raised when a finance environment setting cannot be used safely."""


@dataclass(frozen=True)
class FinanceConfig:
    """Represents validated finance settings required by server operations."""

    finance_timezone: str
    review_threshold: float


def load_finance_config(
    environment: Mapping[str, str] | None = None,
) -> FinanceConfig:
    """Parses and validates finance settings from an environment mapping.

    Args:
        environment: Environment values to parse, or the process environment.

    Returns:
        A FinanceConfig with a valid IANA timezone and review threshold.

    Raises:
        FinanceConfigurationError: If a supplied setting is invalid.
    """
    if environment is None:
        load_dotenv()
        environment = os.environ

    timezone = environment.get("FINANCE_TIMEZONE", DEFAULT_FINANCE_TIMEZONE).strip()
    if not timezone:
        raise FinanceConfigurationError(
            "FINANCE_TIMEZONE must be a valid IANA timezone, such as America/Toronto."
        )

    try:
        ZoneInfo(timezone)
    except (ValueError, ZoneInfoNotFoundError) as error:
        raise FinanceConfigurationError(
            "FINANCE_TIMEZONE must be a valid IANA timezone, such as America/Toronto."
        ) from error

    threshold_value = environment.get("REVIEW_THRESHOLD", str(DEFAULT_REVIEW_THRESHOLD))
    try:
        review_threshold = float(threshold_value.strip())
    except ValueError as error:
        raise FinanceConfigurationError(
            "REVIEW_THRESHOLD must be a finite number from 0 through 1."
        ) from error

    if not math.isfinite(review_threshold) or not 0 <= review_threshold <= 1:
        raise FinanceConfigurationError(
            "REVIEW_THRESHOLD must be a finite number from 0 through 1."
        )

    return FinanceConfig(timezone, review_threshold)
