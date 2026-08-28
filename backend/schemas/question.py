from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from schemas.answer import AnswerResponse


class QuestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    interview_id: int
    question_text: str
    topic: Optional[str] = None
    question_number: int
    created_at: datetime
    answer: Optional[AnswerResponse] = None


class GeneratedQuestion(BaseModel):
    """Structured output requested from the LLM when generating a question."""

    question: str
    topic: str = Field(description="Short topic/category label for the question, e.g. 'Operating Systems'")
