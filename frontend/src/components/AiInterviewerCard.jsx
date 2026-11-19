import { PHASE } from '../hooks/useVoiceInterview'

// the AI interviewer's half of a voice interview: who is asking, the question itself, whether
// they are currently speaking, and the controls for hearing it again.
//
// only the question text is ever passed to the speech synthesiser - the score, the feedback
// and anything else the backend returns is never read out.
export default function AiInterviewerCard({
  question,
  phase,
  message,
  speaking,
  paused,
  muted,
  ttsSupported,
  onReplay,
  onPause,
  onResume,
  onSkipSpeaking,
}) {
  const working = phase === PHASE.GENERATING_QUESTION || phase === PHASE.GENERATING_FOLLOWUP

  return (
    <div className="card interviewer-card">
      <div className="interviewer-head">
        <div className="interviewer-identity">
          {/* a plain monogram rather than a stock photo of someone who does not exist */}
          <span className={`interviewer-avatar${speaking ? ' interviewer-avatar-speaking' : ''}`} aria-hidden="true">
            AI
          </span>
          <div>
            <strong className="interviewer-name">AI Interviewer</strong>
            {/* the one line that says what is happening right now */}
            <p className="muted interviewer-status" role="status" aria-live="polite">
              {working && <span className="spinner spinner-inline" aria-hidden="true" />}
              {message}
            </p>
          </div>
        </div>

        {/* the speaking animation doubles as the "is it still talking?" indicator */}
        {speaking && (
          <span className="speaking-wave" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
        )}
      </div>

      {question && (
        <>
          <div className="badge-row">
            {question.topic && <span className="badge">{question.topic}</span>}
            {question.is_followup && <span className="badge badge-followup">Follow-up</span>}
          </div>
          {/* the question is on screen as well as read aloud - a candidate who missed a word
              should not have to replay the whole thing, and a muted interview still works */}
          <p className="question-text">{question.question_text}</p>
        </>
      )}

      {question && ttsSupported && (
        <div className="chip-row interviewer-controls">
          <button type="button" className="chip" onClick={onReplay} disabled={muted}>
            {speaking ? 'Start again' : 'Read the question again'}
          </button>

          {speaking && !paused && (
            <button type="button" className="chip" onClick={onPause}>
              Pause
            </button>
          )}
          {speaking && paused && (
            <button type="button" className="chip" onClick={onResume}>
              Resume
            </button>
          )}
          {speaking && (
            <button type="button" className="chip" onClick={onSkipSpeaking}>
              Skip to my answer
            </button>
          )}
        </div>
      )}

      {!ttsSupported && (
        <p className="muted">
          This browser cannot read questions aloud, so they are shown on screen only. You can still
          answer by speaking.
        </p>
      )}
    </div>
  )
}
