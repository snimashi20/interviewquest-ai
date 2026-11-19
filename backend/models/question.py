from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


# how this question is meant to be answered
class QuestionKind:
    THEORY = "THEORY"  # a written answer, typed into a textarea
    CODING = "CODING"  # a coding task, answered in the code workspace and run in the browser


# the languages the in-browser runner can actually execute. the AI is told to pick one of
# these for a coding task, so every generated task is runnable rather than just readable
RUNNABLE_LANGUAGES = ("python", "javascript")
DEFAULT_LANGUAGE = "python"


# this is the "questions" table
class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey("interviews.id"), nullable=False)  # which interview this belongs to
    question_text = Column(String, nullable=False)
    topic = Column(String, nullable=True)  # short label like "Operating Systems"
    question_number = Column(Integer, nullable=False, default=1)
    kind = Column(String, nullable=False, default=QuestionKind.THEORY)
    language = Column(String, nullable=True)  # only on a coding task: "python" or "javascript"
    starter_code = Column(Text, nullable=True)  # only on a coding task: the stub the editor opens with
    # the ideal answer, written by the AI at the same time as the question. deliberately NOT
    # sent to the frontend until the student has submitted their own attempt - see
    # routers/interviews.py, which strips it from any unanswered question
    model_answer = Column(Text, nullable=True)
    # true when this question was written off the back of the previous answer rather than
    # as part of the up-front set - the results page labels these as follow-ups
    is_followup = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    interview = relationship("Interview", back_populates="questions")
    # each question has at most one answer
    answer = relationship("Answer", back_populates="question", uselist=False, cascade="all, delete-orphan")
