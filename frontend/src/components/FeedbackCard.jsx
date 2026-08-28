export default function FeedbackCard({ answer }) {
  return (
    <div className="card">
      <div className="score">
        <span className="score-value">{answer.score}</span>
        <span className="muted">/ 100</span>
      </div>
      <p>{answer.feedback}</p>

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
