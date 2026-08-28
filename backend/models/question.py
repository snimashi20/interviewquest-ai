from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    interview_id = Column(Integer, ForeignKey("interviews.id"), nullable=False)
    question_text = Column(String, nullable=False)
    topic = Column(String, nullable=True)
    question_number = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    interview = relationship("Interview", back_populates="questions")
    answer = relationship("Answer", back_populates="question", uselist=False, cascade="all, delete-orphan")
