"""The AI service's own logic: model parameters, the history summary, and usage capture.

Nothing here calls OpenAI - the parts under test are the ones that decide WHAT to send.
"""

import pytest

from core.config import settings
from services import ai_service, usage_service


# ---------------- the temperature guard ----------------


@pytest.mark.parametrize(
    "model, expected",
    [
        ("gpt-4o-mini", True),  # the old default still gets its temperature
        ("gpt-4.1", True),
        ("gpt-6-luna", False),  # the reasoning models reject a custom one outright
        ("gpt-5.6-luna", False),
        ("o3", False),
        ("gpt-5-chat-latest", True),  # ...except the chat variants
    ],
)
def test_temperature_is_only_sent_to_models_that_accept_one(monkeypatch, model, expected):
    monkeypatch.setattr(settings, "OPENAI_TEMPERATURE_MODE", "auto")
    assert ai_service._supports_temperature(model) is expected


def test_the_temperature_guard_can_be_overridden(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_TEMPERATURE_MODE", "never")
    assert ai_service._supports_temperature("gpt-4o-mini") is False

    monkeypatch.setattr(settings, "OPENAI_TEMPERATURE_MODE", "always")
    assert ai_service._supports_temperature("gpt-6-luna") is True


def test_the_client_leaves_temperature_out_for_a_reasoning_model(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_MODEL", "gpt-6-luna")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "OPENAI_TEMPERATURE_MODE", "auto")

    llm = ai_service._llm(temperature=0.7)
    # langchain defaults the field to 1 (unset) rather than carrying our 0.7 through
    assert llm.temperature != 0.7
    assert llm.request_timeout == settings.OPENAI_TIMEOUT_SECONDS
    assert llm.max_retries == settings.OPENAI_MAX_RETRIES


def test_the_client_keeps_temperature_for_a_model_that_takes_one(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_MODEL", "gpt-4o-mini")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "OPENAI_TEMPERATURE_MODE", "auto")

    assert ai_service._llm(temperature=0).temperature == 0


# ---------------- the interview history summary ----------------


def test_the_opening_question_gets_no_history():
    context = ai_service.build_interview_context([])
    assert "opening question" in context
    assert "Questions already asked" not in context


def test_the_summary_lists_every_question_but_only_the_recent_answers():
    asked = [
        ("Tell me about a system you built.", "Experience", "I built a booking API in FastAPI."),
        ("How did you handle the load?", "Scalability", "We put Redis in front of the hot reads."),
        ("How do you test it?", "Testing", "Pytest, with a fake database."),
    ]
    context = ai_service.build_interview_context(asked)

    # every question is listed, so the AI cannot ask the same thing twice
    for question, _, _ in asked:
        assert question in context

    # ...but only the last two answers are quoted back, to keep the prompt small
    assert "Redis" in context
    assert "Pytest" in context
    assert "booking API in FastAPI" not in context

    assert "Experience, Scalability, Testing" in context


def test_a_long_answer_is_truncated_in_the_summary():
    long_answer = "word " * 400
    context = ai_service.build_interview_context([("Q?", "Topic", long_answer)])
    assert len(context) < len(long_answer)
    assert "..." in context


def test_a_skipped_answer_is_marked_rather_than_left_blank():
    context = ai_service.build_interview_context([("Q?", "Topic", None)])
    assert "(no answer recorded)" in context


def test_the_summary_does_not_grow_with_every_extra_turn():
    """Ten turns must not cost ten times the prompt - that is the whole point of summarising."""
    answer = "A detailed answer about caching strategies and their trade-offs. " * 10
    short = ai_service.build_interview_context([(f"Question {i}?", f"Topic {i}", answer) for i in range(2)])
    long = ai_service.build_interview_context([(f"Question {i}?", f"Topic {i}", answer) for i in range(10)])

    # the question list grows a line per turn, but the quoted answers do not
    assert len(long) < len(short) * 2


# ---------------- structured calls and usage capture ----------------


class FakeMessage:
    def __init__(self, usage_metadata=None, response_metadata=None):
        self.usage_metadata = usage_metadata
        self.response_metadata = response_metadata or {}


class FakeParsed:
    pass


class FakeStructuredLLM:
    def __init__(self, result):
        self._result = result

    def invoke(self, prompt):
        return self._result


class FakeLLM:
    def __init__(self, result):
        self._result = result

    def with_structured_output(self, schema, include_raw=False):
        return FakeStructuredLLM(self._result)


def test_token_counts_are_recorded_when_the_provider_reports_them(monkeypatch):
    parsed = FakeParsed()
    raw = FakeMessage(usage_metadata={"input_tokens": 1200, "output_tokens": 95})
    monkeypatch.setattr(ai_service, "_llm", lambda temperature=0.7: FakeLLM(
        {"parsed": parsed, "raw": raw, "parsing_error": None}
    ))
    monkeypatch.setattr(settings, "OPENAI_MODEL", "gpt-6-luna")

    usage: list = []
    result = ai_service._invoke_structured(FakeParsed, "prompt", purpose="unit-test", usage=usage)

    assert result is parsed
    assert len(usage) == 1
    assert usage[0].input_tokens == 1200
    assert usage[0].output_tokens == 95
    assert usage[0].model == "gpt-6-luna"
    assert usage[0].purpose == "unit-test"


def test_the_older_token_usage_shape_is_also_read():
    sample = usage_service.sample_from_message(
        FakeMessage(response_metadata={"token_usage": {"prompt_tokens": 10, "completion_tokens": 2}}),
        "gpt-6-luna",
        "unit-test",
    )
    assert sample.input_tokens == 10
    assert sample.output_tokens == 2


def test_a_provider_that_reports_nothing_is_not_guessed_at():
    sample = usage_service.sample_from_message(FakeMessage(), "gpt-6-luna", "unit-test")
    assert sample.input_tokens is None
    assert sample.output_tokens is None


def test_an_unparseable_reply_raises_rather_than_returning_half_an_answer(monkeypatch):
    monkeypatch.setattr(ai_service, "_llm", lambda temperature=0.7: FakeLLM(
        {"parsed": None, "raw": FakeMessage(), "parsing_error": ValueError("not json")}
    ))
    with pytest.raises(ValueError, match="unusable reply"):
        ai_service._invoke_structured(FakeParsed, "prompt")


def test_an_empty_reply_raises(monkeypatch):
    monkeypatch.setattr(ai_service, "_llm", lambda temperature=0.7: FakeLLM(
        {"parsed": None, "raw": FakeMessage(), "parsing_error": None}
    ))
    with pytest.raises(ValueError, match="empty reply"):
        ai_service._invoke_structured(FakeParsed, "prompt")


# ---------------- the cost estimate ----------------


def test_no_cost_is_shown_when_no_rates_are_configured(monkeypatch):
    monkeypatch.setattr(settings, "COST_PER_MILLION_INPUT_TOKENS", 0.0)
    monkeypatch.setattr(settings, "COST_PER_MILLION_OUTPUT_TOKENS", 0.0)
    monkeypatch.setattr(settings, "COST_PER_AUDIO_MINUTE", 0.0)
    assert usage_service.summarise([])["estimated_cost_usd"] is None


def test_the_cost_estimate_uses_the_configured_rates(monkeypatch):
    from models.usage import UsageKind, UsageRecord

    monkeypatch.setattr(settings, "COST_PER_MILLION_INPUT_TOKENS", 2.0)
    monkeypatch.setattr(settings, "COST_PER_MILLION_OUTPUT_TOKENS", 8.0)
    monkeypatch.setattr(settings, "COST_PER_AUDIO_MINUTE", 0.006)

    records = [
        UsageRecord(kind=UsageKind.LLM, model="gpt-6-luna", input_tokens=1_000_000, output_tokens=500_000),
        UsageRecord(kind=UsageKind.TRANSCRIPTION, model="gpt-transcribe", audio_seconds=120),
    ]
    summary = usage_service.summarise(records)

    assert summary["llm_calls"] == 1
    assert summary["transcription_calls"] == 1
    # 1M in at $2 + 0.5M out at $8 + 2 minutes at $0.006
    assert summary["estimated_cost_usd"] == pytest.approx(2.0 + 4.0 + 0.012)
