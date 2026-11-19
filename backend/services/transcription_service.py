"""Turning a recorded answer into text with the OpenAI transcription API.

Everything about audio stays in this one module, so swapping the model - or moving to a true
realtime speech-to-speech API later - does not touch the interview logic at all.

The recording is never written to disk: it arrives as bytes, is handed to the API from memory,
and is dropped when this function returns. Nothing about the audio is logged.
"""

import logging
import re
from dataclasses import dataclass

from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI, RateLimitError

from core.config import settings

logger = logging.getLogger(__name__)

# the container formats the API accepts. MediaRecorder in Chrome produces audio/webm, Safari
# produces audio/mp4, and Firefox audio/ogg - all three are on the list
SUPPORTED_AUDIO_TYPES = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mpga": "mp3",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/flac": "flac",
    "video/webm": "webm",  # what Chrome calls a webm recording when it includes no video
    "video/mp4": "mp4",
}

# a recording shorter than this is a mis-click or a mic that never opened, not an answer
MIN_AUDIO_BYTES = 1024  # 1 KB

# technical words a general transcriber mangles, especially over a non-US accent. these go to
# the API as `keywords`, which gpt-transcribe uses as a hint rather than a hard constraint
TECHNICAL_KEYWORDS = [
    "React",
    "Node.js",
    "TypeScript",
    "JavaScript",
    "Python",
    "FastAPI",
    "Django",
    "Spring Boot",
    "Java",
    "Kotlin",
    ".NET",
    "PostgreSQL",
    "MySQL",
    "MongoDB",
    "Redis",
    "SQL",
    "Docker",
    "Kubernetes",
    "RabbitMQ",
    "Kafka",
    "AWS",
    "Azure",
    "GCP",
    "CI/CD",
    "Git",
    "GitHub",
    "REST API",
    "GraphQL",
    "microservices",
    "OAuth",
    "JWT",
    "SQLAlchemy",
    "Nginx",
    "Linux",
    "Agile",
    "Scrum",
    "unit testing",
    "load balancer",
    "caching",
    "indexing",
    "normalisation",
    "Big O",
]

# the style hint. English, technical, and left as prose rather than a word list so the model
# treats it as context for how the audio sounds rather than text to continue
TRANSCRIPTION_PROMPT = (
    "This is a candidate answering a software engineering interview question in English. "
    "The speaker may have a Sri Lankan or South Asian accent. Expect technical vocabulary, "
    "product names and acronyms. Transcribe what is said, with normal punctuation."
)


# a recording we will not even try to transcribe - the router turns this into a 400 so the
# candidate is told why rather than being left looking at a spinner
class AudioValidationError(Exception):
    pass


# the API call itself failed (network, rate limit, bad key, timeout). the router turns this
# into a 502/503 and the frontend offers a retry, with the recording still in the browser
class TranscriptionError(Exception):
    pass


@dataclass
class TranscriptionResult:
    text: str
    model: str
    # what the browser said the recording's length was, passed through for the usage estimate
    audio_seconds: float | None = None


# one shared client. OpenAI() reads nothing from the environment that we do not set here,
# and both the timeout and the retry count are ours rather than the library defaults
_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        if not settings.OPENAI_API_KEY:
            raise TranscriptionError("No OpenAI API key is configured on the server.")
        _client = OpenAI(
            api_key=settings.OPENAI_API_KEY,
            timeout=settings.OPENAI_TIMEOUT_SECONDS,
            max_retries=settings.OPENAI_MAX_RETRIES,
        )
    return _client


# "audio/webm;codecs=opus" -> "audio/webm". MediaRecorder always reports the codec too
def normalise_content_type(content_type: str | None) -> str:
    return (content_type or "").split(";")[0].strip().lower()


