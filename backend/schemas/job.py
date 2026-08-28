from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_type: str
    status: str
    interview_id: Optional[int] = None
    question_id: Optional[int] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
