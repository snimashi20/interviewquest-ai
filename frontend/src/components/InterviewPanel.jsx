// the "interview panel" video strip that sits across the top half of the screen while a
// live interview is running. it's a static image stand-in for the panel's video feed, so
// the student answers while looking at the interviewers rather than at an empty page.
export default function InterviewPanel() {
  return (
    <div className="interview-panel">
      <img
        src="/interview-panel.png"
        alt="Interview panel: three interviewers on a video call"
        className="interview-panel-feed"
      />
      <span className="interview-panel-live">
        <span className="live-dot" aria-hidden="true" />
        Live
      </span>
    </div>
  )
}
