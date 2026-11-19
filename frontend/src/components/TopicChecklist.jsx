import { Link } from 'react-router-dom'

// one subject (DSA, OOP, DB...) rendered as a card of tickable topics.
// a ticked topic gets struck through so the user can see at a glance what is left.
//
// practiceTo is optional: pass a URL to show a "Practice" link in the header, which is how
// the Fundamentals tab hands a subject straight to the Practice tab. The My CV tab leaves
// it off, because its topics come from a CV rather than the fixed subject list.
export default function TopicChecklist({ category, topics, doneIds, onToggle, practiceTo = null }) {
  const doneCount = topics.filter((topic) => doneIds.has(topic.id)).length

  return (
    <section className="card wide topic-card">
      <header className="topic-card-head">
        <div>
          <h2>{category.name}</h2>
          <p className="muted">{category.blurb}</p>
        </div>
        <div className="topic-card-actions">
          <span className="status">
            {doneCount}/{topics.length}
          </span>
          {practiceTo && (
            <Link className="chip" to={practiceTo}>
              Practice →
            </Link>
          )}
        </div>
      </header>

      <ul className="topic-list">
        {topics.map((topic) => {
          const isDone = doneIds.has(topic.id)
          return (
            <li key={topic.id} className={isDone ? 'topic topic-done' : 'topic'}>
              <label>
                <input type="checkbox" checked={isDone} onChange={() => onToggle(topic.id)} />
                <span className="topic-label">{topic.label}</span>
              </label>
              <span className={`level level-${topic.level.toLowerCase()}`}>{topic.level}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
