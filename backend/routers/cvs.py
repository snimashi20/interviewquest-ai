import re
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from db.database import get_db
from models.cv import CV, CVStatus
from models.job import Job, JobStatus, JobType
from models.study_topic import StudyTopic
from schemas.cv import (
    CVResponse,
    CVSummary,
    CVUploadResponse,
    StudyCategoryResponse,
    StudyTopicResponse,
    StudyTopicUpdate,
)
from services.cv_service import CVExtractionError, extract_cv_text
from services.interview_service import run_extract_topics_job

# every route below starts with /cvs (main.py adds the /api prefix on top of that)
router = APIRouter(prefix="/cvs", tags=["cvs"])


# turns a category name like "Cloud & DevOps" into "cloud-devops", for use as a React key
def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "category"


# regroups a flat list of topic rows back into the category cards the frontend renders.
# the order the AI returned them in is preserved, because topics come back ordered by id
def _group_topics(topics: List[StudyTopic]) -> List[StudyCategoryResponse]:
    grouped: dict[str, StudyCategoryResponse] = {}

    for topic in topics:
        category = grouped.get(topic.category)
        if category is None:
            category = StudyCategoryResponse(
                id=_slugify(topic.category),
                name=topic.category,
                blurb=topic.category_blurb,
                topics=[],
            )
            grouped[topic.category] = category
        category.topics.append(StudyTopicResponse.model_validate(topic))

    return list(grouped.values())


# builds the full CV payload (CV + grouped checklist + progress counts)
def _cv_response(cv: CV) -> CVResponse:
    categories = _group_topics(cv.topics)
    return CVResponse(
        id=cv.id,
        filename=cv.filename,
        status=cv.status,
        error=cv.error,
        created_at=cv.created_at,
        categories=categories,
        topic_count=len(cv.topics),
        completed_count=sum(1 for topic in cv.topics if topic.completed),
    )


# POST /api/cvs - upload a CV file. reading the text out of the file is fast so we do it
# here and reject a bad file straight away; asking the AI for topics is slow so that part
# goes to a background job the frontend polls
@router.post("", response_model=CVUploadResponse, status_code=201)
async def upload_cv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    data = await file.read()

    try:
        raw_text = extract_cv_text(file.filename, data)
    except CVExtractionError as exc:
        # a file we can't read is the student's mistake, not a server error, so 400
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    cv = CV(filename=file.filename, raw_text=raw_text, status=CVStatus.PENDING)
    db.add(cv)
    db.commit()
    db.refresh(cv)  # refresh so cv.id is filled in from the database

    job = Job(job_type=JobType.EXTRACT_TOPICS, cv_id=cv.id, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)

    # do the slow AI call in the background instead of making the student wait for this request
    background_tasks.add_task(run_extract_topics_job, job.id, cv.id)

    return CVUploadResponse(cv_id=cv.id, job_id=job.id)


# GET /api/cvs - every CV uploaded, newest first (feeds the "which CV?" dropdown)
@router.get("", response_model=List[CVSummary])
def list_cvs(db: Session = Depends(get_db)):
    return db.query(CV).order_by(CV.created_at.desc()).all()


# GET /api/cvs/{id} - one CV with its checklist, grouped into categories
@router.get("/{cv_id}", response_model=CVResponse)
def get_cv(cv_id: int, db: Session = Depends(get_db)):
    cv = (
        db.query(CV)
        # joinedload pulls the topics in the same query instead of one query per row
        .options(joinedload(CV.topics))
        .filter(CV.id == cv_id)
        .first()
    )
    if cv is None:
        raise HTTPException(status_code=404, detail="CV not found")
    return _cv_response(cv)


# PATCH /api/cvs/topics/{id} - tick or untick one topic. unlike the Fundamentals tab (which
# keeps its ticks in the browser) CV topics are saved here, so progress follows the student
# to another browser
@router.patch("/topics/{topic_id}", response_model=StudyTopicResponse)
def update_topic(topic_id: int, payload: StudyTopicUpdate, db: Session = Depends(get_db)):
    topic = db.query(StudyTopic).filter(StudyTopic.id == topic_id).first()
    if topic is None:
        raise HTTPException(status_code=404, detail="Topic not found")

    topic.completed = payload.completed
    db.commit()
    db.refresh(topic)
    return topic
