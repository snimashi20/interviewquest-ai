from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models  # noqa: F401  ensures all models are registered on Base before create_tables()
from core.config import settings
from db.database import create_tables

app = FastAPI(
    title="InterviewQuest AI",
    description="API for AI-powered technical interview simulation",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    create_tables()


@app.get("/")
def root():
    return {"status": "ok", "service": "interviewquest-ai-backend"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
