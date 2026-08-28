from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


class InterviewStatus:
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class Interview(Base):
    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String, nullable=False)
    difficulty = Column(String, nullable=False)
    status = Column(String, nullable=False, default=InterviewStatus.PENDING)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    questions = relationship("Question", back_populates="interview", cascade="all, delete-orphan")
