from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.sql import func

from db.database import Base


# what kind of API call this row is measuring
class UsageKind:
    LLM = "LLM"  # a text call: writing questions, writing a follow-up, grading an answer
    TRANSCRIPTION = "TRANSCRIPTION"  # a speech-to-text call on one recorded answer


# one row per paid API call we make, so the app can show the student roughly what an
# interview cost. deliberately records numbers only - never the prompt, the answer or the
# audio itself. see GET /api/interviews/{id}/usage, which adds these up into an estimate
class UsageRecord(Base):
    __tablename__ = "usage_records"

    id = Column(Integer, primary_key=True, index=True)
    # null for a call that isn't tied to an interview (reading a CV, or a one-off
    # transcription posted before the interview existed)
    interview_id = Column(Integer, ForeignKey("interviews.id"), nullable=True, index=True)
    kind = Column(String, nullable=False)  # LLM or TRANSCRIPTION
    model = Column(String, nullable=False)  # which model was called, e.g. "gpt-6-luna"
    purpose = Column(String, nullable=True)  # free-text label, e.g. "generate_questions"
    # text calls fill these in, when the provider reports them
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    # transcription calls fill this in: the length of the recording we sent
    audio_seconds = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
