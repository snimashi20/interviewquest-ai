"""The interview itself: voice and text, adaptive and batch, start to finish.

No test here reaches OpenAI - the `fake_ai` fixture stands in for every AI call.
"""

from models.interview import Interview, InterviewStatus, InterviewType, QuestionFlow

VOICE_PAYLOAD = {
    "role": "Backend Developer",
    "difficulty": "Intermediate",
    "question_count": 3,
    "interview_type": "VOICE",
}


# ---------------- starting an interview ----------------


def test_voice_interview_starts_adaptive_with_one_question(client, fake_ai):
    response = client.post("/api/interviews", json=VOICE_PAYLOAD)
    assert response.status_code == 201
    interview_id = response.json()["interview_id"]

    interview = client.get(f"/api/interviews/{interview_id}").json()
    assert interview["interview_type"] == InterviewType.VOICE
    # a voice interview defaults to the conversational flow without being asked
    assert interview["question_flow"] == QuestionFlow.ADAPTIVE
    assert interview["question_count"] == 3
    assert interview["status"] == InterviewStatus.IN_PROGRESS
    # ...and only the opening question exists so far
    assert len(interview["questions"]) == 1
    assert interview["questions"][0]["question_number"] == 1
    assert interview["questions"][0]["is_followup"] is False
    assert len(fake_ai["generate_next_question"]) == 1
    assert fake_ai["generate_next_question"][0]["number"] == 1


def test_legacy_text_payload_still_writes_the_whole_set(client, fake_ai):
    """The original frontend payload must behave exactly as it did before voice existed."""
    response = client.post(
        "/api/interviews",
        json={"role": "Frontend Developer", "difficulty": "Beginner", "question_count": 5},
    )
    assert response.status_code == 201
    interview_id = response.json()["interview_id"]

    interview = client.get(f"/api/interviews/{interview_id}").json()
    assert interview["interview_type"] == InterviewType.TEXT
    assert interview["question_flow"] == QuestionFlow.BATCH
    assert len(interview["questions"]) == 5
    # one AI call wrote all five, and it was not asked for spoken-friendly wording
    assert len(fake_ai["generate_questions"]) == 1
    assert fake_ai["generate_questions"][0]["spoken"] is False
    assert fake_ai["generate_next_question"] == []


def test_voice_batch_interview_asks_for_spoken_questions(client, fake_ai):
    """A voice interview can opt out of the adaptive flow and still read aloud cleanly."""
    response = client.post(
        "/api/interviews",
        json={**VOICE_PAYLOAD, "question_flow": "BATCH"},
    )
    assert response.status_code == 201
    assert fake_ai["generate_questions"][0]["spoken"] is True


def test_question_count_of_fifteen_is_accepted(client, fake_ai):
    response = client.post("/api/interviews", json={**VOICE_PAYLOAD, "question_count": 15})
    assert response.status_code == 201
    assert client.get(f"/api/interviews/{response.json()['interview_id']}").json()["question_count"] == 15


def test_question_count_above_the_maximum_is_rejected(client, fake_ai):
    response = client.post("/api/interviews", json={**VOICE_PAYLOAD, "question_count": 16})
    assert response.status_code == 422


def test_practice_mode_cannot_be_a_voice_interview(client, fake_ai):
    response = client.post(
        "/api/interviews",
        json={
            "role": "Backend Developer",
            "difficulty": "Intermediate",
            "mode": "PRACTICE",
            "practice_topic": "Databases",
            "interview_type": "VOICE",
        },
    )
    assert response.status_code == 422


# ---------------- answering ----------------


def _current_question(client, interview_id):
    interview = client.get(f"/api/interviews/{interview_id}").json()
    for question in interview["questions"]:
        if question["answer"] is None:
            return question
    return None


def test_spoken_answer_is_graded_and_recorded_as_spoken(client, fake_ai):
    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]
    question = _current_question(client, interview_id)

    response = client.post(
        f"/api/interviews/{interview_id}/questions/{question['id']}/answers",
        json={
            "answer_text": "I would start by profiling the slow endpoint.",
            "source": "SPOKEN",
            "audio_seconds": 24.5,
            "transcript_edited": True,
        },
    )
    assert response.status_code == 201
    # the response is the job as it stood when it was created; the grading runs right after,
    # so the job is COMPLETED by the time we ask about it again
    assert client.get(f"/api/jobs/{response.json()['id']}").json()["status"] == "COMPLETED"

    answered = client.get(f"/api/interviews/{interview_id}").json()["questions"][0]["answer"]
    assert answered["source"] == "SPOKEN"
    assert answered["audio_seconds"] == 24.5
    assert answered["transcript_edited"] is True
    assert answered["score"] == 72
    assert answered["strengths"] == ["Clear explanation"]


