"""Recording and summarising what the AI calls cost.

Numbers only - never a prompt, an answer or any audio. The point is that the student can see
roughly what an interview spent without us pretending to be the OpenAI bill.
"""

from dataclasses import dataclass
from typing import Optional

from core.config import settings
from models.usage import UsageKind, UsageRecord


# what one AI call reported back, passed around before it is written to the database.
# a provider that doesn't report token counts just leaves them as None
@dataclass
class UsageSample:
    kind: str
    model: str
    purpose: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    audio_seconds: Optional[float] = None


# writes one usage row. deliberately swallows its own errors: a failed usage write must never
# be the reason an interview question or a grade is lost
def record(db, sample: UsageSample, interview_id: Optional[int] = None) -> None:
    if sample is None:
        return
    try:
        db.add(
            UsageRecord(
                interview_id=interview_id,
                kind=sample.kind,
                model=sample.model,
                purpose=sample.purpose,
                input_tokens=sample.input_tokens,
                output_tokens=sample.output_tokens,
                audio_seconds=sample.audio_seconds,
            )
        )
        db.flush()
    except Exception:  # noqa: BLE001 - accounting is not worth failing a request over
        pass


# pulls the token counts out of whatever LangChain handed back. the shape differs between
# providers and versions, so anything unexpected just means "no numbers reported"
def sample_from_message(message, model: str, purpose: str) -> UsageSample:
    input_tokens = None
    output_tokens = None

    metadata = getattr(message, "usage_metadata", None) or {}
    if isinstance(metadata, dict):
        input_tokens = metadata.get("input_tokens")
        output_tokens = metadata.get("output_tokens")

    if input_tokens is None and output_tokens is None:
        # older/alternative shape: response_metadata["token_usage"]
        response_metadata = getattr(message, "response_metadata", None) or {}
        token_usage = response_metadata.get("token_usage") or {}
        input_tokens = token_usage.get("prompt_tokens")
        output_tokens = token_usage.get("completion_tokens")

    return UsageSample(
        kind=UsageKind.LLM,
        model=model,
        purpose=purpose,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


# adds every row for one interview up into the summary the results page shows.
# the cost is an estimate from the rates in .env, and is left as None when those rates
# are not configured - a made-up number would be worse than no number
def summarise(records: list[UsageRecord]) -> dict:
    input_tokens = sum(record.input_tokens or 0 for record in records)
    output_tokens = sum(record.output_tokens or 0 for record in records)
    audio_seconds = sum(record.audio_seconds or 0.0 for record in records)

    llm_calls = sum(1 for record in records if record.kind == UsageKind.LLM)
    transcription_calls = sum(1 for record in records if record.kind == UsageKind.TRANSCRIPTION)

    rates_configured = any(
        (
            settings.COST_PER_MILLION_INPUT_TOKENS,
            settings.COST_PER_MILLION_OUTPUT_TOKENS,
            settings.COST_PER_AUDIO_MINUTE,
        )
    )
    estimated_cost_usd = None
    if rates_configured:
        estimated_cost_usd = round(
            input_tokens / 1_000_000 * settings.COST_PER_MILLION_INPUT_TOKENS
            + output_tokens / 1_000_000 * settings.COST_PER_MILLION_OUTPUT_TOKENS
            + audio_seconds / 60 * settings.COST_PER_AUDIO_MINUTE,
            4,
        )

    return {
        "llm_calls": llm_calls,
        "transcription_calls": transcription_calls,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "audio_seconds": round(audio_seconds, 1),
        "text_model": settings.OPENAI_MODEL,
        "transcription_model": settings.OPENAI_TRANSCRIPTION_MODEL,
        "estimated_cost_usd": estimated_cost_usd,
    }
