import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import FeedbackCard from '../components/FeedbackCard'
import InterviewLoader from '../components/InterviewLoader'
import QuestionCard from '../components/QuestionCard'
import { getInterview } from '../services/api'

export default function Results() {
  const { interviewId } = useParams()
  const [interview, setInterview] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getInterview(interviewId)
      .then(setInterview)
      .catch((err) => setError(err.message))
  }, [interviewId])

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

  const question = interview.questions[0]

  return (
    <div className="page">
      <h1>Interview Results</h1>
      <p className="muted">
        {interview.role} · {interview.difficulty}
      </p>
      {question && <QuestionCard question={question} />}
      {question?.answer ? (
        <FeedbackCard answer={question.answer} />
      ) : (
        <p className="muted">No answer submitted yet.</p>
      )}
      <Link className="button-link" to="/history">
        Back to History
      </Link>
    </div>
  )
}
