from datetime import datetime, timezone

from db.database import SessionLocal
from models.answer import Answer
from models.cv import CV, CVStatus
from models.interview import Interview, InterviewMode, InterviewStatus, InterviewType, QuestionFlow
from models.job import Job, JobStatus
from models.question import DEFAULT_LANGUAGE, RUNNABLE_LANGUAGES, Question, QuestionKind
from models.study_topic import StudyTopic
from services import ai_service, usage_service

# the three level names the frontend knows how to render a badge for. the AI is asked for
# these exact words, but we check anyway so a stray value can't break the checklist styling
VALID_LEVELS = ("Beginner", "Intermediate", "Advanced")
DEFAULT_LEVEL = "Intermediate"


# runs in the background after POST /api/interviews - calls the AI and saves the question set
def run_generate_questions_job(job_id: str, interview_id: int) -> None:
    # background tasks don't share the request's database session, so open a new one here
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if job is None or interview is None:
            return

        job.status = JobStatus.IN_PROGRESS
        db.commit()

        usage: list = []
        try:
            # a practice set is written by a different prompt - one subject, model answers
            # included, and possibly coding tasks - so it takes its own path
            if interview.mode == InterviewMode.PRACTICE:
                questions = _build_practice_questions(interview, usage)
            else:
                questions = _build_interview_questions(db, interview, usage)

            if not questions:
                raise ValueError("The AI did not return any questions.")

            for question in questions:
                db.add(question)

            # the AI occasionally returns a different number than we asked for - trust what
            # it actually gave us so the progress indicator ("3 of 5") stays correct
            interview.question_count = len(questions)
            interview.status = InterviewStatus.IN_PROGRESS
            job.status = JobStatus.COMPLETED
            _record_usage(db, usage, interview.id)
            db.commit()
        except Exception as exc:  # noqa: BLE001 - surface any AI/DB failure onto the job
            # if anything above fails (bad API key, network error, etc.) don't crash the app -
            # just record the error on the job so the frontend can show it
            db.rollback()
            job.status = JobStatus.FAILED
            job.error = str(exc)
            interview.status = InterviewStatus.FAILED
            db.commit()
    finally:
        db.close()


