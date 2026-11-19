import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import CodeEditor from '../components/CodeEditor'
import InterviewLoader from '../components/InterviewLoader'
import { useJobPolling } from '../hooks/useJobPolling'
import useCodeRunner, { DEFAULT_LANGUAGE, RUNTIMES } from '../hooks/useCodeRunner'
import { getInterview, submitAnswer } from '../services/api'

// work in progress is kept per question, so leaving the workspace and coming back
// (or refreshing) doesn't throw away what you typed
const draftKey = (questionId) => `interviewquest.code.draft.${questionId}`

function readDraft(questionId) {
  try {
    return window.localStorage.getItem(draftKey(questionId))
  } catch {
    return null
  }
}

// how far across the screen the split sits, clamped so neither pane can vanish
const MIN_SPLIT = 25
const MAX_SPLIT = 80

// the coding environment: editor on the left, output on the right, run it as often as you
// like, then submit when you are happy. the code runs in the browser - it is never uploaded
// anywhere until you press submit.
export default function CodeWorkspace() {
  const { interviewId, questionId } = useParams()
  const navigate = useNavigate()

  const [question, setQuestion] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE)
  const [split, setSplit] = useState(58) // editor width, in %
  const [submitting, setSubmitting] = useState(false)
  const [answerJobId, setAnswerJobId] = useState(null)

  const { output, running, run, stop, clearOutput } = useCodeRunner()
  const { job: evaluationJob, error: evaluationJobError } = useJobPolling(answerJobId)
  const splitRef = useRef(null)

  // load the task, and open the editor on the draft if there is one, the starter stub if not
  useEffect(() => {
    let cancelled = false
    getInterview(interviewId)
      .then((data) => {
        if (cancelled) return
        const found = data.questions.find((item) => String(item.id) === String(questionId))
        if (!found) {
          setLoadError('That question is not part of this practice set.')
          return
        }
        setQuestion(found)
        setLanguage(RUNTIMES[found.language] ? found.language : DEFAULT_LANGUAGE)
        const draft = readDraft(found.id)
        setCode(draft ?? found.starter_code ?? '')
      })
      .catch((err) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [interviewId, questionId])

  // save the draft as they type
  useEffect(() => {
    if (!question) return
    try {
      window.localStorage.setItem(draftKey(question.id), code)
    } catch {
      // storage full or blocked - the editor still works, the draft just won't survive
    }
  }, [code, question])

  // once the marker is done, go back to the question with the score and model answer on it
  useEffect(() => {
    if (evaluationJob?.status !== 'COMPLETED') return
    navigate(`/practice/${interviewId}`, { state: { focusQuestionId: Number(questionId) } })
  }, [evaluationJob?.status, interviewId, questionId, navigate])

  // dragging the divider between the two panes
  const startDrag = useCallback((event) => {
    event.preventDefault()
    const container = splitRef.current
    if (!container) return

    const onMove = (moveEvent) => {
      const bounds = container.getBoundingClientRect()
      const percent = ((moveEvent.clientX - bounds.left) / bounds.width) * 100
      setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, percent)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const handleSubmit = async () => {
    if (!code.trim()) return
    setSubmitting(true)
    try {
      // send the code, plus whatever it printed last time it ran, so the marker can see
      // whether it actually works rather than only whether it looks right
      const printed = output
        .filter((line) => line.stream !== 'meta')
        .map((line) => line.text)
        .join('\n')
        .trim()
      const answerText = printed ? `${code}\n\n--- Program output ---\n${printed}` : code

      const job = await submitAnswer(interviewId, question.id, answerText)
      setAnswerJobId(job.id)
    } catch (err) {
      setLoadError(err.message)
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <InterviewLoader error={loadError} />
      </div>
    )
  }

  if (!question) {
    return (
      <div className="page">
        <InterviewLoader label="Loading the task…" />
      </div>
    )
  }

  // already submitted: nothing left to do here
  const alreadyAnswered = Boolean(question.answer)
  const runtime = RUNTIMES[language]

  return (
    <div className="page workspace-page">
      {/* the task, so you are not flicking back and forth to read it */}
      <section className="card wide task-card">
        <div className="badge-row">
          {question.topic && <span className="badge">{question.topic}</span>}
          <span className="badge badge-code">Coding task</span>
        </div>
        <p className="question-text">{question.question_text}</p>
        <button type="button" className="chip" onClick={() => navigate(`/practice/${interviewId}`)}>
          ← Back to the question list
        </button>
      </section>

      <div className="workspace" ref={splitRef}>
        {/* language rail, like the one down the side of an online IDE */}
        <aside className="workspace-rail">
          {Object.entries(RUNTIMES).map(([id, meta]) => (
            <button
              key={id}
              type="button"
              className={language === id ? 'rail-button rail-on' : 'rail-button'}
              aria-pressed={language === id}
              title={meta.label}
              onClick={() => setLanguage(id)}
            >
              {meta.label.slice(0, 2).toUpperCase()}
            </button>
          ))}
        </aside>

        {/* editor side */}
        <section className="workspace-editor" style={{ flexBasis: `${split}%` }}>
          <header className="workspace-bar">
            <span className="file-tab">{runtime.filename}</span>
            <div className="workspace-actions">
              <button
                type="button"
                className="chip"
                onClick={() => setCode(question.starter_code ?? '')}
                disabled={running || alreadyAnswered}
              >
                Reset
              </button>
              {running ? (
                <button type="button" className="chip" onClick={stop}>
                  Stop ■
                </button>
              ) : (
                <button type="button" className="run-button" onClick={() => run(code, language)}>
                  Run ▶
                </button>
              )}
            </div>
          </header>
          <CodeEditor value={code} onChange={setCode} language={language} readOnly={alreadyAnswered} />
        </section>

        {/* draggable divider */}
        <div
          className="workspace-split"
          onPointerDown={startDrag}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the editor"
        >
          <span />
        </div>

        {/* output side */}
        <section className="workspace-output">
          <header className="workspace-bar">
            <span className="file-tab">Output</span>
            <button type="button" className="chip" onClick={clearOutput} disabled={output.length === 0}>
              Clear
            </button>
          </header>
          <pre className="output-pane">
            {output.length === 0 && !running && (
              <span className="output-empty">Press Run to execute your code here.</span>
            )}
            {output.map((line, lineIndex) => (
              <span key={lineIndex} className={`output-${line.stream}`}>
                {line.text}
                {'\n'}
              </span>
            ))}
            {running && <span className="output-meta">Running…</span>}
          </pre>
        </section>
      </div>

      {/* submit, or a note if this one is already done */}
      {alreadyAnswered ? (
        <div className="card wide">
          <p className="muted">
            You already submitted this task. The editor is read-only - your marks and the model
            answer are on the question page.
          </p>
          <button type="button" onClick={() => navigate(`/practice/${interviewId}`)}>
            See the marks
          </button>
        </div>
      ) : (
        <div className="card wide">
          <p className="muted">
            Your code runs here in the browser - nothing is uploaded until you submit. Submitting
            sends the code and whatever it last printed to be marked against the model answer.
          </p>
          <button type="button" onClick={handleSubmit} disabled={submitting || !code.trim()}>
            {submitting ? 'Submitting…' : 'Submit for marking'}
          </button>
          {answerJobId && (
            <InterviewLoader
              label="Marking your code…"
              error={evaluationJobError || (evaluationJob?.status === 'FAILED' ? evaluationJob.error : null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
