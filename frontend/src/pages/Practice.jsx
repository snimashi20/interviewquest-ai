import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import DifficultySelector from '../components/DifficultySelector'
import RoleSelector from '../components/RoleSelector'
import { DEFAULT_ROLE, QUESTION_COUNTS } from '../data/interviewOptions'
import { getCategoriesForRole } from '../data/fundamentals'
import { createPracticeSet } from '../services/api'

// the three shapes a practice set can take
const STYLES = [
  { id: 'THEORY', label: 'Written answers', hint: 'Explain it in your own words.' },
  { id: 'CODING', label: 'Coding tasks', hint: 'Solve it in the code workspace and run it.' },
  { id: 'MIXED', label: 'A bit of both', hint: 'Alternates written questions and coding tasks.' },
]

// "Practice" is the drill: pick one subject (DSA, Databases, System Design...), get questions
// on just that, answer them, then compare against the model answer and your marks.
export default function Practice() {
  const navigate = useNavigate()
  // Fundamentals links in here with the subject already chosen, e.g. /practice?category=dsa
  const [searchParams] = useSearchParams()

  const [role, setRole] = useState(searchParams.get('role') || DEFAULT_ROLE)
  const [categoryId, setCategoryId] = useState(searchParams.get('category') || '')
  const [focus, setFocus] = useState('')
  const [difficulty, setDifficulty] = useState('Intermediate')
  const [questionCount, setQuestionCount] = useState(3)
  const [questionStyle, setQuestionStyle] = useState('MIXED')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // the subjects available for this position - the same list the Fundamentals tab shows
  const categories = useMemo(() => getCategoriesForRole(role), [role])

  // changing position can drop the chosen subject, so fall back to the first one rather
  // than leaving the form pointing at something that no longer exists
  const category = categories.find((item) => item.id === categoryId) || categories[0]
  // likewise the narrower focus only applies while its subject is selected
  const focusIsValid = category?.topics.some((topic) => topic.label === focus)
  const activeFocus = focusIsValid ? focus : ''

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!category) return
    setSubmitting(true)
    setError(null)
    try {
      const { interview_id: interviewId, job_id: jobId } = await createPracticeSet({
        role,
        difficulty,
        topic: category.name,
        focus: activeFocus || null,
        questionStyle,
        questionCount,
      })
      navigate(`/practice/${interviewId}`, { state: { jobId } })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <h1>Practice a Topic</h1>
      <p className="muted intro">
        Drill one subject at a time. You answer, we mark it out of 100, and the model answer is
        there to compare against once you have had your go. Coding tasks open in a workspace you
        can actually run your code in.
      </p>

      <form className="card wide" onSubmit={handleSubmit}>
        <RoleSelector value={role} onChange={setRole} />

        <label className="field">
          <span>Subject</span>
          <select value={category?.id || ''} onChange={(event) => setCategoryId(event.target.value)}>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {category && <p className="muted">{category.blurb}</p>}

        {/* optional: narrow it down to one thing inside the subject */}
        <label className="field">
          <span>Focus (optional)</span>
          <select value={activeFocus} onChange={(event) => setFocus(event.target.value)}>
            <option value="">Anything in this subject</option>
            {category?.topics.map((topic) => (
              <option key={topic.id} value={topic.label}>
                {topic.label} · {topic.level}
              </option>
            ))}
          </select>
        </label>

        <DifficultySelector value={difficulty} onChange={setDifficulty} />

        <div className="field">
          <span>Question type</span>
          <div className="chip-row">
            {STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                className={questionStyle === style.id ? 'chip chip-on' : 'chip'}
                aria-pressed={questionStyle === style.id}
                onClick={() => setQuestionStyle(style.id)}
              >
                {style.label}
              </button>
            ))}
          </div>
          <p className="muted">{STYLES.find((style) => style.id === questionStyle)?.hint}</p>
        </div>

        <div className="field">
          <span>How many questions</span>
          <div className="chip-row">
            {QUESTION_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                className={questionCount === count ? 'chip chip-on' : 'chip'}
                aria-pressed={questionCount === count}
                onClick={() => setQuestionCount(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" disabled={submitting || !category}>
          {submitting ? 'Writing questions…' : 'Start Practice'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  )
}
