export default function InterviewLoader({ label = 'Working on it…', error }) {
  if (error) {
    return (
      <div className="card loader-card error">
        <p>Something went wrong.</p>
        <p className="muted">{error}</p>
      </div>
    )
  }

  return (
    <div className="card loader-card">
      <div className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  )
}
