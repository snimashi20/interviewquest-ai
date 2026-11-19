import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import InterviewLoader from '../components/InterviewLoader'
import { listInterviews } from '../services/api'

// shows every past interview, with a link into each one
export default function History() {
  const [interviews, setInterviews] = useState(null)
  const [error, setError] = useState(null)

  // load the list once when the page first opens
  useEffect(() => {
    listInterviews()
      .then(setInterviews)
      .catch((err) => setError(err.message))
  }, [])

  if (error) {
    return (
      <div className="page">
        <InterviewLoader error={error} />
      </div>
    )
  }

  if (!interviews) {
    return (
      <div className="page">
        <InterviewLoader label="Loading history…" />
      </div>
    )
  }

  return (
    <div className="page">
      <h1>Interview History</h1>
      {interviews.length === 0 && <p className="muted">No interviews yet. Start one from the Home page.</p>}
      <ul className="history-list">
        {interviews.map((interview) => (
          <li key={interview.id} className="card history-item">
            <div>
              <strong>{interview.role}</strong>
              <span className="muted"> · {interview.difficulty}</span>
              <p className="muted">
                {interview.question_count} questions
                {/* a CV-based interview is worth calling out, it's the more useful kind */}
                {interview.cv_id && ' · from your CV'}
                {interview.overall_score != null && ` · ${interview.overall_score}/100`}
              </p>
            </div>
            <span className={`status status-${interview.status.toLowerCase()}`}>{interview.status}</span>
            {/* finished interviews go to Results, unfinished ones go back to the Interview page */}
            <Link to={interview.status === 'COMPLETED' ? `/results/${interview.id}` : `/interview/${interview.id}`}>
              View
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
