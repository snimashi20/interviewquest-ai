from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


# this is the "study_topics" table - one row per tickable topic found in a CV.
#
# the Fundamentals tab keeps its ticks in the browser (localStorage) because its topic list
# is a fixed file in the frontend. CV topics are different: the AI generates them per upload,
# so they live in the database and the tick is saved here instead. that way the checklist
# survives a different browser or a cleared cache.
class StudyTopic(Base):
    __tablename__ = "study_topics"

    id = Column(Integer, primary_key=True, index=True)
    cv_id = Column(Integer, ForeignKey("cvs.id"), nullable=False)  # which CV this came from

    label = Column(String, nullable=False)  # e.g. "React hooks & re-render behaviour"
    category = Column(String, nullable=False)  # e.g. "Frontend"
    # one-line explanation of the category, shown under its heading. stored on every topic
    # (rather than in its own table) to keep this feature to a single extra table
    category_blurb = Column(String, nullable=True)
    level = Column(String, nullable=False)  # Beginner / Intermediate / Advanced
    completed = Column(Boolean, nullable=False, default=False)  # ticked off by the student
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    cv = relationship("CV", back_populates="topics")
