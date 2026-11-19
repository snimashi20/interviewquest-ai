from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from models.interview import InterviewMode, InterviewType, QuestionFlow, QuestionStyle
from schemas.question import QuestionResponse

# an interview is between 1 and 15 questions long. the form offers 5, 10 and 15, but any
# count in this range is accepted so the practice sets (and older saved links) keep working
MIN_QUESTION_COUNT = 1
MAX_QUESTION_COUNT = 15

VALID_MODES = (InterviewMode.INTERVIEW, InterviewMode.PRACTICE)
VALID_QUESTION_STYLES = (QuestionStyle.THEORY, QuestionStyle.CODING, QuestionStyle.MIXED)
VALID_INTERVIEW_TYPES = (InterviewType.TEXT, InterviewType.VOICE)
VALID_QUESTION_FLOWS = (QuestionFlow.BATCH, QuestionFlow.ADAPTIVE)


# what the frontend sends us when starting a new interview or practice set
class InterviewCreate(BaseModel):
    role: str = Field(min_length=1)
    difficulty: str = Field(min_length=1)
    # optional: when set, the questions are written from this CV instead of being generic
    cv_id: Optional[int] = None
    question_count: int = Field(default=5, ge=MIN_QUESTION_COUNT, le=MAX_QUESTION_COUNT)

    # ---- voice interview ----
    # TEXT (type the answers) or VOICE (spoken, read aloud and transcribed). defaults to TEXT
    # so an older frontend posting the original payload still gets the original experience
    interview_type: str = InterviewType.TEXT
    # BATCH writes every question up front (the original behaviour), ADAPTIVE writes them one
    # at a time so the interviewer can follow up. left unset, a voice interview picks
    # ADAPTIVE and a text interview picks BATCH
    question_flow: Optional[str] = None

    # ---- practice mode ----
    mode: str = InterviewMode.INTERVIEW
    practice_topic: Optional[str] = None  # e.g. "Data Structures & Algorithms"
    practice_focus: Optional[str] = None  # e.g. "Binary search & its boundary conditions"
    question_style: str = QuestionStyle.THEORY

    # checks the combination makes sense before anything is written to the database
    @model_validator(mode="after")
    def check_mode(self):
        if self.interview_type not in VALID_INTERVIEW_TYPES:
            raise ValueError(f"interview_type must be one of {', '.join(VALID_INTERVIEW_TYPES)}")

        # fill in the default flow for whichever kind of interview this is
        if self.question_flow is None:
            self.question_flow = (
                QuestionFlow.ADAPTIVE if self.interview_type == InterviewType.VOICE else QuestionFlow.BATCH
            )
        if self.question_flow not in VALID_QUESTION_FLOWS:
            raise ValueError(f"question_flow must be one of {', '.join(VALID_QUESTION_FLOWS)}")

        if self.mode not in VALID_MODES:
            raise ValueError(f"mode must be one of {', '.join(VALID_MODES)}")
        if self.question_style not in VALID_QUESTION_STYLES:
            raise ValueError(f"question_style must be one of {', '.join(VALID_QUESTION_STYLES)}")
        if self.mode == InterviewMode.PRACTICE and not (self.practice_topic or "").strip():
            raise ValueError("practice_topic is required when mode is PRACTICE")
        # a mock interview is always written answers - coding tasks live in practice mode
        if self.mode == InterviewMode.INTERVIEW and self.question_style != QuestionStyle.THEORY:
            raise ValueError("question_style can only be set on a PRACTICE session")
        # a practice set is a written drill with model answers - it has no spoken flow
        if self.mode == InterviewMode.PRACTICE and self.interview_type != InterviewType.TEXT:
            raise ValueError("interview_type must be TEXT for a PRACTICE session")
        if self.mode == InterviewMode.PRACTICE and self.question_flow != QuestionFlow.BATCH:
            raise ValueError("question_flow must be BATCH for a PRACTICE session")
        return self


# what we send back right after creating the interview (before the questions exist yet)
class InterviewCreateResponse(BaseModel):
    interview_id: int
    job_id: str  # the frontend polls this job to know when the questions are ready


# what POST /api/interviews/{id}/next-question sends back.
#   question_ready=True  - a question is already on the table, just fetch the interview
#   job_id set           - the next question is being written; poll this job
class NextQuestionResponse(BaseModel):
    job_id: Optional[str] = None
    question_ready: bool = False


# a short version of an interview, used in the history list
class InterviewSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # lets pydantic read straight from the SQLAlchemy model

    id: int
    role: str
    difficulty: str
    status: str
    cv_id: Optional[int] = None
    question_count: int
    overall_score: Optional[int] = None  # average of the answers graded so far
    mode: str = InterviewMode.INTERVIEW
    practice_topic: Optional[str] = None
    practice_focus: Optional[str] = None
    question_style: str = QuestionStyle.THEORY
    interview_type: str = InterviewType.TEXT  # TEXT or VOICE
    question_flow: str = QuestionFlow.BATCH  # BATCH or ADAPTIVE
    created_at: datetime
    completed_at: Optional[datetime] = None
    ended_early: bool = False

    @computed_field
    @property
    # how long the interview took, start to finish. null while it is still running
    def duration_seconds(self) -> Optional[int]:
        if self.completed_at is None or self.created_at is None:
            return None
        return max(0, int((self.completed_at - self.created_at).total_seconds()))


# the full version, including the questions and answers, used for the interview and results pages
class InterviewResponse(InterviewSummary):
    questions: List[QuestionResponse] = []
    cv_filename: Optional[str] = None  # shown on the results page so you know which CV it used
    # ADAPTIVE interviews only: true while the next question is still being written, so the
    # frontend knows the interview is not finished just because every question has an answer
    awaiting_next_question: bool = False
