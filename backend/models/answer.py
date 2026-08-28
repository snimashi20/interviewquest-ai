from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


class Answer(Base):
    __tablename__ = "answers"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False, unique=True)
    answer_text = Column(String, nullable=False)
    score = Column(Integer, nullable=True)
    feedback = Column(String, nullable=True)
    strengths = Column(JSON, nullable=True)
    improvements = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    question = relationship("Question", back_populates="answer")
