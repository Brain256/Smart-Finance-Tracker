"""AI-backed transaction entity extraction service."""

import os
from typing import Final

import instructor
from dotenv import load_dotenv
from instructor import AsyncInstructor
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from src.schemas.transaction import CleanTransaction

GROQ_BASE_URL: Final[str] = "https://api.groq.com/openai/v1"
DEFAULT_GROQ_MODEL: Final[str] = "llama-3.3-70b-versatile"

SYSTEM_PROMPT: Final[str] = """
You are a strict banking notification compiler for a personal finance tracker.
Extract only one transaction from the raw mobile banking notification.

Rules:
- Return data matching the requested schema exactly.
- Normalize merchant_name into a clean title-cased merchant brand or payer name.
- Remove store numbers, terminal IDs, approval words, card names, dates, and cities.
- Convert merchant examples like "TIM HORTONS #4920" to "Tim Hortons".
- Use the absolute dollar value shown in the notification for amount.
- Select exactly one category from the allowed enum values.
- Use "Income" only for deposits, payroll, refunds, credits, or received funds.
- Use "Miscellaneous" when the merchant or category is genuinely ambiguous.
""".strip()


def _build_instructor_client() -> AsyncInstructor:
    """Builds an Instructor-patched async OpenAI-compatible Groq client.

    Returns:
        An AsyncInstructor client configured for structured chat completions.

    Raises:
        RuntimeError: If GROQ_API_KEY is not configured in the environment.
    """
    load_dotenv()
    api_key = os.getenv("GROQ_API_KEY")

    if api_key is None or api_key == "":
        raise RuntimeError("GROQ_API_KEY is not configured.")

    openai_client = AsyncOpenAI(api_key=api_key, base_url=GROQ_BASE_URL)

    # Instructor enforces the CleanTransaction response schema at the client edge.
    return instructor.from_openai(openai_client)


def _get_model_name() -> str:
    """Resolves the configured Groq model name for extraction calls.

    Returns:
        The configured GROQ_MODEL value, or the project default model name.
    """
    load_dotenv()

    return os.getenv("GROQ_MODEL", DEFAULT_GROQ_MODEL)


def _build_extraction_messages(raw_text: str) -> list[ChatCompletionMessageParam]:
    """Creates the chat messages used by the entity extraction model.

    Args:
        raw_text: Unstructured mobile banking notification text.

    Returns:
        A list of chat messages ready for the OpenAI-compatible API.
    """
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": raw_text},
    ]


async def extract_transaction_entities(raw_text: str) -> CleanTransaction:
    """Extracts normalized transaction entities from raw notification text.

    Args:
        raw_text: Unstructured mobile banking notification text captured from
            MacroDroid.

    Returns:
        A CleanTransaction object validated against the internal DTO schema.

    Raises:
        RuntimeError: If the Groq API key is not configured.
        Exception: If the upstream model request or schema validation fails.
    """
    client = _build_instructor_client()

    return await client.chat.completions.create(
        model=_get_model_name(),
        response_model=CleanTransaction,
        messages=_build_extraction_messages(raw_text),
        temperature=0,
        max_retries=2,
    )
