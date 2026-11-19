# InterviewQuest AI

An AI-powered technical interview simulator that generates interview questions and evaluates user
responses using an LLM. Interviews can be **typed** or **spoken**: in a voice interview the
interviewer reads each question aloud, the candidate answers out loud, and the recording is
transcribed on the backend before it is graded.

## Features

### Mock interview

- Select interview role
- Select difficulty level
- Choose **Text interview** (type your answers) or **Voice interview** (speak them)
- Choose how many questions the interview asks (5, 10 or 15 - 10 by default)
- Optionally base the questions on your own CV
- Generate AI-powered interview questions
- Answer one question at a time, with a progress indicator
- Receive AI-generated feedback and a score per answer, plus an overall score
- Store interview history

### Voice interview

- The AI interviewer reads each question aloud using the browser's own speech synthesis
  (free - no paid text-to-speech API)
- Answer by speaking: the microphone records you, and the backend transcribes the recording
- Read and correct the transcript before it is submitted - the text is what gets graded
- Questions are written **one at a time**, each one aware of what you just said, so the
  interview follows up on your answers instead of reading from a fixed list
- Switch between speaking and typing at any point, mid-interview
- Mute the interviewer, pick a voice, change the speaking speed, replay a question
- Optional: stop recording automatically when you stop talking
- Optional: submit without reviewing the transcript (off by default)
- End the interview early - whatever has been graded still counts

This is **near-live turn-based conversation**, not a full-duplex realtime system: the interviewer
finishes speaking, then you answer, then the answer is transcribed. All audio work is isolated in
`backend/services/transcription_service.py` and the three frontend hooks, so a true realtime
speech-to-speech API could be added later without touching the interview logic.

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

### Practice

- Drill one subject at a time, with model answers revealed after your attempt
- Coding tasks run in the browser in a code workspace

## Tech Stack

### Frontend

- React
- JavaScript
- React Router
- Web Speech API (`speechSynthesis`) for reading questions aloud
- `MediaRecorder` + `getUserMedia` for recording answers
- Vitest + Testing Library for the hook tests

### Backend

- Python
- FastAPI
- UV
- pypdf and python-docx for reading uploaded CVs
- pytest for the test suite

### Database

- PostgreSQL
- SQLAlchemy

### AI

- OpenAI API (text and transcription)
- LangChain

### Deployment

- Choreo

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Health check |
| `POST` | `/api/interviews` | Start an interview (optionally with `cv_id`, `interview_type`, `question_flow`) |
| `GET` | `/api/interviews` | List past interviews |
| `GET` | `/api/interviews/{id}` | One interview with its questions and answers |
| `POST` | `/api/interviews/{id}/questions/{id}/answers` | Submit an answer for grading |
| `POST` | `/api/interviews/{id}/next-question` | Ask an adaptive interview for its next question |
| `POST` | `/api/interviews/{id}/end` | End an interview early |
| `GET` | `/api/interviews/{id}/usage` | Estimated API usage for one interview |
| `POST` | `/api/voice/transcribe` | Send a recorded answer, get the transcript back |
| `GET` | `/api/voice/limits` | The audio formats and size/length caps the backend accepts |
| `POST` | `/api/cvs` | Upload a CV file |
| `GET` | `/api/cvs` | List uploaded CVs |
| `GET` | `/api/cvs/{id}` | One CV with its study checklist |
| `PATCH` | `/api/cvs/topics/{id}` | Tick or untick a checklist topic |
| `GET` | `/api/jobs/{id}` | Poll a background job (question generation, grading, CV reading) |

Anything slow (every call to the AI) runs as a background job. The frontend polls the job
until it reports `COMPLETED` or `FAILED`, so no request is left hanging on the LLM.
Transcription is the exception: it is a single request that returns the text, with a timeout.

**Every OpenAI call is made by the backend.** The API key is never sent to the browser.

### How an interview's questions get written

An interview has a `question_flow`:

- **`BATCH`** - the whole question set is written in one AI call before the interview starts.
  This is the original behaviour and the default for a text interview.
- **`ADAPTIVE`** - one question at a time. The opening question is written when the interview
  starts; each later one is written after the previous answer has been graded, from a short
  summary of the interview so far (the questions already asked, the topics covered, and the last
  two exchanges with the answers truncated). The default for a voice interview.

The summary is deliberately not the full transcript: a 15-question interview would otherwise send
the whole conversation 15 times over.

## Running locally

```bash
# database
docker compose up -d db

# backend (from backend/, needs OPENAI_API_KEY in .env - see .env.example)
uv sync
uv run uvicorn main:app --reload --port 8002

# frontend (from frontend/)
npm install
npm run dev
```

Tables are created on startup. Columns added after the first release are patched in by
`run_column_migrations()` in `db/database.py`, so an existing database does not need dropping.

### Environment variables

Required in `backend/.env`:

```env
DATABASE_URL=postgresql+psycopg2://interviewquest:interviewquest@localhost:5433/interviewquest
ALLOWED_ORIGINS=http://localhost:5174
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-6-luna
OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe
```

`backend/.env.example` lists the optional ones too: request timeouts and retries, the audio size
and length caps, and the rates used for the estimated usage summary. With no rates configured the
summary shows call and token counts but no cost, rather than inventing one.

`frontend/.env` needs only `VITE_API_URL=http://localhost:8002/api`.

### Trying the microphone and transcription

1. Open the app on `http://localhost:5174` - **localhost or https only**, because browsers block
   the microphone anywhere else.
2. Start an interview and pick **Voice interview**.
3. The first question is read aloud. If you hear nothing, check the **Interviewer audible**
   toggle and the voice chosen under **Voice settings** - some browsers ship no voices at all,
   in which case the question is shown on screen only and everything else still works.
4. Press **Start speaking**. The browser asks for microphone permission the first time; the level
   meter should move while you talk.
5. Press **Stop speaking**. The recording is posted to `/api/voice/transcribe` and the transcript
   appears in an editable box. Correct anything it misheard, then submit.
6. If transcription fails, press **Try transcribing again** - the recording is still in the
   browser, so you do not have to say it all again.

To check the endpoint without the UI:

```bash
curl -F "file=@answer.webm;type=audio/webm" -F "duration_seconds=12" \
  http://localhost:8002/api/voice/transcribe
```

## Tests

```bash
# backend (from backend/)
uv run pytest -q

# frontend (from frontend/)
npm test
npm run lint
npm run build
```

Every AI call is stubbed in both suites, so running the tests costs nothing and never records
audio or opens a microphone.

## Browser support and limitations

- **Recording** needs `MediaRecorder` and `getUserMedia`: Chrome, Edge and Safari, served over
  https or on localhost. The recording format is negotiated at runtime (webm/opus on Chrome and
  Edge, mp4 on Safari, ogg on Firefox) rather than assumed.
- **Reading questions aloud** uses the browser's own voices, so which voices exist - and how good
  they sound - depends on the browser and the operating system. Firefox on Linux often ships
  none. The interview is fully usable without them.
- Speech synthesis and recording are deliberately never active at the same time, so the
  microphone does not record the question being played out of the speakers. Starting an answer
  early stops the interviewer talking.
- Recordings are held in memory for the length of the transcription request and then dropped.
  Nothing is stored unless `STORE_AUDIO` is turned on, and nothing in the app turns it on for you.
- Spoken answers are capped at 3 minutes and 10 MB each (both configurable), which is also the
  cost control.

## Project Status

🚧 In Development
