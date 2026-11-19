import { useState } from 'react'
import { MAX_RATE, MIN_RATE } from '../hooks/useTextToSpeech'

// the voice controls for a spoken interview: mute, which voice reads the questions, how fast
// it talks, and the two optional behaviours (stop on silence, submit without checking).
//
// collapsed by default - it is a settings drawer, not part of the interview.
export default function VoiceSettings({
  muted,
  onToggleMuted,
  voices,
  voiceURI,
  onVoiceChange,
  rate,
  onRateChange,
  ttsSupported,
  autoStopOnSilence,
  onAutoStopChange,
  autoSubmit,
  onAutoSubmitChange,
  disabled = false,
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="card voice-settings">
      <div className="voice-settings-head">
        <div className="chip-row">
          <button
            type="button"
            className={`chip${muted ? '' : ' chip-on'}`}
            onClick={onToggleMuted}
            disabled={!ttsSupported}
            aria-pressed={!muted}
          >
            {muted ? 'Interviewer muted' : 'Interviewer audible'}
          </button>
          <button type="button" className="chip" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
            {open ? 'Hide voice settings' : 'Voice settings'}
          </button>
        </div>
      </div>

      {open && (
        <div className="voice-settings-body">
          <label className="field">
            <span>Interviewer voice</span>
            <select
              value={voiceURI || ''}
              onChange={(event) => onVoiceChange(event.target.value)}
              disabled={!ttsSupported || voices.length === 0}
            >
              {voices.length === 0 && <option value="">No voices available in this browser</option>}
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Speaking speed: {rate.toFixed(2)}x</span>
            <input
              type="range"
              min={MIN_RATE}
              max={MAX_RATE}
              step={0.05}
              value={rate}
              onChange={(event) => onRateChange(Number(event.target.value))}
              disabled={!ttsSupported}
            />
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={autoStopOnSilence}
              onChange={(event) => onAutoStopChange(event.target.checked)}
              disabled={disabled}
            />
            <span>
              Stop recording automatically when I stop talking
              <span className="muted"> - after about 2.5 seconds of silence. Short pauses are ignored.</span>
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={autoSubmit}
              onChange={(event) => onAutoSubmitChange(event.target.checked)}
              disabled={disabled}
            />
            <span>
              Submit my answer without showing me the transcript
              <span className="muted"> - faster, but you cannot correct what it misheard.</span>
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
