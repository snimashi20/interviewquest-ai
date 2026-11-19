// shows the interview question and its topic badge
export default function QuestionCard({ question }) {
  return (
    <div className="card">
      {question.topic && <span className="badge">{question.topic}</span>}
      <h2>{question.question_text}</h2>
    </div>
  )
}
