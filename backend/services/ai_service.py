from langchain_openai import ChatOpenAI

from core.config import settings
from core.prompts import ANSWER_EVALUATION_SYSTEM_PROMPT, QUESTION_GENERATION_SYSTEM_PROMPT
from schemas.answer import AnswerEvaluation
from schemas.question import GeneratedQuestion


def _llm() -> ChatOpenAI:
    return ChatOpenAI(model=settings.OPENAI_MODEL, api_key=settings.OPENAI_API_KEY, temperature=0.7)


def generate_question(role: str, difficulty: str) -> GeneratedQuestion:
    structured_llm = _llm().with_structured_output(GeneratedQuestion)
    prompt = QUESTION_GENERATION_SYSTEM_PROMPT.format(role=role, difficulty=difficulty)
    return structured_llm.invoke(prompt)


def evaluate_answer(question_text: str, answer_text: str) -> AnswerEvaluation:
    structured_llm = _llm().with_structured_output(AnswerEvaluation)
    prompt = ANSWER_EVALUATION_SYSTEM_PROMPT.format(question_text=question_text, answer_text=answer_text)
    return structured_llm.invoke(prompt)
