from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


# how far along the "read the CV and pull the topics out of it" process is.
# same four states as a job, kept on the CV itself so the My CV page can tell
# at a glance whether this CV is ready to study from.
class CVStatus:
    PENDING = "PENDING"  # file saved, topics not pulled out yet
    IN_PROGRESS = "IN_PROGRESS"  # the AI is reading it right now
    COMPLETED = "COMPLETED"  # topics are ready
    FAILED = "FAILED"  # something went wrong (usually the AI call)


# this is the "cvs" table - one row per CV the student uploads
class CV(Base):
    __tablename__ = "cvs"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)  # the original name, e.g. "sanuth_cv.pdf"
    # the plain text we pulled out of the PDF/DOCX. kept so we can feed it to the AI when
    # generating interview questions later, without asking for the file a second time
    raw_text = Column(Text, nullable=False)
    status = Column(String, nullable=False, default=CVStatus.PENDING)
    error = Column(String, nullable=True)  # if extraction failed, why
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # the study topics the AI found in this CV
    topics = relationship(
        "StudyTopic",
        back_populates="cv",
        cascade="all, delete-orphan",
        order_by="StudyTopic.id",  # keep the order the AI returned them in
    )
    # interviews that were run against this CV
    interviews = relationship("Interview", back_populates="cv")
