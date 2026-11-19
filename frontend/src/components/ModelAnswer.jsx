import { useState } from 'react'

// the "most correct answer", kept hidden behind a button so seeing it is always a choice.
//
// the backend does the real hiding: a question that has not been answered yet comes back
// with model_answer stripped out, so there is nothing to find in the network tab either.
export default function ModelAnswer({ modelAnswer, isCode = false }) {
  const [revealed, setRevealed] = useState(false)

  if (!modelAnswer) return null

  if (!revealed) {
    return (
      <div className="card wide model-answer">
        <div className="model-answer-head">
          <div>
            <h3>Model answer</h3>
            <p className="muted">Hidden until you want it - have a go at comparing yours first.</p>
          </div>
          <button type="button" onClick={() => setRevealed(true)}>
            Show model answer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card wide model-answer">
      <div className="model-answer-head">
        <h3>Model answer</h3>
        <button type="button" className="chip" onClick={() => setRevealed(false)}>
          Hide
        </button>
      </div>
      {/* code keeps its indentation; prose is shown as written */}
      <pre className={isCode ? 'code-block' : 'answer-text'}>{modelAnswer}</pre>
    </div>
  )
}
