from langchain_openai import ChatOpenAI

from core.config import settings
from core.prompts import (
    ANSWER_EVALUATION_SYSTEM_PROMPT,
    CV_QUESTION_CONTEXT,
    NEXT_QUESTION_HISTORY,
    NEXT_QUESTION_OPENING,
    NEXT_QUESTION_SYSTEM_PROMPT,
    PRACTICE_CODE_NOTE,
    PRACTICE_CODING_DETAIL,
    PRACTICE_CODING_RULES,
    PRACTICE_EVALUATION_SYSTEM_PROMPT,
    PRACTICE_MIXED_RULES,
    PRACTICE_QUESTION_GENERATION_SYSTEM_PROMPT,
    PRACTICE_THEORY_RULES,
    QUESTION_GENERATION_SYSTEM_PROMPT,
    TOPIC_EXTRACTION_SYSTEM_PROMPT,
    VOICE_QUESTION_NOTE,
)
from models.interview import QuestionStyle
from models.question import QuestionKind
from schemas.answer import AnswerEvaluation
from schemas.cv import ExtractedTopicSet
from schemas.question import GeneratedNextQuestion, GeneratedPracticeSet, GeneratedQuestionSet
from services import usage_service

# which block of rules goes into the practice prompt for each style the student can pick
_STYLE_RULES = {
    QuestionStyle.THEORY: PRACTICE_THEORY_RULES,
    QuestionStyle.CODING: PRACTICE_CODING_RULES,
    QuestionStyle.MIXED: PRACTICE_MIXED_RULES,
}

# model families that reject a custom `temperature` outright - the reasoning models only run
# at their own default, and sending a number is a 400 rather than something they ignore.
# OPENAI_TEMPERATURE_MODE in .env overrides this if a future model changes the rules
_NO_CUSTOM_TEMPERATURE_PREFIXES = ("gpt-5", "gpt-6", "gpt-7", "o1", "o3", "o4")

# how much of one answer goes into the "what was just said" block of the follow-up prompt.
# the whole point of summarising is to stop the prompt growing with every question
MAX_SUMMARY_ANSWER_CHARS = 600
MAX_RECENT_EXCHANGES = 2  # only the last couple of turns are quoted back


# whether we are allowed to send this model a temperature at all
def _supports_temperature(model: str) -> bool:
    mode = (settings.OPENAI_TEMPERATURE_MODE or "auto").lower()
    if mode == "always":
        return True
    if mode == "never":
        return False

    lower = (model or "").lower()
    # the "-chat" variants of the reasoning models do take a temperature
    if "chat" in lower:
        return True
    return not lower.startswith(_NO_CUSTOM_TEMPERATURE_PREFIXES)


# builds a fresh ChatOpenAI client using our settings (model name + API key).
# temperature is how creative the AI is allowed to be - higher for writing questions,
# 0 when we want it sticking strictly to a source document. it is dropped entirely for a
# model that does not accept one, so switching models cannot start failing every call.
# the timeout and retry count are capped so a hung request cannot pin a background job open
def _llm(temperature: float = 0.7) -> ChatOpenAI:
    kwargs = {
        "model": settings.OPENAI_MODEL,
        "api_key": settings.OPENAI_API_KEY,
        "timeout": settings.OPENAI_TIMEOUT_SECONDS,
        "max_retries": settings.OPENAI_MAX_RETRIES,
    }
    if _supports_temperature(settings.OPENAI_MODEL):
        kwargs["temperature"] = temperature
    return ChatOpenAI(**kwargs)


# one call to the AI asking for a reply in the exact shape of `schema`.
#
# include_raw=True gives us the underlying message as well as the parsed object, which is the
# only way to see the token counts - they go onto `usage` (a list the caller passes in) so the
# interview can show what it spent. the parsed object is what gets returned, as before.
def _invoke_structured(schema, prompt: str, temperature: float = 0.7, purpose: str = "", usage: list | None = None):
    structured_llm = _llm(temperature).with_structured_output(schema, include_raw=True)
    result = structured_llm.invoke(prompt)

    # with include_raw the result is a dict rather than the model object itself
    if isinstance(result, dict):
        if result.get("parsing_error"):
            raise ValueError(f"The AI returned an unusable reply: {result['parsing_error']}")
        parsed = result.get("parsed")
        if usage is not None and result.get("raw") is not None:
            usage.append(usage_service.sample_from_message(result["raw"], settings.OPENAI_MODEL, purpose))
    else:
        # a stubbed client in the tests can hand the object straight back
        parsed = result

    if parsed is None:
        raise ValueError("The AI returned an empty reply.")
    return parsed


# asks the AI to write a whole interview's worth of questions in one call.
# cv_text is optional - when it's there the questions are drawn from the student's own CV.
# spoken is set for a VOICE interview, where every question has to read aloud cleanly
def generate_questions(
    role: str,
    difficulty: str,
    question_count: int,
    cv_text: str | None = None,
    spoken: bool = False,
    usage: list | None = None,
) -> GeneratedQuestionSet:
    # only include the CV block when we actually have a CV
    cv_section = CV_QUESTION_CONTEXT.format(cv_text=cv_text) if cv_text else ""
    prompt = QUESTION_GENERATION_SYSTEM_PROMPT.format(
        role=role,
        difficulty=difficulty,
        question_count=question_count,
        cv_section=cv_section,
        voice_note=VOICE_QUESTION_NOTE if spoken else "",
    )
    return _invoke_structured(GeneratedQuestionSet, prompt, purpose="generate_questions", usage=usage)


