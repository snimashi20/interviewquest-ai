from typing import List, Optional

from pydantic import BaseModel


# what POST /api/voice/transcribe sends back once the recording has been turned into text
class TranscriptionResponse(BaseModel):
    text: str  # the transcript, for the candidate to read and correct before submitting
    model: str  # which transcription model produced it
    audio_seconds: Optional[float] = None  # the length the browser reported, echoed back
    characters: int  # length of the transcript, so the frontend can spot a near-empty one


# what GET /api/voice/limits sends back: everything the recorder needs to know before it
# starts, so the browser isn't hard-coding limits the backend actually enforces
class VoiceLimitsResponse(BaseModel):
    supported_content_types: List[str]
    max_audio_bytes: int
    max_audio_seconds: int
    transcription_model: str
    store_audio: bool  # whether the server keeps recordings (off by default)
