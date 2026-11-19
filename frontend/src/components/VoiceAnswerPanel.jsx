import AudioLevelMeter from './AudioLevelMeter'
import { PHASE } from '../hooks/useVoiceInterview'

// mm:ss, for the recording timer
function formatSeconds(total) {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// the candidate's half of a voice interview: the microphone button, the timer, the level
// meter, and the transcript once there is one.
//
// the transcript is editable before it is submitted, because no transcriber gets every
// technical term right and the answer is what gets graded.
export default function VoiceAnswerPanel({
  phase,
  transcript,
  onTranscriptChange,
  recording,
  recorderBusy,
  recordingSeconds,
  level,
  maxSeconds,
  error,
  canRetryTranscription,
  onStart,
  onStop,
  onDiscard,
  onRetryTranscription,
  onSubmit,
  isLast = false,
  disabled = false,
}) {
  const transcribing = phase === PHASE.TRANSCRIBING
  const submitting = phase === PHASE.SUBMITTING_ANSWER
  const reviewing = phase === PHASE.REVIEWING_TRANSCRIPT
  const interviewerSpeaking = phase === PHASE.INTERVIEWER_SPEAKING
  const hasTranscript = Boolean(transcript.trim())

  // what the microphone button says, which is also what state the panel is in
  let statusLabel = 'Ready when you are'
  if (recorderBusy && !recording) statusLabel = 'Opening your microphone…'
  else if (recording) statusLabel = 'Listening'
  else if (transcribing) statusLabel = 'Transcribing'
  else if (submitting) statusLabel = 'Evaluating'
  else if (error) statusLabel = 'Needs attention'
  else if (hasTranscript) statusLabel = 'Check your answer'

  return (
    <div className="card answer-panel">
      <div className="answer-panel-head">
        <div>
          <strong className="answer-panel-title">Your answer</strong>
          <p className="muted" role="status" aria-live="polite">
            {statusLabel}
          </p>
        </div>
        {/* the timer only exists while a recording is running, so it cannot imply otherwise */}
        {recording && (
          <span className="recording-timer">
            <span className="live-dot" aria-hidden="true" />
            {formatSeconds(recordingSeconds)}
            <span className="muted"> / {formatSeconds(maxSeconds)}</span>
          </span>
        )}
      </div>

      <AudioLevelMeter level={level} active={recording} />

      <div className="chip-row answer-actions">
        {!recording ? (
          <button
            type="button"
            className="mic-button"
            onClick={onStart}
            disabled={disabled || recorderBusy || transcribing || submitting}
            aria-label={hasTranscript ? 'Record your answer again' : 'Start speaking your answer'}
          >
            <span className="mic-glyph" aria-hidden="true" />
            {hasTranscript ? 'Record again' : 'Start speaking'}
          </button>
        ) : (
          <button type="button" className="mic-button mic-button-stop" onClick={onStop} aria-label="Stop recording">
            <span className="mic-stop-glyph" aria-hidden="true" />
            Stop speaking
          </button>
        )}

        {/* answering before the interviewer has finished is allowed - it stops them talking */}
        {interviewerSpeaking && !recording && (
          <span className="muted">The interviewer is still speaking - starting now will interrupt them.</span>
        )}

        {(hasTranscript || error) && !recording && (
          <button type="button" className="chip" onClick={onDiscard} disabled={transcribing || submitting}>
            Start again
          </button>
        )}

        {canRetryTranscription && !recording && (
          <button type="button" className="chip" onClick={onRetryTranscription} disabled={transcribing}>
            Try transcribing again
          </button>
        )}
      </div>

      {transcribing && (
        <div className="transcribing-row">
          <span className="spinner spinner-inline" aria-hidden="true" />
          <span className="muted">Turning your recording into text…</span>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {(hasTranscript || reviewing) && (
        <label className="field">
          <span>Transcript - edit anything it got wrong</span>
          <textarea
            rows={6}
            value={transcript}
            onChange={(event) => onTranscriptChange(event.target.value)}
            disabled={transcribing || submitting}
            placeholder="Your transcribed answer appears here."
          />
        </label>
      )}

      <button type="button" onClick={() => onSubmit()} disabled={disabled || !hasTranscript || transcribing || submitting}>
        {submitting ? 'Submitting…' : isLast ? 'Submit & Finish' : 'Submit & Next Question'}
      </button>

      {!hasTranscript && !recording && !transcribing && !error && (
        <p className="muted">
          Press <strong>Start speaking</strong>, answer out loud, then press stop. You will get the
          text to check before it is submitted.
        </p>
      )}
    </div>
  )
}
