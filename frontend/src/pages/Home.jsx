import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import RoleSelector from '../components/RoleSelector'
import DifficultySelector from '../components/DifficultySelector'
import {
  DEFAULT_INTERVIEW_QUESTION_COUNT,
  DEFAULT_ROLE,
  INTERVIEW_QUESTION_COUNTS,
  INTERVIEW_TYPES,
} from '../data/interviewOptions'
import { createInterview, listCVs } from '../services/api'

// the very first page - pick a role, a difficulty, how many questions, and optionally
// a CV to be interviewed on, then start.
export default function Home() {
  const [role, setRole] = useState(DEFAULT_ROLE)
  const [difficulty, setDifficulty] = useState('Intermediate')
  const [questionCount, setQuestionCount] = useState(DEFAULT_INTERVIEW_QUESTION_COUNT)
  // 'TEXT' (type your answers) or 'VOICE' (spoken, read aloud and transcribed)
  const [interviewType, setInterviewType] = useState('TEXT')
  const [cvs, setCvs] = useState([])
  // '' means "no CV, just ask me about the role in general"
  const [cvId, setCvId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const location = useLocation()
  const navigate = useNavigate() // lets us send the user to a different page in code

  // the My CV tab can send us here with a CV already chosen ("Interview me on this CV")
  const presetCvId = location.state?.cvId ?? null

  // load the CVs that have finished processing, so they can be picked in the dropdown
  useEffect(() => {
    listCVs()
      .then((list) => {
        const ready = list.filter((item) => item.status === 'COMPLETED')
        setCvs(ready)
        // preselect whichever CV we were sent here with, as long as it is ready
        if (presetCvId && ready.some((item) => item.id === presetCvId)) {
          setCvId(String(presetCvId))
        }
      })
      .catch(() => setCvs([])) // a failed CV list shouldn't block starting a normal interview
  }, [presetCvId])

  const handleSubmit = async (event) => {
    event.preventDefault() // stop the browser from reloading the page
    setSubmitting(true)
    setError(null)
    try {
      // ask the backend to create the interview, it gives us back an interview id and a job id
      const { interview_id: interviewId, job_id: jobId } = await createInterview({
        role,
        difficulty,
        cvId: cvId === '' ? null : Number(cvId),
        questionCount,
        interviewType,
      })
      // go to the interview page, passing the jobId along so it knows what to poll
      navigate(`/interview/${interviewId}`, { state: { jobId } })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <h1>Start a Mock Interview</h1>
      <p className="muted">Pick a role and difficulty, and we&apos;ll generate your questions.</p>
      <form className="card" onSubmit={handleSubmit}>
        <RoleSelector value={role} onChange={setRole} />
        <DifficultySelector value={difficulty} onChange={setDifficulty} />

        {/* text or voice. a voice interview reads the questions aloud, takes spoken answers,
            and follows up on what the candidate actually said */}
        <fieldset className="field mode-choice">
          <legend>How would you like to answer?</legend>
          {INTERVIEW_TYPES.map((option) => (
            <label key={option.id} className={`mode-option${interviewType === option.id ? ' mode-option-on' : ''}`}>
              <input
                type="radio"
                name="interview-type"
                value={option.id}
                checked={interviewType === option.id}
                onChange={() => setInterviewType(option.id)}
              />
              <span>
                <strong>{option.label}</strong>
                <span className="muted mode-option-blurb">{option.blurb}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="field">
          <span>Number of questions</span>
          <select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}>
            {INTERVIEW_QUESTION_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count} questions
              </option>
            ))}
          </select>
        </label>

        {/* optional: base the questions on a CV the student has already uploaded */}
        {cvs.length > 0 ? (
          <label className="field">
            <span>Base questions on a CV (optional)</span>
            <select value={cvId} onChange={(event) => setCvId(event.target.value)}>
              <option value="">No CV - general questions for the role</option>
              {cvs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>
            <p className="muted">
              With a CV picked, the questions come from your own projects and skills.
            </p>
          </label>
        ) : (
          <p className="muted">
            Want questions about your own projects? <Link to="/my-cv">Upload your CV</Link> first.
          </p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Starting…' : 'Start Interview'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  )
}
