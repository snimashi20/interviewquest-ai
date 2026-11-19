import { useState } from 'react'

// a textarea + submit button for typing an answer to the question.
// isLast changes the button wording so the student knows this one ends the interview.
// submitLabel overrides that wording entirely - practice mode uses it, because there the
// next thing you see is your marks, not the next question.
export default function AnswerInput({ onSubmit, submitting, isLast = false, submitLabel = null }) {
  const [answerText, setAnswerText] = useState('') // keeps track of what the student has typed so far

  const handleSubmit = (event) => {
    event.preventDefault() // stop the browser from reloading the page on submit
    if (!answerText.trim()) return // don't submit an empty answer
    onSubmit(answerText.trim())
  }

  // what the button says, depending on where we are and whether it's mid-submit
  const buttonLabel = submitting
    ? 'Submitting…'
    : submitLabel || (isLast ? 'Submit & Finish' : 'Submit & Next Question')

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
        {buttonLabel}
      </button>
    </form>
  )
}
