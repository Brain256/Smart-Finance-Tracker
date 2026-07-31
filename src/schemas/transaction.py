"""Transaction webhook schemas for the mobile notification ingestion boundary."""

from datetime import UTC, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CategoryEnum(str, Enum):
    """Defines the only supported transaction categories for storage.

    Attributes:
        FOOD: Food purchases, cafes, groceries, and restaurants.
        TRANSPORT: Transit, ride share, fuel, and parking charges.
        ENTERTAINMENT: Media, events, subscriptions, and leisure purchases.
        BILLS: Recurring utilities, phone, insurance, and fixed obligations.
        SHOPPING: Retail, ecommerce, and discretionary goods purchases.
        INCOME: Deposits, payroll, refunds, and other inbound money events.
        MISCELLANEOUS: Transactions that do not confidently fit another bucket.
    """

    FOOD = "Food"
    TRANSPORT = "Transport"
    ENTERTAINMENT = "Entertainment"
    BILLS = "Bills"
    SHOPPING = "Shopping"
    INCOME = "Income"
    MISCELLANEOUS = "Miscellaneous"


class LlmClassification(BaseModel):
    """Represents the validated category proposal returned by the LLM.

    Confidence measures certainty that ``category`` is correct for the
    normalized merchant and notification event. It does not measure confidence
    in amount parsing or overall response quality.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    merchant_name: str = Field(min_length=1)
    amount: float = Field(gt=0)
    category: CategoryEnum
    confidence: float = Field(
        ge=0,
        le=1,
        allow_inf_nan=False,
        description=(
            "LLM certainty from 0 through 1 that the selected category is "
            "correct for this merchant and transaction event."
        ),
    )


class ResolvedTransaction(LlmClassification):
    """Represents an LLM classification after category-resolution metadata.

    A correction lookup may replace ``category`` while retaining the original
    LLM ``confidence``. The resolution process records both whether review is
    complete and which source supplied the stored category.
    """

    reviewed: bool
    classification_origin: Literal["llm", "correction_lookup"]


# Preserve the original public DTO name for existing callers until they migrate
# to the explicit LlmClassification name.
CleanTransaction = LlmClassification


class TransactionWebhook(BaseModel):
    """Represents the exact inbound payload sent from the Android client.

    Attributes:
        notification_title: Raw notification title captured from the Google
            Wallet notification, expected to contain the establishment name.
        notification_text: Raw notification body captured from the Google Wallet
            notification, expected to contain the card and amount details.
        timestamp: Timestamp attached to the captured notification. Accepts ISO
            8601 datetimes, Unix seconds, or Unix milliseconds.

    Raises:
        ValueError: If timestamp is not timezone-aware or cannot be normalized.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    notification_title: str = Field(min_length=1)
    notification_text: str = Field(min_length=1)
    timestamp: datetime

    @field_validator("timestamp", mode="before")
    @classmethod
    def normalize_unix_timestamp(cls, value: object) -> object:
        """Converts inbound Unix timestamp values into UTC datetimes.

        Args:
            value: Raw inbound timestamp value before Pydantic datetime parsing.

        Returns:
            The original value for standard datetime parsing, or a UTC datetime
            when the inbound value is a Unix timestamp.

        Raises:
            ValueError: If a numeric timestamp cannot be converted.
        """
        if isinstance(value, bool):
            return value

        if isinstance(value, int | float):
            return cls._datetime_from_unix_timestamp(float(value))

        if isinstance(value, str):
            stripped_value = value.strip()

            if stripped_value.isdecimal():
                return cls._datetime_from_unix_timestamp(float(stripped_value))

        return value

    @field_validator("timestamp")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        """Ensures incoming notification timestamps include timezone context.

        Args:
            value: Parsed datetime supplied in the inbound webhook body.

        Returns:
            The same datetime after timezone validation succeeds.

        Raises:
            ValueError: If the timestamp omits timezone information.
        """
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            raise ValueError("timestamp must be timezone-aware")

        return value

    @staticmethod
    def _datetime_from_unix_timestamp(timestamp: float) -> datetime:
        """Builds a timezone-aware UTC datetime from Unix seconds or milliseconds.

        Args:
            timestamp: Unix timestamp represented in seconds or milliseconds.

        Returns:
            A timezone-aware UTC datetime.

        Raises:
            ValueError: If the Unix timestamp is outside datetime's valid range.
        """
        timestamp_in_seconds = (
            timestamp / 1000 if timestamp >= 10_000_000_000 else timestamp
        )

        try:
            return datetime.fromtimestamp(timestamp_in_seconds, tz=UTC)
        except (OSError, OverflowError) as error:
            raise ValueError("timestamp must be a valid Unix timestamp") from error