def test_typed_answer_defaults_to_typed_source(client, fake_ai):
    interview_id = client.post(
        "/api/interviews", json={"role": "Backend Developer", "difficulty": "Beginner", "question_count": 2}
    ).json()["interview_id"]
    question = _current_question(client, interview_id)

    # the original payload shape, with no voice fields at all
    response = client.post(
        f"/api/interviews/{interview_id}/questions/{question['id']}/answers",
        json={"answer_text": "Typed answer."},
    )
    assert response.status_code == 201
    assert client.get(f"/api/interviews/{interview_id}").json()["questions"][0]["answer"]["source"] == "TYPED"


def test_silence_is_not_an_answer(client, fake_ai):
    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]
    question = _current_question(client, interview_id)

    for blank in ("", "   ", "\n\t "):
        response = client.post(
            f"/api/interviews/{interview_id}/questions/{question['id']}/answers",
            json={"answer_text": blank, "source": "SPOKEN"},
        )
        assert response.status_code == 422, blank


def test_an_answer_cannot_be_submitted_twice(client, fake_ai):
    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]
    question = _current_question(client, interview_id)
    path = f"/api/interviews/{interview_id}/questions/{question['id']}/answers"

    assert client.post(path, json={"answer_text": "First answer."}).status_code == 201
    duplicate = client.post(path, json={"answer_text": "Second answer."})
    assert duplicate.status_code == 400
    assert "already submitted" in duplicate.json()["detail"]
    # the duplicate was not graded a second time
    assert len(fake_ai["evaluate_answer"]) == 1


def test_an_unknown_source_is_rejected(client, fake_ai):
    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]
    question = _current_question(client, interview_id)
    response = client.post(
        f"/api/interviews/{interview_id}/questions/{question['id']}/answers",
        json={"answer_text": "Answer.", "source": "SHOUTED"},
    )
    assert response.status_code == 422


# ---------------- the adaptive turn-taking ----------------


def test_next_question_waits_until_the_current_one_is_answered(client, fake_ai):
    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]

    # question 1 is on the table and unanswered, so there is nothing to generate
    response = client.post(f"/api/interviews/{interview_id}/next-question")
    assert response.status_code == 200
    assert response.json() == {"job_id": None, "question_ready": True}
    assert len(fake_ai["generate_next_question"]) == 1  # no second call


def test_next_question_sees_the_previous_answer(client, fake_ai):
    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]
    question = _current_question(client, interview_id)
    client.post(
        f"/api/interviews/{interview_id}/questions/{question['id']}/answers",
        json={"answer_text": "I used Redis to cache the hot rows.", "source": "SPOKEN"},
    )

    response = client.post(f"/api/interviews/{interview_id}/next-question")
    assert response.status_code == 200
    assert response.json()["question_ready"] is False
    assert response.json()["job_id"]

    # the follow-up prompt was given the previous exchange, and the questions already asked
    context = fake_ai["generate_next_question"][-1]["context"]
    assert "Redis" in context
    assert "Adaptive question 1" in context

    interview = client.get(f"/api/interviews/{interview_id}").json()
    assert len(interview["questions"]) == 2
    assert interview["questions"][1]["question_number"] == 2
    assert interview["questions"][1]["is_followup"] is True


def test_a_full_adaptive_interview_completes_after_its_last_question(client, fake_ai):
    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]

    for turn in range(3):
        question = _current_question(client, interview_id)
        assert question is not None, f"no question to answer on turn {turn + 1}"
        client.post(
            f"/api/interviews/{interview_id}/questions/{question['id']}/answers",
            json={"answer_text": f"Answer number {turn + 1}.", "source": "SPOKEN", "audio_seconds": 20},
        )
        interview = client.get(f"/api/interviews/{interview_id}").json()
        if turn < 2:
            # mid-interview: every question so far is answered but the interview is not over
            assert interview["status"] == InterviewStatus.IN_PROGRESS
            assert interview["awaiting_next_question"] is True
            client.post(f"/api/interviews/{interview_id}/next-question")

    interview = client.get(f"/api/interviews/{interview_id}").json()
    assert len(interview["questions"]) == 3
    assert interview["status"] == InterviewStatus.COMPLETED
    assert interview["awaiting_next_question"] is False
    assert interview["overall_score"] == 72
    assert interview["completed_at"] is not None
    assert interview["duration_seconds"] is not None
    assert interview["ended_early"] is False

    # exactly three questions and three gradings - nothing was generated twice
    assert len(fake_ai["generate_next_question"]) == 3
    assert len(fake_ai["evaluate_answer"]) == 3

    # and the finished interview is closed for good
    extra = client.post(f"/api/interviews/{interview_id}/next-question")
    assert extra.status_code == 400


