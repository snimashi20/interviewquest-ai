from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models  # loads every model so create_tables() below knows about all of them
from core.config import settings
from db.database import create_tables
from routers import cvs, interviews, jobs, voice

# defining the FastAPI application
app = FastAPI(
    title="InterviewQuest AI",
    description="API for AI-powered technical interview simulation",
    version="0.1.0",
    docs_url="/docs",  # swaggerUI
    redoc_url="/redoc",
)

# allow certain URLs (our React frontend) to interact with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],  # GET, POST, PUT, etc.
    allow_headers=["*"],
)


# runs once when the server starts, creates the database tables if they don't exist yet
@app.on_event("startup")
def on_startup():
    create_tables()


# connect our interview and job routes to the app, every route gets the /api prefix
app.include_router(interviews.router, prefix=settings.API_PREFIX)
app.include_router(jobs.router, prefix=settings.API_PREFIX)
app.include_router(cvs.router, prefix=settings.API_PREFIX)
# speech-to-text for a spoken answer - the OpenAI key stays on this side of the wire
app.include_router(voice.router, prefix=settings.API_PREFIX)


# a simple route just to check the API is alive
@app.get("/")
def root():
    return {"status": "ok", "service": "interviewquest-ai-backend"}

if __name__ == "__main__":
    # allow FastAPI to run directly with "python main.py" (uv run uvicorn does the same thing)
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
