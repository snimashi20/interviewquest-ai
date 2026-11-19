from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


# what GET /api/jobs/{id} returns - the frontend polls this to know when a background task is done
class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_type: str
    status: str  # PENDING / IN_PROGRESS / COMPLETED / FAILED
    interview_id: Optional[int] = None
    question_id: Optional[int] = None
    cv_id: Optional[int] = None  # set on an extract_topics job
    error: Optional[str] = None  # only set if status is FAILED
    created_at: datetime
    updated_at: datetime
