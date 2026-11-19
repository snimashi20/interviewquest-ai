from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

from core.config import settings

# the engine is what actually talks to the Postgres database
engine = create_engine(settings.DATABASE_URL)

# SessionLocal is a factory - call it to get a new database session/connection
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base is the class every model (table) needs to inherit from
Base = declarative_base()


# columns added to tables that already existed before the CV feature.
# create_all() below only creates MISSING TABLES - it never alters an existing one - so a
# database created before these columns existed would keep failing with "column does not
# exist". this project has no migration tool (no Alembic), so instead of making everyone drop
# their database we add the columns here. "IF NOT EXISTS" makes it safe to run every startup.
_COLUMN_MIGRATIONS = (
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS cv_id INTEGER REFERENCES cvs(id)",
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS question_count INTEGER NOT NULL DEFAULT 5",
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS overall_score INTEGER",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cv_id INTEGER REFERENCES cvs(id)",
    # added with the Practice tab: a session is either a mock INTERVIEW or a PRACTICE drill
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS mode VARCHAR NOT NULL DEFAULT 'INTERVIEW'",
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS practice_topic VARCHAR",
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS practice_focus VARCHAR",
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS question_style VARCHAR NOT NULL DEFAULT 'THEORY'",
    # ...and a question can now be a coding task carrying a stub and a hidden model answer
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS kind VARCHAR NOT NULL DEFAULT 'THEORY'",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS language VARCHAR",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS starter_code TEXT",
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS model_answer TEXT",
    # added with the voice interview: how the candidate answers, when the questions get
    # written, and when the interview finished. every one has a default, so a database full
    # of existing text interviews keeps working exactly as it did
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS interview_type VARCHAR NOT NULL DEFAULT 'TEXT'",
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS question_flow VARCHAR NOT NULL DEFAULT 'BATCH'",
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ",
    "ALTER TABLE interviews ADD COLUMN IF NOT EXISTS ended_early BOOLEAN NOT NULL DEFAULT FALSE",
    # ...a question can now be a follow-up written off the back of the last answer...
    "ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_followup BOOLEAN NOT NULL DEFAULT FALSE",
    # ...and an answer records whether it was typed or spoken
    "ALTER TABLE answers ADD COLUMN IF NOT EXISTS source VARCHAR NOT NULL DEFAULT 'TYPED'",
    "ALTER TABLE answers ADD COLUMN IF NOT EXISTS audio_seconds DOUBLE PRECISION",
    "ALTER TABLE answers ADD COLUMN IF NOT EXISTS transcript_edited BOOLEAN NOT NULL DEFAULT FALSE",
)


# FastAPI calls this for every request that needs the database, and closes it when the request is done
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# adds any column the models expect but an older database is missing.
# runs after create_tables(), so the cvs table the foreign keys point at already exists
def run_column_migrations():
    with engine.begin() as connection:
        for statement in _COLUMN_MIGRATIONS:
            connection.execute(text(statement))


# creates all the tables in Postgres if they don't already exist, then patches up any
# older table that is missing a newer column
def create_tables():
    Base.metadata.create_all(bind=engine)
    run_column_migrations()
