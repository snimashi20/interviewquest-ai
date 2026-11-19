import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import AiInterviewerCard from '../components/AiInterviewerCard'
import AnswerInput from '../components/AnswerInput'
import InterviewLoader from '../components/InterviewLoader'
import InterviewPanel from '../components/InterviewPanel'
import QuestionCard from '../components/QuestionCard'
import VoiceAnswerPanel from '../components/VoiceAnswerPanel'
import VoiceSettings from '../components/VoiceSettings'
import { useJobPolling } from '../hooks/useJobPolling'
import { useTextToSpeech } from '../hooks/useTextToSpeech'
import { PHASE, STAGE, useVoiceInterview } from '../hooks/useVoiceInterview'
import { endInterview, getInterview, requestNextQuestion, submitAnswer } from '../services/api'

// the longest one spoken answer may run. the backend enforces its own limit too - this is
// just so the recorder stops itself rather than being cut off by a rejected upload
const MAX_ANSWER_SECONDS = 180

// puts whatever the student is working on into the live interview split screen: the panel
// of interviewers fills the top half, the question and answer area the bottom half.
function LiveScreen({ children }) {
  return (
    <div className="page interview-live">
      <div className="interview-stage">
        <InterviewPanel />
      </div>
      <div className="interview-questions">{children}</div>
    </div>
  )
}