# runs in the background for an ADAPTIVE interview, which writes one question at a time
# instead of the whole set up front. called once when the interview starts (for the opening
# question) and again after each answer is graded, via POST /api/interviews/{id}/next-question
def run_generate_next_question_job(job_id: str, interview_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if job is None or interview is None:
            return

        job.status = JobStatus.IN_PROGRESS
        db.commit()

        usage: list = []
        try:
            questions = (
                db.query(Question)
                .filter(Question.interview_id == interview.id)
                .order_by(Question.question_number)
                .all()
            )

            # never write past the end of the interview, and never leave two unanswered
            # questions on the table - that is what would let a double-click ask twice
            if len(questions) >= interview.question_count:
                raise ValueError("This interview has already asked every question.")
            if any(question.answer is None for question in questions):
                raise ValueError("The current question has not been answered yet.")

            # a short summary of the interview so far rather than the whole transcript
            context = ai_service.build_interview_context(
                [
                    (
                        question.question_text,
                        question.topic,
                        question.answer.answer_text if question.answer else None,
                    )
                    for question in questions
                ]
            )

            number = len(questions) + 1
            generated = ai_service.generate_next_question(
                interview.role,
                interview.difficulty,
                number,
                interview.question_count,
                context,
                usage=usage,
            )

            text = (generated.question or "").strip()
            if not text:
                raise ValueError("The AI did not return a question.")

            db.add(
                Question(
                    interview_id=interview.id,
                    question_text=text,
                    topic=generated.topic,
                    question_number=number,
                    kind=QuestionKind.THEORY,
                    # the opening question cannot be a follow-up, whatever the AI claims
                    is_followup=bool(generated.is_followup) and number > 1,
                )
            )

            interview.status = InterviewStatus.IN_PROGRESS
            job.status = JobStatus.COMPLETED
            _record_usage(db, usage, interview.id)
            db.commit()
        except Exception as exc:  # noqa: BLE001 - surface any AI/DB failure onto the job
            db.rollback()
            job.status = JobStatus.FAILED
            job.error = str(exc)
            # a failed follow-up must not throw away the answers already given, so the
            # interview is only marked FAILED when it never got a single question out
            if not db.query(Question).filter(Question.interview_id == interview_id).count():
                interview.status = InterviewStatus.FAILED
            db.commit()
    finally:
        db.close()


# writes the questions for a normal mock interview. returns them unsaved, numbered from 1
def _build_interview_questions(db, interview: Interview, usage: list | None = None) -> list[Question]:
    # if this interview is tied to a CV, pass its text along so the questions
    # are about the student's own projects rather than the role in general
    cv_text = None
    if interview.cv_id is not None:
        cv = db.query(CV).filter(CV.id == interview.cv_id).first()
        cv_text = cv.raw_text if cv is not None else None

    # the actual slow part - calling OpenAI
    generated = ai_service.generate_questions(
        interview.role,
        interview.difficulty,
        interview.question_count,
        cv_text,
        # a spoken question has to work read aloud, with nothing to look at on screen
        spoken=interview.interview_type == InterviewType.VOICE,
        usage=usage,
    )

    return [
        Question(
            interview_id=interview.id,
            question_text=item.question,
            topic=item.topic,
            question_number=index,
            kind=QuestionKind.THEORY,
        )
        for index, item in enumerate(generated.questions, start=1)
    ]


# writes the questions for a practice set: one subject, a model answer on every question,
# and coding tasks carrying a starter stub
def _build_practice_questions(interview: Interview, usage: list | None = None) -> list[Question]:
    generated = ai_service.generate_practice_questions(
        interview.practice_topic,
        interview.difficulty,
        interview.question_count,
        interview.question_style,
        interview.practice_focus,
        usage=usage,
    )

    questions = []
    for index, item in enumerate(generated.questions, start=1):
        # the AI is asked for these exact words, but a stray value would break the editor,
        # so anything unexpected falls back to a plain written question
        kind = QuestionKind.CODING if item.kind == QuestionKind.CODING else QuestionKind.THEORY
        language = None
        starter_code = None
        if kind == QuestionKind.CODING:
            language = (item.language or "").strip().lower()
            if language not in RUNNABLE_LANGUAGES:
                language = DEFAULT_LANGUAGE
            starter_code = item.starter_code

        questions.append(
            Question(
                interview_id=interview.id,
                question_text=item.question,
                topic=item.topic,
                question_number=index,
                kind=kind,
                language=language,
                starter_code=starter_code,
                model_answer=item.model_answer,
            )
        )
    return questions


# runs in the background after an answer is submitted - calls the AI to grade it and saves the result
def run_evaluate_answer_job(job_id: str, question_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        question = db.query(Question).filter(Question.id == question_id).first()
        if job is None or question is None:
            return

        job.status = JobStatus.IN_PROGRESS
        db.commit()

        usage: list = []
        try:
            answer = db.query(Answer).filter(Answer.question_id == question_id).first()
            # the actual slow part - calling OpenAI to grade the answer.
            # practice questions were written with a model answer, so they get marked against
            # it; interview questions have nothing to compare to and get the open judgement
            if question.model_answer:
                evaluation = ai_service.evaluate_practice_answer(
                    question.question_text,
                    answer.answer_text,
                    question.model_answer,
                    question.kind,
                    question.language,
                    usage=usage,
                )
            else:
                evaluation = ai_service.evaluate_answer(
                    question.question_text,
                    answer.answer_text,
                    usage=usage,
                )
            answer.score = evaluation.score
            answer.feedback = evaluation.feedback
            answer.strengths = evaluation.strengths
            answer.improvements = evaluation.improvements
            db.flush()  # push the score to the session so the average below picks it up

            interview = db.query(Interview).filter(Interview.id == question.interview_id).first()
            _refresh_interview_progress(db, interview)

            job.status = JobStatus.COMPLETED
            _record_usage(db, usage, question.interview_id)
            db.commit()
        except Exception as exc:  # noqa: BLE001 - surface any AI/DB failure onto the job
            db.rollback()
            job.status = JobStatus.FAILED
            job.error = str(exc)
            db.commit()
    finally:
        db.close()


# recalculates the running average and decides whether the interview is finished.
# called every time an answer gets graded, so a half-finished interview still shows a score
def _refresh_interview_progress(db, interview: Interview) -> None:
    if interview is None:
        return

    questions = db.query(Question).filter(Question.interview_id == interview.id).all()
    scores = [
        question.answer.score
        for question in questions
        if question.answer is not None and question.answer.score is not None
    ]

    if scores:
        interview.overall_score = round(sum(scores) / len(scores))

    if interview.question_flow == QuestionFlow.ADAPTIVE:
        # an adaptive interview doesn't know its last question until it has written it, so
        # "finished" means it has asked its full quota and graded every one of them
        finished = (
            len(questions) >= interview.question_count
            and len(scores) == len(questions)
            and len(questions) > 0
        )
    else:
        # finished only once every question has a graded answer
        finished = bool(questions) and len(scores) == len(questions)

    if finished:
        interview.status = InterviewStatus.COMPLETED
        if interview.completed_at is None:
            interview.completed_at = datetime.now(timezone.utc)
    else:
        interview.status = InterviewStatus.IN_PROGRESS


# closes an interview off when the candidate presses "End Interview" instead of answering
# every question. whatever has been graded still counts towards the score - nothing is
# invented for the questions they never reached
def end_interview(db, interview: Interview, ended_early: bool = True) -> Interview:
    questions = db.query(Question).filter(Question.interview_id == interview.id).all()
    scores = [
        question.answer.score
        for question in questions
        if question.answer is not None and question.answer.score is not None
    ]
    if scores:
        interview.overall_score = round(sum(scores) / len(scores))

    interview.status = InterviewStatus.COMPLETED
    interview.ended_early = ended_early
    if interview.completed_at is None:
        interview.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(interview)
    return interview


# writes however many usage rows this job collected. never raises: the point of the usage
# table is the summary, and losing a row of accounting must not lose a question or a grade
def _record_usage(db, usage: list, interview_id: int | None) -> None:
    for sample in usage or []:
        usage_service.record(db, sample, interview_id)


# runs in the background after POST /api/cvs - asks the AI to turn the CV text into a
# categorised checklist, and saves each topic as its own tickable row
def run_extract_topics_job(job_id: str, cv_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        cv = db.query(CV).filter(CV.id == cv_id).first()
        if job is None or cv is None:
            return

        job.status = JobStatus.IN_PROGRESS
        cv.status = CVStatus.IN_PROGRESS
        db.commit()

        usage: list = []
        try:
            # the actual slow part - calling OpenAI to read the CV
            extracted = ai_service.extract_cv_topics(cv.raw_text, usage=usage)

            saved = 0
            for category in extracted.categories:
                for topic in category.topics:
                    # keep the level to the three the frontend has badges for
                    level = topic.level if topic.level in VALID_LEVELS else DEFAULT_LEVEL
                    db.add(
                        StudyTopic(
                            cv_id=cv.id,
                            label=topic.label,
                            category=category.name,
                            category_blurb=category.blurb,
                            level=level,
                            completed=False,
                        )
                    )
                    saved += 1

            if saved == 0:
                raise ValueError("The AI could not find any topics in that CV.")

            cv.status = CVStatus.COMPLETED
            job.status = JobStatus.COMPLETED
            _record_usage(db, usage, None)
            db.commit()
        except Exception as exc:  # noqa: BLE001 - surface any AI/DB failure onto the job
            db.rollback()
            job.status = JobStatus.FAILED
            job.error = str(exc)
            cv.status = CVStatus.FAILED
            cv.error = str(exc)
            db.commit()
    finally:
        db.close()
