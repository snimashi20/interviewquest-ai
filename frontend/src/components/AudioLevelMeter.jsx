// a row of bars that rises and falls with how loudly the candidate is speaking, so they can
// see the microphone is actually picking them up before they talk for a minute and a half.
//
// `level` is 0..1 from useAudioRecorder. purely decorative: it carries no information the
// status text doesn't already give, so it is hidden from screen readers.
const BAR_COUNT = 14

export default function AudioLevelMeter({ level = 0, active = false }) {
  return (
    <div className={`level-meter${active ? ' level-meter-on' : ''}`} aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, index) => {
        // the middle bars react most, which reads as a voice rather than a progress bar
        const distanceFromCentre = Math.abs(index - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2)
        const shape = 1 - distanceFromCentre * 0.65
        const height = active ? Math.max(8, Math.min(100, level * 100 * shape * 1.6)) : 8
        return <span key={index} className="level-bar" style={{ height: `${height}%` }} />
      })}
    </div>
  )
}
