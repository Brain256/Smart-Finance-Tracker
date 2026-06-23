"""Exports Pydantic DTO schemas into the root schema.json blueprint."""

import json
import sys
from pathlib import Path

from pydantic import TypeAdapter

ROOT_DIR = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT_DIR / "schema.json"

sys.path.insert(0, str(ROOT_DIR))

from src.schemas.transaction import (  # noqa: E402
    CategoryEnum,
    CleanTransaction,
    TransactionWebhook,
)


def build_schema_blueprint() -> dict[str, object]:
    """Builds the JSON schema blueprint for indexed project contracts.

    Returns:
        A JSON-serializable mapping containing the current transaction schemas.
    """
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Smart Finance Tracker Data Contracts",
        "schemas": {
            "CategoryEnum": TypeAdapter(CategoryEnum).json_schema(),
            "CleanTransaction": CleanTransaction.model_json_schema(),
            "TransactionWebhook": TransactionWebhook.model_json_schema(),
        },
    }


def main() -> None:
    """Writes schema.json to the repository root.

    Returns:
        None.
    """
    SCHEMA_PATH.write_text(
        json.dumps(build_schema_blueprint(), indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
