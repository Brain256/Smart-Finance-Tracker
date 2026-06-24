"""Transaction webhook schemas for the mobile notification ingestion boundary."""

from datetime import UTC, datetime
from enum import Enum

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


class CleanTransaction(BaseModel):
    """Represents a normalized transaction extracted from raw notification text.

    Attributes:
        merchant_name: Human-readable merchant name with branch codes and noisy
            payment processor fragments removed.
        amount: Positive transaction amount in localized dollar units.
        category: Strict transaction category selected from CategoryEnum.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    merchant_name: str = Field(min_length=1)
    amount: float = Field(gt=0)
    category: CategoryEnum


class TransactionWebhook(BaseModel):
    """Represents the exact inbound payload sent from MacroDroid.

    Attributes:
        notification_title: Raw notification title captured from the Android BMO
            notification, expected to contain the establishment name.
        notification_text: Raw notification body captured from the Android BMO
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
        """Converts MacroDroid Unix timestamp values into UTC datetimes.

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
