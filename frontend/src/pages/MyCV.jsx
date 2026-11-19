import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CVUpload from '../components/CVUpload'
import InterviewLoader from '../components/InterviewLoader'
import TopicChecklist from '../components/TopicChecklist'
import { getCV, listCVs, setTopicCompleted, uploadCV } from '../services/api'

// remember which CV the student was last looking at, so coming back to this tab
// doesn't make them pick it again
const SELECTED_KEY = 'interviewquest.cv.selected.v1'

// how often to re-check a CV that is still being read by the AI
const POLL_INTERVAL_MS = 2000

// statuses that mean the AI hasn't finished reading the CV yet
const BUSY_STATUSES = ['PENDING', 'IN_PROGRESS']

function readSavedId() {
  try {
    const raw = window.localStorage.getItem(SELECTED_KEY)
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

function saveSelectedId(cvId) {
  try {
    window.localStorage.setItem(SELECTED_KEY, String(cvId))
  } catch {
    // storage can be unavailable - the page still works, it just won't remember the choice
  }
}

// the "My CV" tab, sitting next to Fundamentals. upload a CV, the backend reads it and
// pulls out the topics that are actually on it (React, Docker, AWS...), and they come back
// as a tickable checklist grouped by category. ticks are saved on the server, per CV.
export default function MyCV() {
  const [cvs, setCvs] = useState(null) // null = still loading the list
  const [selectedId, setSelectedId] = useState(null)
  const [cv, setCv] = useState(null) // the selected CV with its checklist
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  // load the list of uploaded CVs once, and pick one to show
  useEffect(() => {
    listCVs()
      .then((list) => {
        setCvs(list)
        const saved = readSavedId()
        // use the remembered CV if it still exists, otherwise the newest one
        const pick = list.find((item) => item.id === saved) || list[0]
        setSelectedId(pick ? pick.id : null)
      })
      .catch((err) => setError(err.message))
  }, [])

  // fetch whichever CV is selected
  const refetchCV = useCallback(async () => {
    if (!selectedId) return
    try {
      const data = await getCV(selectedId)
      setCv(data)
    } catch (err) {
      setError(err.message)
    }
  }, [selectedId])

  // whenever the selection changes, remember it and load that CV
  useEffect(() => {
    if (selectedId) {
      saveSelectedId(selectedId)
      refetchCV()
    }
  }, [selectedId, refetchCV])

  // only trust the loaded CV while it is the one actually selected. between picking a
  // different CV and its fetch coming back, `cv` still holds the previous one, and showing
  // that would mean briefly rendering the wrong checklist
  const activeCv = cv && cv.id === selectedId ? cv : null

  // while the AI is still reading this CV, keep re-checking it. polling the CV itself
  // (rather than the upload job) means a page refresh mid-extraction still recovers
  useEffect(() => {
    if (!activeCv || !BUSY_STATUSES.includes(activeCv.status)) return undefined

    const timeoutId = setTimeout(refetchCV, POLL_INTERVAL_MS)
    return () => clearTimeout(timeoutId)
  }, [activeCv, refetchCV])

  // send the chosen file to the backend, then switch to the CV it created
  const handleFile = async (file) => {
    setUploading(true)
    setError(null)
    try {
      const { cv_id: cvId } = await uploadCV(file)
      const list = await listCVs()
      setCvs(list)
      setSelectedId(cvId) // the effect above fetches it and starts polling
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  // tick or untick a topic. the server is the source of truth here (unlike the
  // Fundamentals tab, which keeps ticks in the browser), but we update the screen
  // immediately and roll back if the request fails
  const handleToggle = async (topicId) => {
    const current = activeCv
    if (!current) return

    let nextCompleted = false
    const updated = {
      ...current,
      categories: current.categories.map((category) => ({
        ...category,
        topics: category.topics.map((topic) => {
          if (topic.id !== topicId) return topic
          nextCompleted = !topic.completed
          return { ...topic, completed: nextCompleted }
        }),
      })),
    }
    updated.completed_count = updated.categories.reduce(
      (total, category) => total + category.topics.filter((topic) => topic.completed).length,
      0,
    )
    setCv(updated)

    try {
      await setTopicCompleted(topicId, nextCompleted)
    } catch (err) {
      setError(err.message)
      setCv(current) // put it back the way it was
    }
  }

  // TopicChecklist (shared with the Fundamentals tab) wants a Set of ticked ids
  const doneIds = useMemo(() => {
    if (!activeCv) return new Set()
    return new Set(
      activeCv.categories.flatMap((category) =>
        category.topics.filter((topic) => topic.completed).map((topic) => topic.id),
      ),
    )
  }, [activeCv])

  const total = activeCv?.topic_count ?? 0
  const done = activeCv?.completed_count ?? 0
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <div className="page">
      <h1>My CV</h1>
      <p className="muted intro">
        Upload your CV and it gets read for the technologies you actually claim - React, Docker, AWS,
        whatever is on there. Those become your own revision checklist, grouped by area, on top of the
        Fundamentals every candidate gets asked. Tick a topic off once you have revised it.
      </p>

      <div className="card wide">
        <CVUpload
          onFile={handleFile}
          busy={uploading}
          label={cvs?.length ? 'Upload a newer CV' : 'Upload your CV'}
        />

        {/* only worth showing the picker once there is more than one CV to choose from */}
        {cvs && cvs.length > 1 && (
          <label className="field">
            <span>Which CV</span>
            <select value={selectedId ?? ''} onChange={(event) => setSelectedId(Number(event.target.value))}>
              {cvs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename} · {new Date(item.created_at).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>

      {/* nothing uploaded yet */}
      {cvs && cvs.length === 0 && !uploading && (
        <p className="muted">No CV uploaded yet. Pick a file above to build your checklist.</p>
      )}

      {/* the AI is still reading it */}
      {activeCv && BUSY_STATUSES.includes(activeCv.status) && (
        <InterviewLoader label={`Reading ${activeCv.filename} and picking out your topics…`} />
      )}

      {/* it failed - show why, and let them try another file */}
      {activeCv && activeCv.status === 'FAILED' && (
        <InterviewLoader error={activeCv.error || 'Could not read that CV.'} />
      )}

      {/* ready: progress, a shortcut into an interview, then the checklist itself */}
      {activeCv && activeCv.status === 'COMPLETED' && (
        <>
          <div className="card wide">
            <div className="topic-card-head">
              <div>
                <h2>{activeCv.filename}</h2>
                <p className="muted">
                  {total} topics found across {activeCv.categories.length} areas of your CV
                </p>
              </div>
              <span className="badge">{percent}%</span>
            </div>

            <div className="progress-row">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <span className="progress-count">
                {done}/{total} done
              </span>
            </div>

            <button type="button" onClick={() => navigate('/', { state: { cvId: activeCv.id } })}>
              Interview me on this CV
            </button>
          </div>

          {activeCv.categories.map((category) => (
            <TopicChecklist
              key={category.id}
              category={category}
              topics={category.topics}
              doneIds={doneIds}
              onToggle={handleToggle}
            />
          ))}
        </>
      )}
    </div>
  )
}
