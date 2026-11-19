// shows the AI's grading of an answer - score, feedback text, strengths and improvements
export default function FeedbackCard({ answer }) {
  return (
    <div className="card">
      <div className="score">
        <span className="score-value">{answer.score}</span>
        <span className="muted">/ 100</span>
      </div>
      <p>{answer.feedback}</p>

      {/* only show this section if there's at least one strength */}
      {answer.strengths?.length > 0 && (
        <div className="feedback-section">
          <h3>Strengths</h3>
          <ul>
            {answer.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* only show this section if there's at least one improvement */}
      {answer.improvements?.length > 0 && (
        <div className="feedback-section">
          <h3>Improvements</h3>
          <ul>
            {answer.improvements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
