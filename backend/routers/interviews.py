from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from db.database import get_db
from models.answer import Answer
from models.cv import CV, CVStatus
from models.interview import Interview, InterviewStatus, QuestionFlow
from models.job import Job, JobStatus, JobType
from models.question import Question
from models.usage import UsageRecord
from schemas.answer import AnswerCreate
from schemas.interview import (
    InterviewCreate,
    InterviewCreateResponse,
    InterviewResponse,
    InterviewSummary,
    NextQuestionResponse,
)
from schemas.job import JobResponse
from schemas.usage import UsageSummary
from services import usage_service
from services.interview_service import (
    end_interview,
    run_evaluate_answer_job,
    run_generate_next_question_job,
    run_generate_questions_job,
)

# every route below starts with /interviews (main.py adds the /api prefix on top of that)
router = APIRouter(prefix="/interviews", tags=["interviews"])


# the job types that write a question, used when looking for one already in flight
_QUESTION_JOB_TYPES = (JobType.GENERATE_QUESTIONS, JobType.GENERATE_NEXT_QUESTION)
_LIVE_JOB_STATUSES = (JobStatus.PENDING, JobStatus.IN_PROGRESS)


# finds a question-writing job that is still running for this interview, if there is one.
# this is what stops a double-click (or a remounted component) asking the AI twice
def _pending_question_job(db: Session, interview_id: int) -> Job | None:
    return (
        db.query(Job)
        .filter(
            Job.interview_id == interview_id,
            Job.job_type.in_(_QUESTION_JOB_TYPES),
            Job.status.in_(_LIVE_JOB_STATUSES),
        )
        .order_by(Job.created_at.desc())
        .first()
    )


# POST /api/interviews - starts a new interview
@router.post("", response_model=InterviewCreateResponse, status_code=201)
def create_interview(payload: InterviewCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    # if the student picked a CV, make sure it exists and has finished being read before
    # we promise an interview based on it
    if payload.cv_id is not None:
        cv = db.query(CV).filter(CV.id == payload.cv_id).first()
        if cv is None:
            raise HTTPException(status_code=404, detail="CV not found")
        if cv.status != CVStatus.COMPLETED:
            raise HTTPException(status_code=400, detail="That CV is still being processed. Please try again shortly.")

    # save the interview straight away so we have an id to work with.
    # the practice fields are stored rather than passed along, because the question-writing
    # job runs in the background after this request has already returned - it re-reads the
    # row to find out what to write
    interview = Interview(
        role=payload.role,
        difficulty=payload.difficulty,
        status=InterviewStatus.PENDING,
        cv_id=payload.cv_id,
        question_count=payload.question_count,
        mode=payload.mode,
        practice_topic=(payload.practice_topic or "").strip() or None,
        practice_focus=(payload.practice_focus or "").strip() or None,
        question_style=payload.question_style,
        interview_type=payload.interview_type,
        question_flow=payload.question_flow,
    )
    db.add(interview)
    db.commit()
    db.refresh(interview)  # refresh so interview.id is filled in from the database

    # an adaptive interview writes one question at a time, so the first job only writes the
    # opening question. a batch interview writes the whole set in one go, as it always has
    adaptive = interview.question_flow == QuestionFlow.ADAPTIVE
    job_type = JobType.GENERATE_NEXT_QUESTION if adaptive else JobType.GENERATE_QUESTIONS

    # create a job to track "writing the question(s)" - it starts out PENDING
    job = Job(job_type=job_type, interview_id=interview.id, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)

    # do the slow AI call in the background instead of making the student wait for this request
    runner = run_generate_next_question_job if adaptive else run_generate_questions_job
    background_tasks.add_task(runner, job.id, interview.id)

    # send back the ids immediately, the frontend will poll the job until it's done
    return InterviewCreateResponse(interview_id=interview.id, job_id=job.id)


# GET /api/interviews - list every interview, newest first (used for the History page)
@router.get("", response_model=List[InterviewSummary])
def list_interviews(db: Session = Depends(get_db)):
    return db.query(Interview).order_by(Interview.created_at.desc()).all()


# GET /api/interviews/{id} - one interview with all its questions and answers
@router.get("/{interview_id}", response_model=InterviewResponse)
def get_interview(interview_id: int, db: Session = Depends(get_db)):
    interview = (
        db.query(Interview)
        # joinedload loads the related questions/answers in the same query, instead of one query per row
        .options(joinedload(Interview.questions).joinedload(Question.answer))
        .filter(Interview.id == interview_id)
        .first()
    )
    if interview is None:
        raise HTTPException(status_code=404, detail="Interview not found")

    response = InterviewResponse.model_validate(interview)
    # pass the CV's name along so the results page can say which CV it was based on
    if interview.cv is not None:
        response.cv_filename = interview.cv.filename

    # an adaptive interview has fewer questions on the table than it will eventually ask, so
    # "every question is answered" does not mean "finished". this flag is how the interview
    # page tells the difference and keeps waiting instead of jumping to the results
    response.awaiting_next_question = (
        interview.question_flow == QuestionFlow.ADAPTIVE
        and interview.status != InterviewStatus.COMPLETED
        and len(interview.questions) < interview.question_count
        and all(question.answer is not None for question in interview.questions)
    )

    # the model answer is the whole point of practice mode, but it has to stay out of reach
    # until the student has actually had a go - otherwise it is one devtools tab away.
    # it is only ever sent for a question that already has an answer against it.
    for question in response.questions:
        if question.answer is None:
            question.model_answer = None

    return response


# POST /api/interviews/{id}/questions/{id}/answers - submit an answer to be graded
@router.post("/{interview_id}/questions/{question_id}/answers", response_model=JobResponse, status_code=201)
def submit_answer(
    interview_id: int,
    question_id: int,
    payload: AnswerCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    # make sure this question actually belongs to this interview
    question = (
        db.query(Question)
        .filter(Question.id == question_id, Question.interview_id == interview_id)
        .first()
    )
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")

    # don't let someone answer the same question twice
    existing = db.query(Answer).filter(Answer.question_id == question_id).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="Answer already submitted for this question")

    # an interview the candidate has ended is closed for good
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if interview is not None and interview.status == InterviewStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="This interview has already finished")

    # save the raw answer first, score/feedback get filled in once grading finishes
    answer = Answer(
        question_id=question.id,
        answer_text=payload.answer_text.strip(),
        source=payload.source,
        audio_seconds=payload.audio_seconds,
        transcript_edited=payload.transcript_edited,
    )
    db.add(answer)
    db.commit()

    # create a job to track "grading this answer"
    job = Job(job_type=JobType.EVALUATE_ANSWER, interview_id=interview_id, question_id=question.id)
    db.add(job)
    db.commit()
    db.refresh(job)

    # grade it in the background so the request returns instantly
    background_tasks.add_task(run_evaluate_answer_job, job.id, question.id)

    return job


