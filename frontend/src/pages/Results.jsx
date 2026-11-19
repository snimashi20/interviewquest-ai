import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import FeedbackCard from '../components/FeedbackCard'
import InterviewLoader from '../components/InterviewLoader'
import QuestionCard from '../components/QuestionCard'
import { getInterview, getInterviewUsage } from '../services/api'

// "12m 34s" / "48s"
function formatDuration(seconds) {
  if (seconds == null) return null
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

// the strengths and improvements across every graded answer, deduplicated. the per-question
// feedback is still below - this is just the shape of the interview as a whole
function collectFeedback(questions, key) {
  const seen = []
  for (const question of questions) {
    for (const item of question.answer?.[key] ?? []) {
      if (item && !seen.includes(item)) seen.push(item)
    }
  }
  return seen
}

// shows the overall score for an interview, then every question with the candidate's own
// answer and its grading
export default function Results() {
  const { interviewId } = useParams()
  const [interview, setInterview] = useState(null)
  const [error, setError] = useState(null)
  // the usage estimate is only fetched if the student asks for it
  const [usage, setUsage] = useState(null)
  const [usageError, setUsageError] = useState(null)

  // load the interview once when the page first opens
  useEffect(() => {
    getInterview(interviewId)
      .then(setInterview)
      .catch((err) => setError(err.message))
  }, [interviewId])

  const showUsage = () => {
    setUsageError(null)
    getInterviewUsage(interviewId)
      .then(setUsage)
      .catch((err) => setUsageError(err.message))
  }

  if (error) {
    return (
      <div className="page">
        <InterviewLoader error={error} />
      </div>
    )
  }

  if (!interview) {
    return (
      <div className="page">
        <InterviewLoader label="Loading results…" />
      </div>
    )
  }

  const graded = interview.questions.filter((question) => question.answer?.score != null)
  const answeredCount = interview.questions.filter((question) => question.answer).length
  const spokenCount = interview.questions.filter((question) => question.answer?.source === 'SPOKEN').length
  const duration = formatDuration(interview.duration_seconds)
  const strengths = collectFeedback(interview.questions, 'strengths')
  const improvements = collectFeedback(interview.questions, 'improvements')

  return (
    <div className="page">
      <h1>Interview Results</h1>
      <p className="muted">
        {interview.role} · {interview.difficulty}
        {interview.interview_type === 'VOICE' && ' · voice interview'}
        {interview.cv_filename && ` · based on ${interview.cv_filename}`}
        {duration && ` · took ${duration}`}
      </p>

      {/* the headline number: the average across every question that got graded */}
      <div className="card">
        <div className="score">
          <span className="score-value">{interview.overall_score ?? '—'}</span>
          <span className="muted">/ 100 overall</span>
        </div>
        <p className="muted">
          {/* saying how the number was worked out, rather than presenting it as a verdict
              from nowhere */}
          {graded.length > 0
            ? `The average of the ${graded.length} answer${graded.length === 1 ? '' : 's'} that were graded, out of ${
                interview.question_count
              } question${interview.question_count === 1 ? '' : 's'} asked.`
            : 'Nothing has been graded yet, so there is no score.'}
        </p>
        {interview.ended_early && (
          <p className="muted">
            You ended this interview early. Only the answers you gave count towards the score -
            nothing was assumed for the questions you did not reach.
          </p>
        )}
        {spokenCount > 0 && (
          <p className="muted">
            {spokenCount} of {answeredCount} answers were spoken and transcribed.
          </p>
        )}
      </div>

      {/* the interview as a whole, before the question-by-question detail */}
      {(strengths.length > 0 || improvements.length > 0) && (
        <div className="card">
          {strengths.length > 0 && (
            <div className="feedback-section">
              <h3>What went well</h3>
              <ul>
                {strengths.slice(0, 6).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {improvements.length > 0 && (
            <div className="feedback-section">
              <h3>What to work on</h3>
              <ul>
                {improvements.slice(0, 6).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted">
            Each question below has its own feedback, including what a stronger answer would have
            covered.
          </p>
        </div>
      )}

      {interview.questions.length === 0 && <p className="muted">This interview has no questions.</p>}

      {/* then the per-question breakdown, in the order they were asked */}
      {interview.questions.map((question) => (
        <div key={question.id} className="question-block">
          <p className="muted question-number">
            Question {question.question_number}
            {question.is_followup && ' · follow-up'}
          </p>
          <QuestionCard question={question} />

          {question.answer ? (
            <>
              {/* what the candidate actually said or typed, so they can see it alongside
                  the marking */}
              <div className="card">
                <div className="badge-row">
                  <span className="badge">
                    {question.answer.source === 'SPOKEN' ? 'Your spoken answer' : 'Your typed answer'}
                  </span>
                  {question.answer.source === 'SPOKEN' && question.answer.audio_seconds != null && (
                    <span className="badge badge-quiet">{Math.round(question.answer.audio_seconds)}s of audio</span>
                  )}
                  {question.answer.transcript_edited && <span className="badge badge-quiet">transcript edited</span>}
                </div>
                <p className="answer-text">{question.answer.answer_text}</p>
              </div>

              {question.answer.score != null ? (
                <FeedbackCard answer={question.answer} />
              ) : (
                <p className="muted">This answer was saved but never graded.</p>
              )}
            </>
          ) : (
            <p className="muted">Not answered.</p>
          )}
        </div>
      ))}

      {/* optional, and clearly an estimate rather than a bill */}
      <div className="card">
        {!usage ? (
          <>
            <button type="button" className="chip" onClick={showUsage}>
              Show estimated API usage
            </button>
            {usageError && <p className="error-text">{usageError}</p>}
          </>
        ) : (
          <>
            <h3>Estimated API usage</h3>
            <p className="muted">
              {usage.llm_calls} text call{usage.llm_calls === 1 ? '' : 's'} to {usage.text_model}
              {usage.input_tokens > 0 &&
                ` (${usage.input_tokens.toLocaleString()} in / ${usage.output_tokens.toLocaleString()} out tokens)`}
              {usage.transcription_calls > 0 &&
                `, ${usage.transcription_calls} transcription${
                  usage.transcription_calls === 1 ? '' : 's'
                } of ${usage.audio_seconds}s of audio with ${usage.transcription_model}`}
              .
            </p>
            <p className="muted">
              {usage.estimated_cost_usd != null
                ? `Roughly $${usage.estimated_cost_usd.toFixed(4)} at the rates configured on the server. This is an estimate for your own awareness, not a bill.`
                : 'No pricing is configured on the server, so no cost estimate is shown - only the call and token counts above.'}
            </p>
          </>
        )}
      </div>

      <Link className="button-link" to="/history">
        Back to History
      </Link>
    </div>
  )
}
