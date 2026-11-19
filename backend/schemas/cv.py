from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------- what the AI returns when it reads a CV ----------


# one tickable topic the AI found in the CV
class ExtractedTopic(BaseModel):
    """One study topic the LLM found evidence for in the CV."""

    label: str = Field(description="Specific thing to revise, e.g. 'React re-renders and the dependency array'")
    level: str = Field(description="How deeply it would be probed: 'Beginner', 'Intermediate' or 'Advanced'")


# a group of those topics, e.g. all the Frontend ones
class ExtractedCategory(BaseModel):
    """A group of related topics, e.g. 'Cloud & DevOps'."""

    name: str = Field(description="Short category name, e.g. 'Frontend' or 'Databases'")
    blurb: str = Field(description="One line on why this category is in the list, citing the CV")
    topics: List[ExtractedTopic]


# this shape tells the AI exactly what to return - used with with_structured_output()
class ExtractedTopicSet(BaseModel):
    """Structured output requested from the LLM when turning a CV into a checklist."""

    categories: List[ExtractedCategory]


# ---------- what we send back to the frontend ----------


# right after the upload: the ids the frontend needs to start polling
class CVUploadResponse(BaseModel):
    cv_id: int
    job_id: str  # the frontend polls this until the topics are ready


# one stored topic, including whether the student has ticked it off
class StudyTopicResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    category: str
    level: str
    completed: bool


# topics grouped under their category, so the frontend can render one card per category.
# shaped to match the static Fundamentals data on the frontend (id / name / blurb / topics)
# so both tabs can share the same checklist component
class StudyCategoryResponse(BaseModel):
    id: str  # slug built from the name, used as a React key
    name: str
    blurb: Optional[str] = None
    topics: List[StudyTopicResponse]


# a CV without its topics - used for the "which CV?" dropdown
class CVSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    status: str
    error: Optional[str] = None
    created_at: datetime


# the full CV with its checklist, for the My CV tab
class CVResponse(CVSummary):
    categories: List[StudyCategoryResponse] = []
    topic_count: int = 0
    completed_count: int = 0


# what the frontend sends when the student ticks or unticks a topic
class StudyTopicUpdate(BaseModel):
    completed: bool
