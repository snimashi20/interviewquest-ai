from datetime import datetime
from typing import List

from pydantic import BaseModel, ConfigDict, Field

from schemas.question import QuestionResponse


class InterviewCreate(BaseModel):
    role: str = Field(min_length=1)
    difficulty: str = Field(min_length=1)


class InterviewCreateResponse(BaseModel):
    interview_id: int
    job_id: str


class InterviewSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    difficulty: str
    status: str
    created_at: datetime


class InterviewResponse(InterviewSummary):
    questions: List[QuestionResponse] = []
