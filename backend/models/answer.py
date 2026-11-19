from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


# how the candidate produced the answer text
class AnswerSource:
    TYPED = "TYPED"  # typed into the textarea
    SPOKEN = "SPOKEN"  # recorded through the microphone and transcribed by the backend


# this is the "answers" table
class Answer(Base):
    __tablename__ = "answers"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False, unique=True)  # one answer per question
    answer_text = Column(String, nullable=False)  # what the student typed
    score = Column(Integer, nullable=True)  # 0-100, filled in by the AI after grading
    feedback = Column(String, nullable=True)
    strengths = Column(JSON, nullable=True)  # list of strings, e.g. ["Good use of examples"]
    improvements = Column(JSON, nullable=True)
    # how this answer was given: TYPED (the textarea) or SPOKEN (recorded, then transcribed).
    # older rows predate voice answers, so the default keeps them reading as typed
    source = Column(String, nullable=False, default="TYPED")
    # spoken answers only: how long the recording ran, used for the usage estimate
    audio_seconds = Column(Float, nullable=True)
    # true when the candidate corrected the transcript before submitting it
    transcript_edited = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    question = relationship("Question", back_populates="answer")
