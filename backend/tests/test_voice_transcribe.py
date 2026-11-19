"""POST /api/voice/transcribe and the audio validation in front of it.

The OpenAI call is stubbed in every test here, so the suite never uploads audio anywhere.
"""

import pytest

from core.config import settings
from services import transcription_service
from services.transcription_service import (
    AudioValidationError,
    TranscriptionError,
    TranscriptionResult,
)

# a byte string long enough to clear the "that was a mis-click" floor
VALID_AUDIO = b"\x1a\x45\xdf\xa3" + b"0" * 4096


@pytest.fixture
def fake_transcribe(monkeypatch):
    """Stands in for the OpenAI call and records what it was handed."""
    calls = []

    def transcribe(data, content_type, duration_seconds=None):
        calls.append({"bytes": len(data), "content_type": content_type, "duration": duration_seconds})
        # the real service validates first, so keep that behaviour in the stub
        transcription_service.validate_audio(data, content_type, duration_seconds)
        return TranscriptionResult(
            text="I would index the column and measure the query again.",
            model="gpt-transcribe",
            audio_seconds=duration_seconds,
        )

    monkeypatch.setattr("routers.voice.transcription_service.transcribe", transcribe)
    return calls


def _post(client, **kwargs):
    files = kwargs.pop("files", {"file": ("answer.webm", VALID_AUDIO, "audio/webm")})
    return client.post("/api/voice/transcribe", files=files, data=kwargs)


# ---------------- the happy path ----------------


def test_a_recording_comes_back_as_text(client, fake_transcribe):
    response = _post(client, duration_seconds="18.25")
    assert response.status_code == 200

    body = response.json()
    assert body["text"] == "I would index the column and measure the query again."
    assert body["model"] == "gpt-transcribe"
    assert body["audio_seconds"] == 18.25
    assert body["characters"] == len(body["text"])

    # the whole recording reached the service, with the browser's own content type
    assert fake_transcribe[0]["bytes"] == len(VALID_AUDIO)
    assert fake_transcribe[0]["content_type"] == "audio/webm"


def test_transcribing_does_not_create_an_answer(client, fake_transcribe, fake_ai):
    """The transcript is for the candidate to check - only submitting it makes it an answer."""
    interview_id = client.post(
        "/api/interviews",
        json={"role": "Backend Developer", "difficulty": "Intermediate", "question_count": 2,
              "interview_type": "VOICE"},
    ).json()["interview_id"]

    _post(client, duration_seconds="12", interview_id=str(interview_id))

    interview = client.get(f"/api/interviews/{interview_id}").json()
    assert all(question["answer"] is None for question in interview["questions"])


def test_audio_seconds_are_billed_to_the_interview(client, fake_transcribe, fake_ai):
    interview_id = client.post(
        "/api/interviews",
        json={"role": "Backend Developer", "difficulty": "Intermediate", "question_count": 2,
              "interview_type": "VOICE"},
    ).json()["interview_id"]

    _post(client, duration_seconds="30", interview_id=str(interview_id))
    _post(client, duration_seconds="12.5", interview_id=str(interview_id))

    usage = client.get(f"/api/interviews/{interview_id}/usage").json()
    assert usage["transcription_calls"] == 2
    assert usage["audio_seconds"] == 42.5


def test_an_unknown_interview_id_is_rejected(client, fake_transcribe):
    response = _post(client, interview_id="4242")
    assert response.status_code == 404
    # nothing was sent for transcription
    assert fake_transcribe == []


def test_the_codec_suffix_on_the_content_type_is_accepted(client, fake_transcribe):
    response = _post(client, files={"file": ("answer.webm", VALID_AUDIO, "audio/webm;codecs=opus")})
    assert response.status_code == 200


# ---------------- bad uploads ----------------


def test_an_empty_recording_is_rejected(client, fake_transcribe):
    response = _post(client, files={"file": ("answer.webm", b"", "audio/webm")})
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_a_recording_of_a_few_bytes_is_rejected(client, fake_transcribe):
    response = _post(client, files={"file": ("answer.webm", b"\x00\x01\x02", "audio/webm")})
    assert response.status_code == 400
    assert "too short" in response.json()["detail"].lower()


def test_an_unsupported_format_is_rejected(client, fake_transcribe):
    response = _post(client, files={"file": ("answer.txt", VALID_AUDIO, "text/plain")})
    assert response.status_code == 400
    assert "unsupported audio format" in response.json()["detail"].lower()


def test_an_oversized_upload_is_rejected_before_it_is_sent(client, fake_transcribe, monkeypatch):
    monkeypatch.setattr(settings, "MAX_AUDIO_BYTES", 4096)
    response = _post(client, files={"file": ("answer.webm", b"0" * 9000, "audio/webm")})
    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()
    # the point of the cap: nothing reached the paid API
    assert fake_transcribe == []


def test_a_recording_longer_than_the_limit_is_rejected(client, fake_transcribe, monkeypatch):
    monkeypatch.setattr(settings, "MAX_AUDIO_SECONDS", 60)
    response = _post(client, duration_seconds="95")
    assert response.status_code == 400
    assert "too long" in response.json()["detail"].lower()


def test_a_negative_duration_is_rejected(client, fake_transcribe):
    response = _post(client, duration_seconds="-3")
    assert response.status_code == 400


# ---------------- when the API itself fails ----------------


def test_a_transcription_failure_is_a_503_with_a_readable_message(client, monkeypatch):
    def boom(data, content_type, duration_seconds=None):
        raise TranscriptionError("The transcription service timed out. Your recording was kept - please try again.")

    monkeypatch.setattr("routers.voice.transcription_service.transcribe", boom)
    response = _post(client, duration_seconds="10")
    assert response.status_code == 503
    assert "try again" in response.json()["detail"]


def test_silence_in_the_recording_is_reported_as_a_bad_recording(client, monkeypatch):
    def silent(data, content_type, duration_seconds=None):
        raise AudioValidationError("No speech was detected in that recording.")

    monkeypatch.setattr("routers.voice.transcription_service.transcribe", silent)
    response = _post(client, duration_seconds="10")
    assert response.status_code == 400
    assert "no speech" in response.json()["detail"].lower()


# ---------------- the limits endpoint ----------------


def test_the_browser_can_read_the_limits(client):
    body = client.get("/api/voice/limits").json()
    assert "audio/webm" in body["supported_content_types"]
    assert body["max_audio_bytes"] == settings.MAX_AUDIO_BYTES
    assert body["max_audio_seconds"] == settings.MAX_AUDIO_SECONDS
    assert body["transcription_model"] == settings.OPENAI_TRANSCRIPTION_MODEL
    # recordings are not kept unless someone turns that on deliberately
    assert body["store_audio"] is False


# ---------------- the validation helper on its own ----------------


def test_validate_audio_maps_a_content_type_to_a_file_extension():
    assert transcription_service.validate_audio(VALID_AUDIO, "audio/webm") == "webm"
    assert transcription_service.validate_audio(VALID_AUDIO, "audio/mp4") == "mp4"
    assert transcription_service.validate_audio(VALID_AUDIO, "AUDIO/WAV") == "wav"


def test_validate_audio_rejects_a_missing_content_type():
    with pytest.raises(AudioValidationError):
        transcription_service.validate_audio(VALID_AUDIO, None)


def test_normalise_content_type_drops_the_codec():
    assert transcription_service.normalise_content_type("audio/webm;codecs=opus") == "audio/webm"
    assert transcription_service.normalise_content_type(None) == ""
