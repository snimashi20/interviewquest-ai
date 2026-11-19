"""The voice endpoints: turning a recorded answer into text, and telling the browser the limits.

The OpenAI key never leaves the backend - the browser records the audio, posts it here, and
gets a transcript back. The recording itself is held in memory for the length of the request
and then dropped, unless STORE_AUDIO is turned on (it is off by default and nothing in the
app turns it on for you).
"""

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from core.config import settings
from db.database import get_db
from models.interview import Interview
from models.usage import UsageKind
from schemas.voice import TranscriptionResponse, VoiceLimitsResponse
from services import transcription_service, usage_service
from services.transcription_service import AudioValidationError, TranscriptionError
from services.usage_service import UsageSample

logger = logging.getLogger(__name__)

# every route below starts with /voice (main.py adds the /api prefix on top of that)
router = APIRouter(prefix="/voice", tags=["voice"])


# GET /api/voice/limits - what the recorder is allowed to send.
# the browser asks for this on mount so the limits live in one place (the backend) instead
# of being hard-coded twice and drifting apart
@router.get("/limits", response_model=VoiceLimitsResponse)
def voice_limits():
    return VoiceLimitsResponse(
        supported_content_types=sorted(transcription_service.SUPPORTED_AUDIO_TYPES),
        max_audio_bytes=settings.MAX_AUDIO_BYTES,
        max_audio_seconds=settings.MAX_AUDIO_SECONDS,
        transcription_model=settings.OPENAI_TRANSCRIPTION_MODEL,
        store_audio=settings.STORE_AUDIO,
    )


# reads the upload a chunk at a time and gives up the moment it goes over the limit, so a
# huge file is rejected without ever being held in memory in full
async def _read_capped(file: UploadFile) -> bytes:
    limit = settings.MAX_AUDIO_BYTES
    chunks: list[bytes] = []
    total = 0

    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            limit_mb = limit / (1024 * 1024)
            raise HTTPException(
                status_code=413,
                detail=f"That recording is too large. The limit is {limit_mb:.0f} MB per answer.",
            )
        chunks.append(chunk)

    return b"".join(chunks)


# POST /api/voice/transcribe - send a recorded answer, get the text back.
#
# multipart/form-data, because this is a file upload:
#   file             the recording, straight out of MediaRecorder
#   duration_seconds how long the browser says it ran (optional, used for limits and usage)
#   interview_id     optional: which interview to bill the audio minutes to
#
# the transcript is NOT saved as an answer here. it goes back to the browser so the candidate
# can read and correct it, and only becomes an answer when they submit it through the normal
# POST /api/interviews/{id}/questions/{id}/answers route
@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_answer(
    file: UploadFile = File(...),
    duration_seconds: float | None = Form(default=None),
    interview_id: int | None = Form(default=None),
    db: Session = Depends(get_db),
):
    if duration_seconds is not None and duration_seconds < 0:
        raise HTTPException(status_code=400, detail="duration_seconds cannot be negative.")

    # only charge the audio to an interview that actually exists
    interview = None
    if interview_id is not None:
        interview = db.query(Interview).filter(Interview.id == interview_id).first()
        if interview is None:
            raise HTTPException(status_code=404, detail="Interview not found")

    data = await _read_capped(file)

    try:
        result = transcription_service.transcribe(
            data,
            file.content_type,
            duration_seconds=duration_seconds,
        )
    except AudioValidationError as exc:
        # the recording itself is the problem (empty, silent, wrong format) - the candidate
        # can fix that by recording again, so this is a 400 rather than a server error
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TranscriptionError as exc:
        # the service failed. 503 tells the frontend to offer a retry rather than a re-record
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        # drop the file handle either way. nothing was written to disk unless Starlette
        # spooled a large upload, and closing it removes that too
        await file.close()

    # usage is numbers only: which model, and how many seconds of audio
    if interview is not None:
        usage_service.record(
            db,
            UsageSample(
                kind=UsageKind.TRANSCRIPTION,
                model=result.model,
                purpose="transcribe_answer",
                audio_seconds=result.audio_seconds,
            ),
            interview_id=interview.id,
        )
        db.commit()

    return TranscriptionResponse(
        text=result.text,
        model=result.model,
        audio_seconds=result.audio_seconds,
        characters=len(result.text),
    )
