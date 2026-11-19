# allow us to map env variables (from .env) to a Python object we can use and reference
from typing import List

from pydantic_settings import BaseSettings


# pydantic-settings reads these values from environment variables / the .env file
class Settings(BaseSettings):
    DATABASE_URL: str  # the Postgres connection string

    API_PREFIX: str = "/api"  # every route in this app starts with this
    DEBUG: bool = False
    ALLOWED_ORIGINS: str = ""  # comma separated list of frontend URLs allowed to call this API
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-6-luna"  # the text model: questions, follow-ups and grading
    # the speech-to-text model used by POST /api/voice/transcribe
    OPENAI_TRANSCRIPTION_MODEL: str = "gpt-transcribe"

    # ---- how we call OpenAI ----
    # a request that hangs forever would hold a background job open for ever too
    OPENAI_TIMEOUT_SECONDS: float = 60.0
    OPENAI_MAX_RETRIES: int = 2  # the SDK retries on 429/5xx with a backoff of its own
    # whether to send a custom `temperature`. the reasoning models (gpt-5/6, o-series) only
    # accept the default, and sending one is a hard 400. "auto" works it out from the model
    # name, "always"/"never" force it either way.
    OPENAI_TEMPERATURE_MODE: str = "auto"

    # ---- voice answers ----
    # a recorded answer is a minute or two of speech. anything much bigger is the wrong
    # file or an attack, and both the size and the length cap what one answer can cost
    MAX_AUDIO_BYTES: int = 10 * 1024 * 1024  # 10 MB
    MAX_AUDIO_SECONDS: int = 180  # 3 minutes per answer
    # kept off by default: a recording is only ever held in memory while it is transcribed
    STORE_AUDIO: bool = False

    # ---- rough cost estimates, only used for the optional usage summary ----
    # USD per million text tokens, and per minute of transcribed audio. these are
    # estimates for display, not billing - see GET /api/interviews/{id}/usage
    COST_PER_MILLION_INPUT_TOKENS: float = 0.0
    COST_PER_MILLION_OUTPUT_TOKENS: float = 0.0
    COST_PER_AUDIO_MINUTE: float = 0.0

    @property
    # turns "http://a.com,http://b.com" into a real Python list ["http://a.com", "http://b.com"]
    def allowed_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    class Config:
        env_file = ".env"  # load values from this file
        env_file_encoding = "utf-8"
        case_sensitive = True


# one shared settings object every other file can import
settings = Settings()