// this page walks the student through the whole question set, in either of two shapes:
//
//   a text interview   - every question was written up front; read it, type an answer, next
//   a voice interview  - the interviewer reads each question aloud, the candidate answers out
//                        loud, the recording is transcribed, they check it and submit, and the
//                        next question is written off the back of what they said
//
// both end on the results page. a voice interview can be switched to typing at any point
// without losing the interview.
export default function Interview() {
  const { interviewId } = useParams() // comes from the URL, e.g. /interview/5
  const location = useLocation() // used to read the jobId we passed from Home
  const navigate = useNavigate()

  const [interview, setInterview] = useState(null) // the full interview once we've loaded it
  const [loadError, setLoadError] = useState(null)
  const [answerJobId, setAnswerJobId] = useState(null) // set once the student submits an answer
  const [nextQuestionJobId, setNextQuestionJobId] = useState(null) // adaptive interviews only
  const [submitting, setSubmitting] = useState(false)
  // 'VOICE' or 'TEXT' - starts as whatever the interview was created as, and the candidate
  // can switch at any time
  const [answerMode, setAnswerMode] = useState(null)
  const [autoStopOnSilence, setAutoStopOnSilence] = useState(false) // opt-in
  const [autoSubmit, setAutoSubmit] = useState(false) // opt-in, off by default
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  const [followUpError, setFollowUpError] = useState(null)

  // if we came here straight from Home, we already have a jobId to poll for the questions
  const questionsJobId = location.state?.jobId ?? null
  const { job: questionsJob, error: questionsJobError } = useJobPolling(questionsJobId)
  const { job: evaluationJob, error: evaluationJobError } = useJobPolling(answerJobId)
  const { job: nextQuestionJob, error: nextQuestionJobError } = useJobPolling(nextQuestionJobId)

  // fetches the latest interview data (questions + whichever answers exist) from the backend
  const refetchInterview = useCallback(async () => {
    try {
      const data = await getInterview(interviewId)
      setInterview(data)
      return data
    } catch (err) {
      setLoadError(err.message)
    }
  }, [interviewId])

  // once the "write the questions" job is done (or if there was never one to wait for,
  // e.g. the page was refreshed), go fetch the interview so we have the questions
  useEffect(() => {
    if (!questionsJobId || questionsJob?.status === 'COMPLETED') {
      refetchInterview()
    }
  }, [questionsJobId, questionsJob?.status, refetchInterview])

  // --- what we are looking at ---

  const questions = interview?.questions ?? []
  // the first question that hasn't been answered yet is the one we're on
  const current = questions.find((question) => !question.answer) ?? null
  const answered = questions.filter((question) => question.answer).length
  const everythingAnswered = questions.length > 0 && answered === questions.length
  // an adaptive interview knows how many questions it will ask before it has written them,
  // so the total comes from the interview rather than from the questions on the table
  const total = interview?.question_count ?? questions.length
  const adaptive = interview?.question_flow === 'ADAPTIVE'
  const completed = interview?.status === 'COMPLETED'
  const awaitingNext = Boolean(interview?.awaiting_next_question) || Boolean(nextQuestionJobId)

  // the interview starts in whatever mode it was created in
  useEffect(() => {
    if (answerMode || !interview) return
    setAnswerMode(interview.interview_type === 'VOICE' ? 'VOICE' : 'TEXT')
  }, [answerMode, interview])

  const voiceMode = answerMode === 'VOICE'

  // which backend wait, if any, the whole screen is in - the voice state machine needs this
  // to tell "the interviewer is thinking" apart from "it is your turn"
  const stage = useMemo(() => {
    if (completed) return STAGE.COMPLETED
    if (answerJobId) return STAGE.EVALUATING
    if (questionsJobId && questionsJob && ['PENDING', 'IN_PROGRESS'].includes(questionsJob.status)) {
      return STAGE.WRITING_FIRST_QUESTION
    }
    if (!current && questions.length === 0) return STAGE.WRITING_FIRST_QUESTION
    if (awaitingNext) return STAGE.WRITING_NEXT_QUESTION
    return null
  }, [completed, answerJobId, questionsJobId, questionsJob, current, questions.length, awaitingNext])

  // --- submitting an answer ---

  // called by both the typed and the spoken answer panels. throws on failure so the voice
  // panel can keep the transcript on screen and let them try again
  const handleAnswerSubmit = useCallback(
    async (answerText, meta = {}) => {
      if (!current || submitting) return
      setSubmitting(true)
      setFollowUpError(null)
      try {
        const job = await submitAnswer(interviewId, current.id, answerText, meta)
        setAnswerJobId(job.id) // start polling this new job for the grading result
      } catch (err) {
        setSubmitting(false)
        setLoadError(err.message)
        throw err
      }
    },
    [current, interviewId, submitting],
  )

  // --- the spoken interview ---

  const tts = useTextToSpeech()
  const voice = useVoiceInterview({
    question: current,
    interviewId,
    stage,
    tts,
    enabled: voiceMode && !completed,
    autoStopOnSilence,
    autoSubmit,
    maxSeconds: MAX_ANSWER_SECONDS,
    onSubmit: handleAnswerSubmit,
  })

  // --- asking for the next question ---

  // an adaptive interview writes its next question once the last answer has been graded.
  // the ref keys on how many answers are in, so this fires once per turn however many times
  // the effect is re-run
  const requestedForRef = useRef(-1)
  const requestNext = useCallback(async () => {
    if (requestedForRef.current === answered) return
    requestedForRef.current = answered
    setFollowUpError(null)
    try {
      const result = await requestNextQuestion(interviewId)
      if (result.question_ready) {
        await refetchInterview()
      } else if (result.job_id) {
        setNextQuestionJobId(result.job_id)
      }
    } catch (err) {
      requestedForRef.current = -1 // let them try again
      setFollowUpError(err.message)
    }
  }, [answered, interviewId, refetchInterview])

  // once the current answer has been graded, reload the interview. that reveals the next
  // unanswered question - or, for an adaptive interview, asks for the next one to be written
  useEffect(() => {
    if (evaluationJob?.status !== 'COMPLETED') return

    let cancelled = false
    refetchInterview().then((data) => {
      if (cancelled || !data) return
      setAnswerJobId(null)
      setSubmitting(false)
      if (data.status === 'COMPLETED') {
        navigate(`/results/${interviewId}`)
      } else if (data.awaiting_next_question) {
        requestNext()
      }
    })

    return () => {
      cancelled = true
    }
  }, [evaluationJob?.status, interviewId, navigate, refetchInterview, requestNext])

  // the next question has been written - pick it up
  useEffect(() => {
    if (nextQuestionJob?.status !== 'COMPLETED') return
    setNextQuestionJobId(null)
    refetchInterview()
  }, [nextQuestionJob?.status, refetchInterview])

  // a failed follow-up leaves the interview sitting there: surface it so they can retry or
  // end the interview, rather than watching a spinner for ever
  useEffect(() => {
    if (nextQuestionJob?.status !== 'FAILED') return
    setNextQuestionJobId(null)
    requestedForRef.current = -1
    setFollowUpError(nextQuestionJob.error || 'The next question could not be written.')
  }, [nextQuestionJob?.status, nextQuestionJob?.error])

  // if this interview is already finished (e.g. the student came back to this page
  // afterwards), skip straight to the results page
  useEffect(() => {
    if (!interview) return
    if (completed || (everythingAnswered && !awaitingNext && !answerJobId)) {
      navigate(`/results/${interviewId}`, { replace: true })
    }
  }, [interview, everythingAnswered, completed, awaitingNext, answerJobId, interviewId, navigate])

  // --- ending early ---

  const handleEndInterview = useCallback(async () => {
    setEnding(true)
    voice.cleanup() // stop the microphone and the voice before anything else
    try {
      await endInterview(interviewId)
      navigate(`/results/${interviewId}`, { replace: true })
    } catch (err) {
      setEnding(false)
      setConfirmEnd(false)
      setLoadError(err.message)
    }
  }, [interviewId, navigate, voice])

  // switching between speaking and typing mid-interview
  const switchMode = useCallback(
    (mode) => {
      if (mode === answerMode) return
      if (mode === 'TEXT') voice.cleanup()
      setAnswerMode(mode)
    },
    [answerMode, voice],
  )

  // --- everything below decides what to actually show on screen, checked in order ---

  // still waiting for the first question(s) to be written
  if (questionsJobId && (!questionsJob || ['PENDING', 'IN_PROGRESS'].includes(questionsJob.status))) {
    return (
      <LiveScreen>
        <InterviewLoader
          label={adaptive ? 'Your interviewer is preparing the first question…' : 'Writing your questions…'}
          error={questionsJobError}
        />
      </LiveScreen>
    )
  }

  // question generation failed (e.g. missing OpenAI key)
  if (questionsJob?.status === 'FAILED') {
    return (
      <div className="page">
        <InterviewLoader error={questionsJob.error || 'Question generation failed.'} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page">
        <InterviewLoader error={loadError} />
      </div>
    )
  }

  // interview hasn't loaded from the backend yet
  if (!interview) {
    return (
      <div className="page">
        <InterviewLoader label="Loading interview…" />
      </div>
    )
  }

  const percent = total === 0 ? 0 : Math.round((answered / total) * 100)
  const isLast = answered + 1 >= total

  // the progress strip shown above the question: how far in they are, which mode they are
  // answering in, and the way out
  const progress = (
    <div className="card question-progress">
      <div className="progress-row">
        <span className="progress-count">
          Question {Math.min(answered + 1, total)} of {total}
        </span>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="progress-controls">
        <div className="chip-row" role="group" aria-label="How you answer">
          <button
            type="button"
            className={`chip${voiceMode ? ' chip-on' : ''}`}
            onClick={() => switchMode('VOICE')}
            aria-pressed={voiceMode}
          >
            Speak
          </button>
          <button
            type="button"
            className={`chip${voiceMode ? '' : ' chip-on'}`}
            onClick={() => switchMode('TEXT')}
            aria-pressed={!voiceMode}
          >
            Type
          </button>
        </div>

        {!confirmEnd ? (
          <button type="button" className="chip chip-danger" onClick={() => setConfirmEnd(true)}>
            End interview
          </button>
        ) : (
          <div className="chip-row">
            <span className="muted">End it here and see your results?</span>
            <button type="button" className="chip chip-danger" onClick={handleEndInterview} disabled={ending}>
              {ending ? 'Ending…' : 'Yes, end it'}
            </button>
            <button type="button" className="chip" onClick={() => setConfirmEnd(false)} disabled={ending}>
              Keep going
            </button>
          </div>
        )}
      </div>

      {interview.cv_filename && <p className="muted">Based on {interview.cv_filename}</p>}
    </div>
  )

  // the interviewer is writing the next question (adaptive), or there is nothing to answer yet
  if (!current) {
    const label =
      stage === STAGE.WRITING_NEXT_QUESTION
        ? 'Your interviewer is preparing the next question…'
        : total === 0
          ? 'Waiting for your questions…'
          : 'Finishing up…'
    return (
      <LiveScreen>
        {progress}
        <InterviewLoader label={label} error={followUpError || nextQuestionJobError} />
        {followUpError && (
          <div className="card">
            <p className="muted">
              The interview is safe - every answer you have given is saved. You can ask for the next
              question again, or finish here and see your results.
            </p>
            <div className="chip-row">
              <button type="button" className="chip" onClick={requestNext}>
                Try again
              </button>
              <button type="button" className="chip chip-danger" onClick={handleEndInterview} disabled={ending}>
                {ending ? 'Ending…' : 'Finish and see results'}
              </button>
            </div>
          </div>
        )}
      </LiveScreen>
    )
  }

  // answer was submitted, waiting for the AI to finish grading it
  if (answerJobId) {
    return (
      <LiveScreen>
        {progress}
        <QuestionCard question={current} />
        <InterviewLoader
          label="Evaluating your answer…"
          error={evaluationJobError || (evaluationJob?.status === 'FAILED' ? evaluationJob.error : null)}
        />
      </LiveScreen>
    )
  }

  // --- the voice interview ---
  if (voiceMode) {
    return (
      <LiveScreen>
        {progress}
        <VoiceSettings
          muted={tts.muted}
          onToggleMuted={tts.toggleMuted}
          voices={tts.voices}
          voiceURI={tts.voiceURI}
          onVoiceChange={tts.setVoiceURI}
          rate={tts.rate}
          onRateChange={tts.setRate}
          ttsSupported={tts.supported}
          autoStopOnSilence={autoStopOnSilence}
          onAutoStopChange={setAutoStopOnSilence}
          autoSubmit={autoSubmit}
          onAutoSubmitChange={setAutoSubmit}
          disabled={voice.recording}
        />

        <AiInterviewerCard
          question={current}
          phase={voice.phase}
          message={voice.message}
          speaking={tts.speaking}
          paused={tts.paused}
          muted={tts.muted}
          ttsSupported={tts.supported}
          onReplay={voice.replayQuestion}
          onPause={tts.pause}
          onResume={tts.resume}
          onSkipSpeaking={tts.stop}
        />

        {voice.recordingSupported ? (
          <VoiceAnswerPanel
            phase={voice.phase}
            transcript={voice.transcript}
            onTranscriptChange={voice.editTranscript}
            recording={voice.recording}
            recorderBusy={voice.recorderBusy}
            recordingSeconds={voice.recordingSeconds}
            level={voice.level}
            maxSeconds={MAX_ANSWER_SECONDS}
            error={voice.error}
            canRetryTranscription={voice.canRetryTranscription}
            onStart={voice.startAnswer}
            onStop={voice.stopAnswer}
            onDiscard={voice.discardAnswer}
            onRetryTranscription={voice.retryTranscription}
            onSubmit={voice.submit}
            isLast={isLast}
            disabled={voice.phase === PHASE.SUBMITTING_ANSWER}
          />
        ) : (
          <div className="card">
            <p className="error-text">
              This browser cannot record audio. Recording needs Chrome, Edge or Safari, served over
              https or on localhost.
            </p>
            <p className="muted">You can answer this interview by typing instead.</p>
            <button type="button" onClick={() => switchMode('TEXT')}>
              Switch to typing
            </button>
          </div>
        )}
      </LiveScreen>
    )
  }

  // --- the text interview: exactly as it was ---
  return (
    <LiveScreen>
      {progress}
      <QuestionCard question={current} />
      <AnswerInput
        key={current.id} // remount on a new question so the textarea starts empty
        // anything already transcribed carries over, so switching to typing mid-answer
        // does not throw the answer away
        initialValue={voice.transcript}
        onSubmit={(answerText) => handleAnswerSubmit(answerText, { source: 'TYPED' })}
        submitting={submitting}
        isLast={isLast}
      />
    </LiveScreen>
  )
}
