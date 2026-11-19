import { useMemo, useState } from 'react'
import RoleSelector from '../components/RoleSelector'
import TopicChecklist from '../components/TopicChecklist'
import { DEFAULT_ROLE, LEVELS } from '../data/interviewOptions'
import { getCategoriesForRole, getLevelHints, isManagementRole } from '../data/fundamentals'
import useTopicProgress from '../hooks/useTopicProgress'

// the revision checklist. pick a position, pick which levels you are targeting, and tick off
// the subjects as you cover them - ticked topics get struck through and are remembered.
export default function Fundamentals() {
  const [role, setRole] = useState(DEFAULT_ROLE)
  const [activeLevels, setActiveLevels] = useState(() => new Set(LEVELS))
  const { doneIds, toggleTopic, clearTopics } = useTopicProgress()

  // show or hide a whole difficulty level (an intern can hide the senior-only topics)
  const toggleLevel = (level) => {
    setActiveLevels((current) => {
      const next = new Set(current)
      if (next.has(level)) {
        next.delete(level)
      } else {
        next.add(level)
      }
      return next
    })
  }

  // categories for this position, with each one's topics filtered down to the chosen levels.
  // empty categories are dropped so the page doesn't show headings with nothing under them.
  const visibleCategories = useMemo(() => {
    return getCategoriesForRole(role)
      .map((category) => ({
        category,
        topics: category.topics.filter((topic) => activeLevels.has(topic.level)),
      }))
      .filter((entry) => entry.topics.length > 0)
  }, [role, activeLevels])

  // a management position ladders differently to a hands-on one, so the level wording changes
  const levelHints = getLevelHints(role)
  const management = isManagementRole(role)

  const visibleTopics = visibleCategories.flatMap((entry) => entry.topics)
  const doneCount = visibleTopics.filter((topic) => doneIds.has(topic.id)).length
  const totalCount = visibleTopics.length
  const percent = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100)

  return (
    <div className="page">
      <h1>Fundamentals</h1>
      <p className="muted intro">
        {management
          ? `These subjects come up in every IT management interview - team lead, manager or director.
             Only the scope changes. Pick your position, hide the levels you are not targeting, and tick
             off what you have already covered.`
          : `These subjects come up in every software interview - internship, senior engineer or tech lead.
             Only the depth changes. Pick your position, hide the levels you are not targeting, and tick
             off what you have already covered.`}
      </p>

      <div className="card wide">
        <RoleSelector value={role} onChange={setRole} />

        <div className="field">
          <span>Levels to show</span>
          <div className="chip-row">
            {LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className={activeLevels.has(level) ? 'chip chip-on' : 'chip'}
                aria-pressed={activeLevels.has(level)}
                onClick={() => toggleLevel(level)}
              >
                {level}
              </button>
            ))}
          </div>
          <p className="muted">
            {LEVELS.map((level) => `${level}: ${levelHints[level]}`).join(' · ')}
          </p>
        </div>

        <div className="progress-row">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="progress-count">
            {doneCount}/{totalCount} done
          </span>
        </div>

        {doneCount > 0 && (
          <button type="button" onClick={() => clearTopics(visibleTopics.map((topic) => topic.id))}>
            Clear ticks shown here
          </button>
        )}
      </div>

      {totalCount === 0 && <p className="muted">Pick at least one level to see topics.</p>}

      {visibleCategories.map((entry) => (
        <TopicChecklist
          key={entry.category.id}
          category={entry.category}
          topics={entry.topics}
          doneIds={doneIds}
          onToggle={toggleTopic}
          // hands this subject straight to the Practice tab, already selected
          practiceTo={`/practice?role=${encodeURIComponent(role)}&category=${entry.category.id}`}
        />
      ))}
    </div>
  )
}
