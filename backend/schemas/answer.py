from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from models.answer import AnswerSource

VALID_SOURCES = (AnswerSource.TYPED, AnswerSource.SPOKEN)


# what the frontend sends us when the student submits an answer.
# source/audio_seconds/transcript_edited are optional, so the original text-only call
# ({"answer_text": "..."}) still works exactly as it did
class AnswerCreate(BaseModel):
    answer_text: str = Field(min_length=1)
    source: str = AnswerSource.TYPED  # TYPED or SPOKEN
    audio_seconds: Optional[float] = Field(default=None, ge=0)  # spoken answers only
    transcript_edited: bool = False  # whether the candidate corrected the transcript

    @field_validator("source")
    @classmethod
    def check_source(cls, value: str) -> str:
        if value not in VALID_SOURCES:
            raise ValueError(f"source must be one of {', '.join(VALID_SOURCES)}")
        return value

    @field_validator("answer_text")
    @classmethod
    def check_not_blank(cls, value: str) -> str:
        # a transcript of silence is whitespace, and silence is not an answer
        if not value.strip():
            raise ValueError("answer_text cannot be blank")
        return value


# what we send back to describe a stored answer (with grading, once it's done)
class AnswerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question_id: int
    answer_text: str
    score: Optional[int] = None  # stays null until the AI grades it
    feedback: Optional[str] = None
    strengths: Optional[List[str]] = None
    improvements: Optional[List[str]] = None
    source: str = AnswerSource.TYPED  # TYPED or SPOKEN
    audio_seconds: Optional[float] = None
    transcript_edited: bool = False
    created_at: datetime


# this shape tells the AI exactly what fields to return when grading an answer
class AnswerEvaluation(BaseModel):
    """Structured output requested from the LLM when evaluating an answer."""

    score: int = Field(ge=0, le=100)  # ge/le = greater/less than or equal, keeps the score between 0 and 100
    feedback: str
    strengths: List[str]
    improvements: List[str]
