import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RoleSelector from '../components/RoleSelector'
import DifficultySelector from '../components/DifficultySelector'
import { createInterview } from '../services/api'

export default function Home() {
  const [role, setRole] = useState('Software Engineering')
  const [difficulty, setDifficulty] = useState('Intermediate')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { interview_id: interviewId, job_id: jobId } = await createInterview(role, difficulty)
      navigate(`/interview/${interviewId}`, { state: { jobId } })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <h1>Start a Mock Interview</h1>
      <p className="muted">Pick a role and difficulty, and we'll generate a question for you.</p>
      <form className="card" onSubmit={handleSubmit}>
        <RoleSelector value={role} onChange={setRole} />
        <DifficultySelector value={difficulty} onChange={setDifficulty} />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Starting…' : 'Start Interview'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  )
}
