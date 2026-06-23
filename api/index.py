"""FastAPI serverless entrypoint for the transaction ingestion gateway."""

import logging

from fastapi import Depends, FastAPI, Response, status

from src.core.database import TransactionPersistenceStatus, upsert_expense_transaction
from src.core.security import verify_api_key
from src.schemas.gateway import HealthResponse, IngestAcceptedResponse
from src.schemas.transaction import TransactionWebhook
from src.services.ai_extractor import extract_transaction_entities

log = logging.getLogger("uvicorn.error")

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
    response: Response,
    _verified_token: None = Depends(verify_api_key),
) -> IngestAcceptedResponse:
    """Extracts a structured transaction from a signed banking notification.

    Args:
        payload: The exact MacroDroid webhook payload containing notification text
            and the original notification timestamp.
        response: Mutable FastAPI response used to mark duplicate retries as OK.
        _verified_token: Dependency marker confirming the caller supplied the
            configured pre-shared bearer token.

    Returns:
        An IngestAcceptedResponse containing the normalized extracted transaction.
    """
    clean_transaction = await extract_transaction_entities(payload.notification_text)
    log.info("Extracted transaction: %s", clean_transaction.model_dump_json())
    persistence_status = await upsert_expense_transaction(
        clean_transaction,
        payload.timestamp,
    )
    log.info(
        "Transaction persistence completed: status=%s timestamp=%s",
        persistence_status.value,
        payload.timestamp.isoformat(),
    )

    if persistence_status is TransactionPersistenceStatus.DUPLICATE:
        response.status_code = status.HTTP_200_OK

    return IngestAcceptedResponse(
        status="accepted",
        timestamp=payload.timestamp,
        transaction=clean_transaction,
    )
