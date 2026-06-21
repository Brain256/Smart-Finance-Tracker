"""Transaction webhook schemas for the mobile notification ingestion boundary."""

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TransactionWebhook(BaseModel):
    """Represents the exact inbound payload sent from MacroDroid.

    Attributes:
        notification_text: Raw notification body captured from the Android BMO
            notification.
        timestamp: Timestamp attached to the captured notification. Accepts ISO
            8601 datetimes, Unix seconds, or Unix milliseconds.

    Raises:
        ValueError: If timestamp is not timezone-aware or cannot be normalized.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

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
