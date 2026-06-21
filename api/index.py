"""FastAPI serverless entrypoint for the transaction ingestion gateway."""

from fastapi import Depends, FastAPI, status

from src.core.security import verify_api_key
from src.schemas.gateway import HealthResponse, IngestAcceptedResponse
from src.schemas.transaction import TransactionWebhook

app = FastAPI(
    title="Smart Finance Tracker API",
    version="0.1.0",
)


@app.get(
    "/api/v1/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
)
async def health_check() -> HealthResponse:
    """Returns the current gateway liveness status.

    Returns:
        A HealthResponse confirming the FastAPI serverless app is reachable.
    """
    return HealthResponse(status="healthy")


@app.post(
    "/api/v1/ingest",
    response_model=IngestAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_transaction_notification(
    payload: TransactionWebhook,
    _verified_token: None = Depends(verify_api_key),
) -> IngestAcceptedResponse:
    """Accepts a raw mobile banking notification after security validation.

    Args:
        payload: The exact MacroDroid webhook payload containing notification text
            and the original notification timestamp.
        _verified_token: Dependency marker confirming the caller supplied the
            configured pre-shared bearer token.

    Returns:
        An IngestAcceptedResponse confirming the validated payload reached the
        ingestion boundary.
    """
    return IngestAcceptedResponse(status="accepted", timestamp=payload.timestamp)
