"""FastAPI serverless entrypoint for the transaction ingestion gateway."""

import logging
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, HTTPException, Response, status
from pydantic import ValidationError

from src.core.database import (
    TransactionPersistenceStatus,
    resolve_latest_correction,
    upsert_expense_transaction,
)
from src.core.finance_config import FinanceConfigurationError, load_finance_config
from src.core.security import verify_api_key
from src.schemas.gateway import HealthResponse, IngestAcceptedResponse
from src.schemas.transaction import LlmClassification, ResolvedTransaction, TransactionWebhook
from src.services.ai_extractor import extract_transaction_entities

log = logging.getLogger("uvicorn.error")
SAFE_INGESTION_ERROR = "Transaction ingestion is temporarily unavailable."
SAFE_CLASSIFICATION_ERROR = "Transaction classification could not be validated."

app = FastAPI(
    title="Smart Finance Tracker API",
    version="0.1.0",
)


def resolve_transaction(
    classification: LlmClassification,
    corrected_category: object,
    review_threshold: float,
) -> ResolvedTransaction:
    """Applies correction lookup or confidence-based review to an LLM result."""
    if corrected_category is not None:
        return ResolvedTransaction(
            merchant_name=classification.merchant_name,
            amount=classification.amount,
            category=corrected_category,
            confidence=classification.confidence,
            reviewed=True,
            classification_origin="correction_lookup",
        )

    return ResolvedTransaction(
        merchant_name=classification.merchant_name,
        amount=classification.amount,
        category=classification.category,
        confidence=classification.confidence,
        reviewed=classification.confidence >= review_threshold,
        classification_origin="llm",
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
    """Classifies, resolves, and persists a signed banking notification.

    Sensitive notification content, merchant details, amounts, provider output,
    and credentials are deliberately excluded from all route logs.
    """
    try:
        finance_config = load_finance_config()
    except FinanceConfigurationError:
        log.warning("Ingestion failed: error_code=configuration_invalid")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=SAFE_INGESTION_ERROR,
        ) from None

    try:
        raw_classification = await extract_transaction_entities(
            payload.notification_title,
            payload.notification_text,
        )
        classification = LlmClassification.model_validate(raw_classification)
    except (ValidationError, ValueError, TypeError):
        log.warning("Ingestion failed: error_code=classification_invalid")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=SAFE_CLASSIFICATION_ERROR,
        ) from None
    except Exception:
        log.warning("Ingestion failed: error_code=classification_unavailable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=SAFE_INGESTION_ERROR,
        ) from None

    try:
        corrected_category = await resolve_latest_correction(classification.merchant_name)
    except Exception:
        log.warning("Ingestion failed: error_code=correction_lookup_unavailable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=SAFE_INGESTION_ERROR,
        ) from None

    resolved_transaction = resolve_transaction(
        classification,
        corrected_category,
        finance_config.review_threshold,
    )
    classified_at = datetime.now(UTC)

    try:
        persistence_status = await upsert_expense_transaction(
            resolved_transaction,
            payload.timestamp,
            classified_at,
        )
    except Exception:
        log.warning("Ingestion failed: error_code=persistence_unavailable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=SAFE_INGESTION_ERROR,
        ) from None

    log.info(
        "Ingestion completed: status=%s origin=%s reviewed=%s confidence_bucket=%s",
        persistence_status.value,
        resolved_transaction.classification_origin,
        resolved_transaction.reviewed,
        "high" if resolved_transaction.confidence >= finance_config.review_threshold else "low",
    )

    if persistence_status is TransactionPersistenceStatus.DUPLICATE:
        response.status_code = status.HTTP_200_OK

    return IngestAcceptedResponse(
        status="accepted",
        timestamp=payload.timestamp,
        transaction=resolved_transaction,
    )
