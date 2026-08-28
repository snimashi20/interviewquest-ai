from langchain_openai import ChatOpenAI

from core.config import settings
from core.prompts import QUESTION_GENERATION_SYSTEM_PROMPT
from schemas.question import GeneratedQuestion


def _llm() -> ChatOpenAI:
    return ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY, temperature=0.7)


def generate_question(role: str, difficulty: str) -> GeneratedQuestion:
    structured_llm = _llm().with_structured_output(GeneratedQuestion)
    prompt = QUESTION_GENERATION_SYSTEM_PROMPT.format(role=role, difficulty=difficulty)
    return structured_llm.invoke(prompt)
