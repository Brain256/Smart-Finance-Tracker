"""Gateway response schemas for health and ingestion acknowledgement routes."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    """Represents the liveness response returned by the health endpoint.

    Attributes:
        status: Static liveness marker emitted when the API is reachable.
    """

    model_config = ConfigDict(extra="forbid")

    status: Literal["healthy"]


class IngestAcceptedResponse(BaseModel):
    """Represents acknowledgement that a notification passed the ingest gate.

    Attributes:
        status: Static acceptance marker for successfully validated requests.
        timestamp: The parsed notification timestamp received from the phone.
    """

    model_config = ConfigDict(extra="forbid")

    status: Literal["accepted"]
    timestamp: datetime