# checks the upload before it costs anything: a known container, not empty, not oversized,
# and not longer than one answer is allowed to be
def validate_audio(data: bytes, content_type: str | None, duration_seconds: float | None = None) -> str:
    kind = normalise_content_type(content_type)

    if kind not in SUPPORTED_AUDIO_TYPES:
        supported = ", ".join(sorted(SUPPORTED_AUDIO_TYPES))
        raise AudioValidationError(
            f"Unsupported audio format '{kind or 'unknown'}'. Supported formats: {supported}."
        )

    if not data:
        raise AudioValidationError("The recording was empty. Please record your answer again.")

    if len(data) < MIN_AUDIO_BYTES:
        raise AudioValidationError(
            "That recording is too short to transcribe. Please hold the microphone open and speak your answer."
        )

    if len(data) > settings.MAX_AUDIO_BYTES:
        limit_mb = settings.MAX_AUDIO_BYTES / (1024 * 1024)
        raise AudioValidationError(f"That recording is too large. The limit is {limit_mb:.0f} MB per answer.")

    if duration_seconds is not None and duration_seconds > settings.MAX_AUDIO_SECONDS:
        raise AudioValidationError(
            f"That recording is too long. The limit is {settings.MAX_AUDIO_SECONDS} seconds per answer."
        )

    return SUPPORTED_AUDIO_TYPES[kind]


# collapses the whitespace a transcriber sometimes leaves behind, without touching the words
def _tidy(text: str) -> str:
    return re.sub(r"[ \t]+", " ", (text or "").strip())


# sends one recording to the transcription model and hands back the text.
#
# `data` is the raw bytes of the upload, held in memory only. `duration_seconds` is what the
# browser measured - it is only used for validation and the usage estimate, never trusted as
# the real length of the audio.
def transcribe(
    data: bytes,
    content_type: str | None,
    duration_seconds: float | None = None,
) -> TranscriptionResult:
    extension = validate_audio(data, content_type, duration_seconds)
    model = settings.OPENAI_TRANSCRIPTION_MODEL

    # the API identifies the container from the filename and content type, so both are sent.
    # the name is a constant: the candidate's own filename is never used or stored
    upload = (f"answer.{extension}", data, normalise_content_type(content_type))

    try:
        response = _get_client().audio.transcriptions.create(
            file=upload,
            model=model,
            language="en",
            prompt=TRANSCRIPTION_PROMPT,
            keywords=TECHNICAL_KEYWORDS,
            response_format="json",
        )
    except APIStatusError as exc:
        # `keywords` is only supported by gpt-transcribe. if the configured model rejects it,
        # fall back to the plain call rather than failing the answer outright
        if exc.status_code == 400:
            logger.warning("Transcription rejected the hint parameters (model=%s); retrying without them.", model)
            try:
                response = _get_client().audio.transcriptions.create(
                    file=upload,
                    model=model,
                    language="en",
                    response_format="json",
                )
            except Exception as retry_exc:  # noqa: BLE001 - reported as a transcription failure
                raise TranscriptionError(_describe(retry_exc)) from retry_exc
        else:
            raise TranscriptionError(_describe(exc)) from exc
    except (APITimeoutError, APIConnectionError, RateLimitError) as exc:
        raise TranscriptionError(_describe(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - never leak a stack trace to the candidate
        raise TranscriptionError(_describe(exc)) from exc

    text = _tidy(getattr(response, "text", "") or "")
    if not text:
        raise AudioValidationError(
            "No speech was detected in that recording. Please check your microphone and try again."
        )

    # length and model only - the transcript itself is never logged
    logger.info("Transcribed %d bytes of audio with %s (%d characters).", len(data), model, len(text))
    return TranscriptionResult(text=text, model=model, audio_seconds=duration_seconds)


# turns an SDK exception into something worth showing a candidate mid-interview
def _describe(exc: Exception) -> str:
    if isinstance(exc, APITimeoutError):
        return "The transcription service timed out. Your recording was kept - please try again."
    if isinstance(exc, RateLimitError):
        return "The transcription service is rate limited right now. Please wait a moment and try again."
    if isinstance(exc, APIConnectionError):
        return "Could not reach the transcription service. Check the server's internet connection."
    if isinstance(exc, APIStatusError):
        if exc.status_code == 401:
            return "The server's OpenAI API key was rejected."
        if exc.status_code == 429:
            return "The transcription service is rate limited right now. Please wait a moment and try again."
        return f"The transcription service returned an error (HTTP {exc.status_code})."
    return "Transcription failed. Your recording was kept - please try again."
