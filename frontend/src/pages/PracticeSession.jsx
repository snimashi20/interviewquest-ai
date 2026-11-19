import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import AnswerInput from '../components/AnswerInput'
import FeedbackCard from '../components/FeedbackCard'
import InterviewLoader from '../components/InterviewLoader'
import ModelAnswer from '../components/ModelAnswer'
import { useJobPolling } from '../hooks/useJobPolling'
import { getInterview, submitAnswer } from '../services/api'

// works through a practice set one question at a time. the difference from a mock interview
// is what happens after you answer: instead of moving straight on, you stay on the question
// with your marks and the model answer available to compare against.
export default function PracticeSession() {
  const { interviewId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const [practice, setPractice] = useState(null)
  // which question is on screen. null means "wherever the set should open" (see openingIndex
  // below); it gets pinned to a number as soon as the student moves or answers, so a reload
  // of the data can't slide them off the question they are looking at
  const [chosenIndex, setChosenIndex] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [answerJobId, setAnswerJobId] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // the job that writes the questions (we came straight from the setup form)
  const questionsJobId = location.state?.jobId ?? null
  // set when we come back from the code workspace, so we land on the question just answered
  const focusQuestionId = location.state?.focusQuestionId ?? null

  const { job: questionsJob, error: questionsJobError } = useJobPolling(questionsJobId)
  const { job: evaluationJob, error: evaluationJobError } = useJobPolling(answerJobId)

  const refetch = useCallback(async () => {
    try {
      const data = await getInterview(interviewId)
      setPractice(data)
      return data
    } catch (err) {
      setLoadError(err.message)
      return null
    }
  }, [interviewId])

  // load once the questions exist (or straight away if the page was refreshed)
  useEffect(() => {
    if (!questionsJobId || questionsJob?.status === 'COMPLETED') {
      refetch()
    }
  }, [questionsJobId, questionsJob?.status, refetch])

  // once marking finishes, reload so the score and model answer appear under the question
  useEffect(() => {
    if (evaluationJob?.status !== 'COMPLETED') return
    let cancelled = false
    refetch().then(() => {
      if (cancelled) return
      setAnswerJobId(null)
      setSubmitting(false)
    })
    return () => {
      cancelled = true
    }
  }, [evaluationJob?.status, refetch])

  const handleSubmit = async (answerText, question, questionIndex) => {
    setSubmitting(true)
    // stay on this question once it is marked, instead of being moved on to the next
    // unanswered one - the marks and the model answer are the point of practice mode
    setChosenIndex(questionIndex)
    try {
      const job = await submitAnswer(interviewId, question.id, answerText)
      setAnswerJobId(job.id)
    } catch (err) {
      setLoadError(err.message)
      setSubmitting(false)
    }
  }

  // --- what to show, checked in order ---

  if (questionsJobId && (!questionsJob || ['PENDING', 'IN_PROGRESS'].includes(questionsJob.status))) {
    return (
      <div className="page">
        <InterviewLoader label="Writing your practice questions…" error={questionsJobError} />
      </div>
    )
  }

  if (questionsJob?.status === 'FAILED') {
    return (
      <div className="page">
        <InterviewLoader error={questionsJob.error || 'Question generation failed.'} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page">
        <InterviewLoader error={loadError} />
      </div>
    )
  }

  if (!practice) {
    return (
      <div className="page">
        <InterviewLoader label="Loading practice set…" />
      </div>
    )
  }

  const questions = practice.questions
  if (questions.length === 0) {
    return (
      <div className="page">
        <InterviewLoader label="Waiting for your questions…" />
      </div>
    )
  }

  // where the set opens before the student has moved anywhere themselves: the question they
  // just answered in the code workspace, else the first one still unanswered, else the start
  const focused = questions.findIndex((question) => question.id === focusQuestionId)
  const firstUnanswered = questions.findIndex((question) => !question.answer)
  const openingIndex = focused >= 0 ? focused : firstUnanswered >= 0 ? firstUnanswered : 0

  const index = Math.min(chosenIndex ?? openingIndex, questions.length - 1)
  const current = questions[index]
  const answered = questions.filter((question) => question.answer).length
  const graded = questions.filter((question) => question.answer?.score != null)
  const percent = Math.round((answered / questions.length) * 100)
  const isCoding = current.kind === 'CODING'

  return (
    <div className="page">
      <div className="card wide question-progress">
        <div className="progress-row">
          <span className="progress-count">
            Question {current.question_number} of {questions.length}
          </span>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <p className="muted">
          Practice · {practice.practice_topic}
          {practice.practice_focus && ` · ${practice.practice_focus}`} · {practice.difficulty}
        </p>
      </div>

      {/* the question itself */}
      <section className="card wide">
        <div className="badge-row">
          {current.topic && <span className="badge">{current.topic}</span>}
          {isCoding && <span className="badge badge-code">Coding task · {current.language}</span>}
        </div>
        <p className="question-text">{current.question_text}</p>
      </section>

      {/* unanswered: either type an answer, or go and write some code */}
      {!current.answer && !answerJobId && (
        isCoding ? (
          <div className="card wide">
            <p className="muted">
              This one is a coding task. The workspace gives you an editor, a Run button and an
              output pane - run it until you are happy, then submit it from there.
            </p>
            <button
              type="button"
              onClick={() => navigate(`/practice/${interviewId}/code/${current.id}`)}
            >
              Open coding workspace →
            </button>
          </div>
        ) : (
          <AnswerInput
            key={current.id}
            onSubmit={(answerText) => handleSubmit(answerText, current, index)}
            submitting={submitting}
            submitLabel="Submit for marking"
          />
        )
      )}

      {/* submitted, waiting on the marker */}
      {answerJobId && (
        <InterviewLoader
          label="Marking your answer…"
          error={evaluationJobError || (evaluationJob?.status === 'FAILED' ? evaluationJob.error : null)}
        />
      )}

      {/* answered: your attempt, your marks, and the model answer behind a button */}
      {current.answer && !answerJobId && (
        <>
          <section className="card wide">
            <h3>Your answer</h3>
            <pre className={isCoding ? 'code-block' : 'answer-text'}>{current.answer.answer_text}</pre>
          </section>

          {current.answer.score != null ? (
            <FeedbackCard answer={current.answer} />
          ) : (
            <p className="muted">Still being marked…</p>
          )}

          <ModelAnswer modelAnswer={current.model_answer} isCode={isCoding} />
        </>
      )}

      {/* step through the set */}
      <nav className="card wide practice-nav">
        <button type="button" className="chip" disabled={index === 0} onClick={() => setChosenIndex(index - 1)}>
          ← Previous
        </button>
        <span className="muted">
          {graded.length} of {questions.length} marked
          {practice.overall_score != null && ` · ${practice.overall_score}/100 average`}
        </span>
        <button
          type="button"
          className="chip"
          disabled={index >= questions.length - 1}
          onClick={() => setChosenIndex(index + 1)}
        >
          Next →
        </button>
      </nav>

      {answered === questions.length && (
        <div className="card wide">
          <div className="score">
            <span className="score-value">{practice.overall_score ?? '—'}</span>
            <span className="muted">/ 100 across this set</span>
          </div>
          <p className="muted">Every question answered. Pick another subject whenever you are ready.</p>
          <Link className="button-link" to="/practice">
            Practice another topic
          </Link>
        </div>
      )}
    </div>
  )
}
