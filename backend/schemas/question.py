from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from schemas.answer import AnswerResponse


# what we send back to the frontend to describe one question
class QuestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    interview_id: int
    question_text: str
    topic: Optional[str] = None
    question_number: int
    kind: str = "THEORY"  # THEORY (type an answer) or CODING (use the code workspace)
    language: Optional[str] = None  # coding tasks only: "python" or "javascript"
    starter_code: Optional[str] = None  # coding tasks only: what the editor opens with
    # the ideal answer. the router blanks this out until the student has submitted their own,
    # so it cannot be read ahead of time from the network tab
    model_answer: Optional[str] = None
    is_followup: bool = False  # true when this question came out of the previous answer
    created_at: datetime
    answer: Optional[AnswerResponse] = None  # filled in once the student answers


# this shape tells the AI exactly what fields to return - used with with_structured_output()
class GeneratedQuestion(BaseModel):
    """Structured output requested from the LLM for a single question."""

    question: str
    topic: str = Field(description="Short topic/category label for the question, e.g. 'Operating Systems'")


# the AI writes the whole interview in one call, so we ask for a list of them
class GeneratedQuestionSet(BaseModel):
    """Structured output requested from the LLM when generating a full interview."""

    questions: List[GeneratedQuestion]


# what the AI returns for ONE question in an adaptive interview, where questions are written
# one at a time off the back of the last answer rather than all at once
class GeneratedNextQuestion(BaseModel):
    """Structured output requested from the LLM for the next question of a live interview."""

    question: str = Field(description="The single next question to ask, as plain spoken English")
    topic: str = Field(description="Short topic/category label for the question, e.g. 'System Design'")
    is_followup: bool = Field(
        default=False,
        description="True if this probes the candidate's previous answer, false if it opens new ground",
    )


# a practice question carries more than an interview question: it knows whether it is a
# coding task, and it comes with the model answer already written
class GeneratedPracticeQuestion(BaseModel):
    """Structured output requested from the LLM for a single practice question."""

    question: str = Field(description="The question or coding task, including any examples the student needs")
    topic: str = Field(description="Short label for the specific thing being tested, e.g. 'Sliding window'")
    kind: str = Field(description="'THEORY' for a written answer, 'CODING' for a programming task")
    language: Optional[str] = Field(
        default=None,
        description="Coding tasks only: 'python' or 'javascript'. Leave empty for theory questions.",
    )
    starter_code: Optional[str] = Field(
        default=None,
        description="Coding tasks only: a short stub with the function signature the student fills in.",
    )
    model_answer: str = Field(
        description="The complete, ideal answer. For a coding task, working code plus its complexity."
    )


# the AI writes the whole practice set in one call
class GeneratedPracticeSet(BaseModel):
    """Structured output requested from the LLM when generating a practice set."""

    questions: List[GeneratedPracticeQuestion]
