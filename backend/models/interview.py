from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from db.database import Base


# just a set of constants so we don't misspell status strings around the codebase
class InterviewStatus:
    PENDING = "PENDING"  # interview just created, no questions yet
    IN_PROGRESS = "IN_PROGRESS"  # questions generated, still working through them
    COMPLETED = "COMPLETED"  # every question has been answered and graded
    FAILED = "FAILED"  # something went wrong (usually the AI call)


# what kind of session this row is.
#   INTERVIEW - the full mock interview: a role, a mix of topics, one pass through the questions
#   PRACTICE  - a drill on one chosen subject (DSA, OOP, Databases...), where the student also
#               gets to see the model answer once they have had a go at it
class InterviewMode:
    INTERVIEW = "INTERVIEW"
    PRACTICE = "PRACTICE"


# what sort of questions to ask. only practice sets use anything other than THEORY -
# a mock interview is always written questions
class QuestionStyle:
    THEORY = "THEORY"  # written answers only
    CODING = "CODING"  # coding tasks only, answered in the code workspace
    MIXED = "MIXED"  # a bit of both


# how the candidate answers. a TEXT interview is the original typed experience; a VOICE
# interview reads each question aloud and takes a spoken answer, transcribed on the backend.
# the candidate can still switch to typing mid-interview - this is only what they started in
class InterviewType:
    TEXT = "TEXT"
    VOICE = "VOICE"


# when the questions get written.
#   BATCH    - the original behaviour: the whole set is written in one AI call up front
#   ADAPTIVE - one question at a time, each written after seeing the previous answer, so the
#              interviewer can follow up on what the candidate actually said
class QuestionFlow:
    BATCH = "BATCH"
    ADAPTIVE = "ADAPTIVE"


# how many questions an interview asks if the frontend doesn't say
DEFAULT_QUESTION_COUNT = 5


# this is the "interviews" table
class Interview(Base):
    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String, nullable=False)  # e.g. "Backend Developer"
    difficulty = Column(String, nullable=False)  # e.g. "Intermediate"
    status = Column(String, nullable=False, default=InterviewStatus.PENDING)
    # INTERVIEW (the default) or PRACTICE. a practice set is the same machinery - questions,
    # answers, grading, jobs - pointed at a single subject instead of a whole role
    mode = Column(String, nullable=False, default=InterviewMode.INTERVIEW)
    practice_topic = Column(String, nullable=True)  # the subject being drilled, e.g. "Data Structures & Algorithms"
    practice_focus = Column(String, nullable=True)  # optional narrower target, e.g. "Binary search"
    question_style = Column(String, nullable=False, default=QuestionStyle.THEORY)
    # set when the student picked a CV to be interviewed on. null means a plain role-based
    # interview, which is still allowed - the CV is optional
    cv_id = Column(Integer, ForeignKey("cvs.id"), nullable=True)
    question_count = Column(Integer, nullable=False, default=DEFAULT_QUESTION_COUNT)
    # average of every graded answer so far, recalculated each time one is graded.
    # stays null until the first answer comes back from the AI
    overall_score = Column(Integer, nullable=True)
    # TEXT (type your answers) or VOICE (spoken, transcribed by the backend)
    interview_type = Column(String, nullable=False, default=InterviewType.TEXT)
    # BATCH (every question written up front) or ADAPTIVE (one at a time, following up on
    # the last answer). a voice interview defaults to ADAPTIVE so it feels like a conversation
    question_flow = Column(String, nullable=False, default=QuestionFlow.BATCH)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # set when the last answer is graded, or when the candidate ends the interview early.
    # created_at -> completed_at is the duration shown on the results page
    completed_at = Column(DateTime(timezone=True), nullable=True)
    # true when the candidate pressed "End Interview" instead of answering every question
    ended_early = Column(Boolean, nullable=False, default=False)

    # one interview has many questions, kept in the order they should be asked
    questions = relationship(
        "Question",
        back_populates="interview",
        cascade="all, delete-orphan",
        order_by="Question.question_number",
    )
    cv = relationship("CV", back_populates="interviews")
