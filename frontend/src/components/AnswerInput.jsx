import { useState } from 'react'

export default function AnswerInput({ onSubmit, submitting }) {
  const [answerText, setAnswerText] = useState('')

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!answerText.trim()) return
    onSubmit(answerText.trim())
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <label className="field">
        <span>Your Answer</span>
        <textarea
          rows={8}
          value={answerText}
          onChange={(event) => setAnswerText(event.target.value)}
          placeholder="Type your answer here..."
          disabled={submitting}
        />
      </label>
      <button type="submit" disabled={submitting || !answerText.trim()}>
        {submitting ? 'Submitting…' : 'Submit Answer'}
      </button>
    </form>
  )
}
