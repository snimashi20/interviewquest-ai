# InterviewQuest AI

An AI-powered technical interview simulator that generates interview questions and evaluates user responses using an LLM.

## Features

### Mock interview

- Select interview role
- Select difficulty level
- Choose how many questions the interview asks (3, 5 or 8)
- Optionally base the questions on your own CV
- Generate AI-powered interview questions
- Answer one question at a time, with a progress indicator
- Receive AI-generated feedback and a score per answer, plus an overall score
- Store interview history

### Fundamentals checklist

- The subjects every software interview covers, grouped by category
- Filter the list by the level you are targeting (Beginner / Intermediate / Advanced)
- Tick topics off as you revise them - ticked topics are struck through
- Progress is remembered in the browser

### My CV checklist

- Upload your CV (PDF, DOCX, TXT or MD, up to 5 MB)
- The backend reads the file and the AI pulls out the topics you actually claim
  (React, Docker, AWS and so on), grouped into categories with a level each
- Tick topics off as you revise them, exactly like the Fundamentals tab
- Progress is saved per CV in the database, so it survives a different browser
- Start an interview built from that CV in one click

### Practice a topic

- Drill one subject at a time (DSA, OOP, Databases, System Design...) instead of a whole
  interview - the subject list is the same one the Fundamentals tab shows, and every
  Fundamentals card links straight into it
- Optionally narrow it to a single thing inside that subject, e.g. "Binary search"
- Choose written questions, coding tasks, or a mix, and how many
- Each answer is marked out of 100 against a model answer the AI wrote with the question
- The model answer stays hidden behind a button, and the backend does not even send it
  until you have submitted your own attempt
- Coding tasks open a workspace with an editor, a Run button and an output pane. The code
  runs **in your browser** - Python through Pyodide (CPython on WebAssembly) and JavaScript
  in a Web Worker - so nothing is executed on the server. Submitting sends the code and
  whatever it last printed to be marked.

## Tech Stack

### Frontend

- React
- JavaScript
- React Router

### Backend

- Python
- FastAPI
- UV
- pypdf and python-docx for reading uploaded CVs

### Database

- PostgreSQL
- SQLAlchemy

### AI

- OpenAI API
- LangChain

### Deployment

- Choreo

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Health check |
| `POST` | `/api/interviews` | Start an interview (optionally with `cv_id`), or a practice set with `mode: "PRACTICE"` |
| `GET` | `/api/interviews` | List past interviews |
| `GET` | `/api/interviews/{id}` | One interview with its questions and answers |
| `POST` | `/api/interviews/{id}/questions/{id}/answers` | Submit an answer for grading |
| `POST` | `/api/cvs` | Upload a CV file |
| `GET` | `/api/cvs` | List uploaded CVs |
| `GET` | `/api/cvs/{id}` | One CV with its study checklist |
| `PATCH` | `/api/cvs/topics/{id}` | Tick or untick a checklist topic |
| `GET` | `/api/jobs/{id}` | Poll a background job (question generation, grading, CV reading) |

Anything slow (every call to the AI) runs as a background job. The frontend polls the job
until it reports `COMPLETED` or `FAILED`, so no request is left hanging on the LLM.

A practice set is an interview row with `mode = "PRACTICE"`, so it reuses the same questions,
answers, grading and job machinery. The extra columns are `practice_topic`, `practice_focus`
and `question_style` on `interviews`, and `kind`, `language`, `starter_code` and
`model_answer` on `questions`. `GET /api/interviews/{id}` blanks out `model_answer` for any
question that has not been answered yet.

## Running locally

```bash
# database
docker compose up -d db

# backend (from backend/, needs OPENAI_API_KEY in .env)
uv run uvicorn main:app --reload --port 8002

# frontend (from frontend/)
npm install
npm run dev
```

Tables are created on startup. Columns added after the first release are patched in by
`run_column_migrations()` in `db/database.py`, so an existing database does not need dropping.

## Project Status

🚧 In Development
