from db.database import SessionLocal
from models.answer import Answer
from models.interview import Interview, InterviewStatus
from models.job import Job, JobStatus
from models.question import Question
from services import ai_service


def run_generate_question_job(job_id: str, interview_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if job is None or interview is None:
            return

        job.status = JobStatus.IN_PROGRESS
        db.commit()

        try:
            generated = ai_service.generate_question(interview.role, interview.difficulty)
            question = Question(
                interview_id=interview.id,
                question_text=generated.question,
                topic=generated.topic,
                question_number=1,
            )
            db.add(question)
            interview.status = InterviewStatus.IN_PROGRESS
            job.status = JobStatus.COMPLETED
            db.commit()
        except Exception as exc:  # noqa: BLE001 - surface any AI/DB failure onto the job
            db.rollback()
            job.status = JobStatus.FAILED
            job.error = str(exc)
            interview.status = InterviewStatus.FAILED
            db.commit()
    finally:
        db.close()


def run_evaluate_answer_job(job_id: str, question_id: int) -> None:
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        question = db.query(Question).filter(Question.id == question_id).first()
        if job is None or question is None:
            return

        job.status = JobStatus.IN_PROGRESS
        db.commit()

        try:
            answer = db.query(Answer).filter(Answer.question_id == question_id).first()
            evaluation = ai_service.evaluate_answer(question.question_text, answer.answer_text)
            answer.score = evaluation.score
            answer.feedback = evaluation.feedback
            answer.strengths = evaluation.strengths
            answer.improvements = evaluation.improvements

            interview = db.query(Interview).filter(Interview.id == question.interview_id).first()
            interview.status = InterviewStatus.COMPLETED
            job.status = JobStatus.COMPLETED
            db.commit()
        except Exception as exc:  # noqa: BLE001 - surface any AI/DB failure onto the job
            db.rollback()
            job.status = JobStatus.FAILED
            job.error = str(exc)
            db.commit()
    finally:
        db.close()
