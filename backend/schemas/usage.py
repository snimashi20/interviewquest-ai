from typing import Optional

from pydantic import BaseModel


# the optional "what did this interview cost" summary.
#
# these are the numbers the providers reported for this interview's calls, plus an estimate
# worked out from the rates in .env. it is an estimate for the student's own awareness - it
# is not a bill, and estimated_cost_usd stays null when no rates are configured
class UsageSummary(BaseModel):
    interview_id: int
    llm_calls: int
    transcription_calls: int
    input_tokens: int
    output_tokens: int
    audio_seconds: float
    text_model: str
    transcription_model: str
    estimated_cost_usd: Optional[float] = None
