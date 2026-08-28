import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import InterviewLoader from '../components/InterviewLoader'
import { listInterviews } from '../services/api'

export default function History() {
  const [interviews, setInterviews] = useState(null)
  const [error, setError] = useState(null)

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
            </div>
            <span className={`status status-${interview.status.toLowerCase()}`}>{interview.status}</span>
            <Link to={interview.status === 'COMPLETED' ? `/results/${interview.id}` : `/interview/${interview.id}`}>
              View
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
