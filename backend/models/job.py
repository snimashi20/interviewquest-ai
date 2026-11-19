import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func

from db.database import Base


# the kinds of background jobs we run
class JobType:
    GENERATE_QUESTIONS = "generate_questions"  # write the whole question set for an interview
    EVALUATE_ANSWER = "evaluate_answer"  # grade one submitted answer
    EXTRACT_TOPICS = "extract_topics"  # read an uploaded CV and pull study topics out of it
    GENERATE_NEXT_QUESTION = "generate_next_question"  # write the next question in an adaptive interview


# the states a job can be in while the frontend polls it
class JobStatus:
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


# a Job tracks the progress of something slow happening in the background (calling the AI).
# the frontend keeps checking GET /api/jobs/{id} until this reaches COMPLETED or FAILED
class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))  # random unique id, not a counter
    job_type = Column(String, nullable=False)
    status = Column(String, nullable=False, default=JobStatus.PENDING)
    # whichever of these the job is about - the rest stay null
    interview_id = Column(Integer, ForeignKey("interviews.id"), nullable=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=True)
    cv_id = Column(Integer, ForeignKey("cvs.id"), nullable=True)
    error = Column(String, nullable=True)  # if it failed, why
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
