"""Shared test setup.

Two things make these tests safe to run without a bill or a database:

* the whole app runs against a throwaway SQLite file instead of Postgres, so nothing here
  can touch a real interview;
* every AI call is stubbed. No test in this suite reaches OpenAI, so running the suite
  costs nothing. A test that wants to pretend the AI failed stubs it to raise.
"""

import os
import sys
from pathlib import Path

import pytest

# the backend is run from inside its own folder ("uv run uvicorn main:app"), so the modules
# import each other as top-level names - the tests have to import them the same way
BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

# point the app at a scratch SQLite database before anything reads the settings. this also
# means the suite runs with no .env present at all, e.g. on a fresh clone or in CI
TEST_DB_PATH = BACKEND_ROOT / "tests" / "_test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH.as_posix()}"
os.environ.setdefault("OPENAI_API_KEY", "test-key-not-used")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5174")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import db.database as database_module  # noqa: E402
import models  # noqa: E402  - registers every table on Base
from db.database import Base, get_db  # noqa: E402

# one connection shared by every session, so the in-memory schema is visible to the request
# handlers AND to the background jobs (which open their own session through SessionLocal)
test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(autouse=True)
def database(monkeypatch):
    """A fresh, empty set of tables for every test."""
    Base.metadata.create_all(bind=test_engine)

    # background jobs call SessionLocal() directly rather than taking a request session,
    # so both the module that defines it and the services that imported it get redirected
    monkeypatch.setattr(database_module, "SessionLocal", TestSessionLocal)
    monkeypatch.setattr("services.interview_service.SessionLocal", TestSessionLocal)
    # the real one runs Postgres-only "ALTER TABLE ... IF NOT EXISTS" migrations on startup
    monkeypatch.setattr("main.create_tables", lambda: None)

    yield

    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db_session(database):
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(database):
    """The app, wired to the test database.

    TestClient runs FastAPI's background tasks before returning the response, so a POST that
    queues a job comes back with that job already finished - which is why the tests can
    assert on the result straight after the call.
    """
    import main

    def override_get_db():
        session = TestSessionLocal()
        try:
            yield session
        finally:
            session.close()

    main.app.dependency_overrides[get_db] = override_get_db
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()


# ---------------- stubbed AI ----------------


class FakeQuestion:
    def __init__(self, question, topic="General", kind="THEORY", language=None, starter_code=None, model_answer=None):
        self.question = question
        self.topic = topic
        self.kind = kind
        self.language = language
        self.starter_code = starter_code
        self.model_answer = model_answer


class FakeQuestionSet:
    def __init__(self, questions):
        self.questions = questions


class FakeNextQuestion:
    def __init__(self, question, topic="General", is_followup=False):
        self.question = question
        self.topic = topic
        self.is_followup = is_followup


class FakeEvaluation:
    def __init__(self, score=72):
        self.score = score
        self.feedback = "A reasonable answer that could go deeper."
        self.strengths = ["Clear explanation"]
        self.improvements = ["Mention trade-offs"]


@pytest.fixture
def fake_ai(monkeypatch):
    """Replaces every AI call with a cheap local stand-in, and records what it was asked."""
    calls = {"generate_questions": [], "generate_next_question": [], "evaluate_answer": []}

    def generate_questions(role, difficulty, question_count, cv_text=None, spoken=False, usage=None):
        calls["generate_questions"].append(
            {"role": role, "difficulty": difficulty, "count": question_count, "spoken": spoken}
        )
        return FakeQuestionSet(
            [FakeQuestion(f"Batch question {index}", f"Topic {index}") for index in range(1, question_count + 1)]
        )

    def generate_next_question(role, difficulty, question_number, question_count, context, usage=None):
        calls["generate_next_question"].append(
            {"number": question_number, "count": question_count, "context": context}
        )
        return FakeNextQuestion(
            f"Adaptive question {question_number}",
            topic=f"Topic {question_number}",
            is_followup=question_number > 1,
        )

    def evaluate_answer(question_text, answer_text, usage=None):
        calls["evaluate_answer"].append({"question": question_text, "answer": answer_text})
        return FakeEvaluation()

    monkeypatch.setattr("services.interview_service.ai_service.generate_questions", generate_questions)
    monkeypatch.setattr("services.interview_service.ai_service.generate_next_question", generate_next_question)
    monkeypatch.setattr("services.interview_service.ai_service.evaluate_answer", evaluate_answer)
    return calls