def test_next_question_is_not_available_on_a_batch_interview(client, fake_ai):
    interview_id = client.post(
        "/api/interviews", json={"role": "Backend Developer", "difficulty": "Beginner", "question_count": 2}
    ).json()["interview_id"]
    response = client.post(f"/api/interviews/{interview_id}/next-question")
    assert response.status_code == 400
    assert "written up front" in response.json()["detail"]


def test_a_failed_follow_up_keeps_the_answers_already_given(client, fake_ai, monkeypatch):
    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]
    question = _current_question(client, interview_id)
    client.post(
        f"/api/interviews/{interview_id}/questions/{question['id']}/answers",
        json={"answer_text": "A good first answer.", "source": "SPOKEN"},
    )

    def boom(*args, **kwargs):
        raise RuntimeError("OpenAI is down")

    monkeypatch.setattr("services.interview_service.ai_service.generate_next_question", boom)
    response = client.post(f"/api/interviews/{interview_id}/next-question")
    job_id = response.json()["job_id"]

    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "FAILED"
    assert "OpenAI is down" in job["error"]

    # the interview is still usable: one question, one graded answer, nothing lost
    interview = client.get(f"/api/interviews/{interview_id}").json()
    assert interview["status"] == InterviewStatus.IN_PROGRESS
    assert len(interview["questions"]) == 1
    assert interview["questions"][0]["answer"]["score"] == 72


def test_question_generation_failure_is_reported_on_the_job(client, fake_ai, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("No API key configured")

    monkeypatch.setattr("services.interview_service.ai_service.generate_next_question", boom)
    created = client.post("/api/interviews", json=VOICE_PAYLOAD).json()

    job = client.get(f"/api/jobs/{created['job_id']}").json()
    assert job["status"] == "FAILED"
    assert "No API key configured" in job["error"]
    assert client.get(f"/api/interviews/{created['interview_id']}").json()["status"] == InterviewStatus.FAILED


# ---------------- ending early ----------------


def test_ending_early_keeps_the_scores_already_earned(client, fake_ai):
    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]
    question = _current_question(client, interview_id)
    client.post(
        f"/api/interviews/{interview_id}/questions/{question['id']}/answers",
        json={"answer_text": "Only answering one of the three.", "source": "SPOKEN"},
    )

    response = client.post(f"/api/interviews/{interview_id}/end")
    assert response.status_code == 200
    ended = response.json()
    assert ended["status"] == InterviewStatus.COMPLETED
    assert ended["ended_early"] is True
    assert ended["overall_score"] == 72  # the one graded answer, not an invented average
    assert ended["duration_seconds"] is not None

    # and no further answers are accepted
    interview = client.get(f"/api/interviews/{interview_id}").json()
    assert interview["questions"][0]["answer"] is not None
    blocked = client.post(
        f"/api/interviews/{interview_id}/questions/{question['id']}/answers",
        json={"answer_text": "Sneaking one in."},
    )
    assert blocked.status_code == 400


def test_ending_an_interview_twice_is_harmless(client, fake_ai):
    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]
    first = client.post(f"/api/interviews/{interview_id}/end").json()
    second = client.post(f"/api/interviews/{interview_id}/end").json()
    assert first["completed_at"] == second["completed_at"]


def test_ending_an_unknown_interview_is_a_404(client, fake_ai):
    assert client.post("/api/interviews/4242/end").status_code == 404


# ---------------- the usage summary ----------------


def test_usage_summary_counts_the_calls_made(client, fake_ai, db_session):
    from models.usage import UsageKind, UsageRecord

    interview_id = client.post("/api/interviews", json=VOICE_PAYLOAD).json()["interview_id"]

    # the stubbed AI reports no tokens, so stand in for what a real call would have recorded
    db_session.add(
        UsageRecord(
            interview_id=interview_id,
            kind=UsageKind.LLM,
            model="gpt-6-luna",
            purpose="generate_next_question",
            input_tokens=900,
            output_tokens=60,
        )
    )
    db_session.add(
        UsageRecord(
            interview_id=interview_id,
            kind=UsageKind.TRANSCRIPTION,
            model="gpt-transcribe",
            purpose="transcribe_answer",
            audio_seconds=31.5,
        )
    )
    db_session.commit()

    usage = client.get(f"/api/interviews/{interview_id}/usage").json()
    assert usage["llm_calls"] == 1
    assert usage["transcription_calls"] == 1
    assert usage["input_tokens"] == 900
    assert usage["output_tokens"] == 60
    assert usage["audio_seconds"] == 31.5
    # no rates configured in the test environment, so no cost is invented
    assert usage["estimated_cost_usd"] is None


def test_usage_summary_for_an_unknown_interview_is_a_404(client, fake_ai):
    assert client.get("/api/interviews/4242/usage").status_code == 404