# asks the AI for the single next question of an adaptive interview, having seen a summary of
# what has been asked and what the candidate just said. `context` comes from
# build_interview_context() below
def generate_next_question(
    role: str,
    difficulty: str,
    question_number: int,
    question_count: int,
    context: str,
    usage: list | None = None,
) -> GeneratedNextQuestion:
    prompt = NEXT_QUESTION_SYSTEM_PROMPT.format(
        role=role,
        difficulty=difficulty,
        question_number=question_number,
        question_count=question_count,
        history_section=context,
    )
    return _invoke_structured(GeneratedNextQuestion, prompt, purpose="generate_next_question", usage=usage)


# turns the interview so far into the short history block the follow-up prompt gets.
#
# this is the cost control for the adaptive flow: instead of replaying the whole transcript on
# every call, the AI gets the list of questions already asked (so it cannot repeat itself), the
# topics covered, and only the last couple of exchanges - with each answer truncated.
#
# `asked` is a list of (question_text, topic, answer_text or None) in the order they were asked.
def build_interview_context(asked: list[tuple[str, str | None, str | None]]) -> str:
    if not asked:
        return NEXT_QUESTION_OPENING

    asked_list = "\n".join(f"{index}. {question}" for index, (question, _, _) in enumerate(asked, start=1))

    topics: list[str] = []
    for _, topic, _ in asked:
        if topic and topic not in topics:
            topics.append(topic)
    covered_topics = ", ".join(topics) if topics else "none recorded"

    recent = []
    for question, _, answer in asked[-MAX_RECENT_EXCHANGES:]:
        said = (answer or "").strip()
        if len(said) > MAX_SUMMARY_ANSWER_CHARS:
            said = said[:MAX_SUMMARY_ANSWER_CHARS].rstrip() + "..."
        if not said:
            said = "(no answer recorded)"
        recent.append(f"Interviewer: {question}\nCandidate: {said}")

    return NEXT_QUESTION_HISTORY.format(
        asked_list=asked_list,
        covered_topics=covered_topics,
        recent_exchange="\n\n".join(recent),
    )


# asks the AI to grade a student's answer to a question
def evaluate_answer(question_text: str, answer_text: str, usage: list | None = None) -> AnswerEvaluation:
    prompt = ANSWER_EVALUATION_SYSTEM_PROMPT.format(question_text=question_text, answer_text=answer_text)
    return _invoke_structured(AnswerEvaluation, prompt, purpose="evaluate_answer", usage=usage)


# asks the AI to write a practice set on one subject. unlike the interview questions above,
# each of these comes back with its model answer, and may be a coding task with a starter stub
def generate_practice_questions(
    topic: str,
    difficulty: str,
    question_count: int,
    question_style: str,
    focus: str | None = None,
    usage: list | None = None,
) -> GeneratedPracticeSet:
    style_rules = _STYLE_RULES.get(question_style, PRACTICE_THEORY_RULES)
    prompt = PRACTICE_QUESTION_GENERATION_SYSTEM_PROMPT.format(
        topic=topic,
        # only mention a focus when the student narrowed it down to one thing
        focus_line=f"Focus specifically on: {focus}\n" if focus else "",
        difficulty=difficulty,
        question_count=question_count,
        style_rules=style_rules,
        # the long list of coding rules is dead weight on a theory-only set
        coding_rules="" if question_style == QuestionStyle.THEORY else PRACTICE_CODING_DETAIL,
    )
    return _invoke_structured(GeneratedPracticeSet, prompt, purpose="generate_practice_questions", usage=usage)


# grades a practice answer. this one has the model answer to mark against, so the score is
# "how close did they get to this" rather than the open-ended judgement an interview gets.
# temperature 0 because marking should be as repeatable as we can make it
def evaluate_practice_answer(
    question_text: str,
    answer_text: str,
    model_answer: str,
    kind: str = QuestionKind.THEORY,
    language: str | None = None,
    usage: list | None = None,
) -> AnswerEvaluation:
    prompt = PRACTICE_EVALUATION_SYSTEM_PROMPT.format(
        question_text=question_text,
        model_answer=model_answer,
        answer_text=answer_text,
        # tell the marker it is looking at code, and which language, when it is
        code_note=(
            PRACTICE_CODE_NOTE.format(language=language or "source")
            if kind == QuestionKind.CODING
            else ""
        ),
    )
    return _invoke_structured(
        AnswerEvaluation,
        prompt,
        temperature=0,
        purpose="evaluate_practice_answer",
        usage=usage,
    )


# asks the AI to read a CV and turn it into a categorised revision checklist.
# temperature 0 so it sticks to what the CV actually says instead of inventing topics
def extract_cv_topics(cv_text: str, usage: list | None = None) -> ExtractedTopicSet:
    prompt = TOPIC_EXTRACTION_SYSTEM_PROMPT.format(cv_text=cv_text)
    return _invoke_structured(
        ExtractedTopicSet,
        prompt,
        temperature=0,
        purpose="extract_cv_topics",
        usage=usage,
    )
