"""Bearer-token security gate for inbound mobile webhook calls."""

import os
from hmac import compare_digest
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security_scheme = HTTPBearer(auto_error=False)


async def verify_api_key(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(security_scheme),
    ],
) -> None:
    """Validates the inbound static bearer token against environment secrets.

    Args:
        credentials: The HTTP bearer credentials parsed from the Authorization
            header by FastAPI's security dependency.

    Returns:
        None when the token is present and matches the configured secret.

    Raises:
        HTTPException: If the secret is not configured or the inbound token is
            missing, malformed, or invalid.
    """
    load_dotenv()
    expected_token = os.getenv("INBOUND_SECRET_TOKEN")

    if expected_token is None or expected_token == "":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Inbound token is not configured.",
        )

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )

    # Constant-time comparison avoids leaking token mismatch position details.
    if not compare_digest(credentials.credentials, expected_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bearer token.",
        )