# POST /api/interviews/{id}/next-question - ask for the next question of an adaptive interview.
#
# called by the interview page once the previous answer has been graded. it is safe to call
# twice: if a question is already waiting, or one is already being written, it says so instead
# of starting a second AI call
@router.post("/{interview_id}/next-question", response_model=NextQuestionResponse)
def next_question(interview_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if interview is None:
        raise HTTPException(status_code=404, detail="Interview not found")
    if interview.question_flow != QuestionFlow.ADAPTIVE:
        raise HTTPException(
            status_code=400,
            detail="This interview had all of its questions written up front.",
        )
    if interview.status == InterviewStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="This interview has already finished")

    questions = db.query(Question).filter(Question.interview_id == interview_id).all()

    # there is already a question waiting to be answered
    if any(question.answer is None for question in questions):
        return NextQuestionResponse(job_id=None, question_ready=True)

    # the interview has asked everything it is going to ask
    if len(questions) >= interview.question_count:
        raise HTTPException(status_code=400, detail="This interview has already asked every question")

    # one is already being written - hand back that job rather than starting another
    pending = _pending_question_job(db, interview_id)
    if pending is not None:
        return NextQuestionResponse(job_id=pending.id, question_ready=False)

    job = Job(job_type=JobType.GENERATE_NEXT_QUESTION, interview_id=interview_id, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(run_generate_next_question_job, job.id, interview_id)
    return NextQuestionResponse(job_id=job.id, question_ready=False)


# POST /api/interviews/{id}/end - the candidate pressed "End Interview".
#
# closes the interview with whatever has been graded so far. nothing is invented for the
# questions they never got to, and the answers they did give keep their scores
@router.post("/{interview_id}/end", response_model=InterviewSummary)
def end_interview_early(interview_id: int, db: Session = Depends(get_db)):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if interview is None:
        raise HTTPException(status_code=404, detail="Interview not found")

    if interview.status == InterviewStatus.COMPLETED:
        return interview  # already finished - ending it again changes nothing

    questions = db.query(Question).filter(Question.interview_id == interview_id).all()
    answered = sum(1 for question in questions if question.answer is not None)
    # ending after the last answer is a normal finish, not an early exit
    return end_interview(db, interview, ended_early=answered < interview.question_count)


# GET /api/interviews/{id}/usage - the optional "what did this interview cost" summary.
# an estimate from the rates in .env, not a bill
@router.get("/{interview_id}/usage", response_model=UsageSummary)
def interview_usage(interview_id: int, db: Session = Depends(get_db)):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if interview is None:
        raise HTTPException(status_code=404, detail="Interview not found")

    records = db.query(UsageRecord).filter(UsageRecord.interview_id == interview_id).all()
    return UsageSummary(interview_id=interview_id, **usage_service.summarise(records))
