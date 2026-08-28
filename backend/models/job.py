import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func

from db.database import Base


class JobType:
    GENERATE_QUESTION = "generate_question"
    EVALUATE_ANSWER = "evaluate_answer"


class JobStatus:
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    job_type = Column(String, nullable=False)
    status = Column(String, nullable=False, default=JobStatus.PENDING)
    interview_id = Column(Integer, ForeignKey("interviews.id"), nullable=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=True)
    error = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
