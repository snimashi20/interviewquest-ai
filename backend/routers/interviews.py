from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from db.database import get_db
from models.interview import Interview, InterviewStatus
from models.job import Job, JobStatus, JobType
from schemas.interview import InterviewCreate, InterviewCreateResponse, InterviewResponse, InterviewSummary
from services.interview_service import run_generate_question_job

router = APIRouter(prefix="/interviews", tags=["interviews"])


@router.post("", response_model=InterviewCreateResponse, status_code=201)
def create_interview(payload: InterviewCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    interview = Interview(role=payload.role, difficulty=payload.difficulty, status=InterviewStatus.PENDING)
    db.add(interview)
    db.commit()
    db.refresh(interview)

    job = Job(job_type=JobType.GENERATE_QUESTION, interview_id=interview.id, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(run_generate_question_job, job.id, interview.id)

    return InterviewCreateResponse(interview_id=interview.id, job_id=job.id)


@router.get("", response_model=List[InterviewSummary])
def list_interviews(db: Session = Depends(get_db)):
    return db.query(Interview).order_by(Interview.created_at.desc()).all()


@router.get("/{interview_id}", response_model=InterviewResponse)
def get_interview(interview_id: int, db: Session = Depends(get_db)):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if interview is None:
        raise HTTPException(status_code=404, detail="Interview not found")
    return interview
