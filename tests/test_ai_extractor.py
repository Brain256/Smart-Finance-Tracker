"""Unit tests for the AI transaction extraction service boundary."""

import asyncio

import pytest
from openai.types.chat import ChatCompletionMessageParam

from src.schemas.transaction import CategoryEnum, CleanTransaction
from src.services import ai_extractor


class FakeCompletions:
    """Captures structured completion calls made by the extractor service.

    Attributes:
        calls: Completion call keyword payloads captured during the test.
    """

    def __init__(self) -> None:
        """Initializes an empty fake completion call recorder.

        Returns:
            None.
        """
        self.calls: list[dict[str, object]] = []

    async def create(
        self,
        *,
        model: str,
        response_model: type[CleanTransaction],
        messages: list[ChatCompletionMessageParam],
        temperature: int,
        max_retries: int,
    ) -> CleanTransaction:
        """Records extractor arguments and returns a representative transaction.

        Args:
            model: Model name selected for the structured completion call.
            response_model: Pydantic model class requested from Instructor.
            messages: Chat messages sent into the model.
            temperature: Sampling temperature supplied to the model.
            max_retries: Instructor retry budget for schema repair.

        Returns:
            A CleanTransaction matching the expected model output.
        """
        self.calls.append(
            {
                "model": model,
                "response_model": response_model,
                "messages": messages,
                "temperature": temperature,
                "max_retries": max_retries,
            }
        )

        return CleanTransaction(
            merchant_name="Tim Hortons",
            amount=14.50,
            category=CategoryEnum.FOOD,
        )


class FakeChat:
    """Provides the nested chat completion surface expected by Instructor.

    Attributes:
        completions: Fake completion recorder used by the test.
    """

    def __init__(self, completions: FakeCompletions) -> None:
        """Attaches a fake completions object to the chat namespace.

        Args:
            completions: Fake completion recorder used by the test.

        Returns:
            None.
        """
        self.completions = completions


class FakeInstructorClient:
    """Provides the minimal Instructor client surface consumed by the service.

    Attributes:
        chat: Fake chat namespace containing the completion recorder.
    """

    def __init__(self, completions: FakeCompletions) -> None:
        """Builds a fake client around a fake completion recorder.

        Args:
            completions: Fake completion recorder used by the test.

        Returns:
            None.
        """
        self.chat = FakeChat(completions)


def test_extract_transaction_entities_requests_clean_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies the extractor calls Instructor with the strict DTO schema.

    Args:
        monkeypatch: Pytest fixture used to isolate environment and client setup.

    Returns:
        None.
    """
    completions = FakeCompletions()
    fake_client = FakeInstructorClient(completions)

    monkeypatch.setenv("GROQ_MODEL", "test-model")
    monkeypatch.setattr(ai_extractor, "_build_instructor_client", lambda: fake_client)

    transaction = asyncio.run(
        ai_extractor.extract_transaction_entities(
            "BMO Credit Card: Approved $14.50 at TIM HORTONS #4920"
        )
    )

    assert transaction == CleanTransaction(
        merchant_name="Tim Hortons",
        amount=14.50,
        category=CategoryEnum.FOOD,
    )
    assert len(completions.calls) == 1

    call = completions.calls[0]
    assert call["model"] == "test-model"
    assert call["response_model"] is CleanTransaction
    assert call["temperature"] == 0
    assert call["max_retries"] == 2

    messages = call["messages"]
    assert isinstance(messages, list)
    assert messages[0]["role"] == "system"
    assert "TIM HORTONS #4920" in str(messages[0]["content"])
    assert messages[1] == {
        "role": "user",
        "content": "BMO Credit Card: Approved $14.50 at TIM HORTONS #4920",
    }
