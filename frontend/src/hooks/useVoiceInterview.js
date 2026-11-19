import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeAnswer } from '../services/api'
import { RECORDER_STATUS, useAudioRecorder } from './useAudioRecorder'

// the turn-taking state machine for a spoken interview.
//
// one question at a time, and only ever one thing happening at once: the interviewer speaks,
// then the candidate answers, then the answer is transcribed, then the candidate checks it and
// submits. the phases below are the whole truth about what the screen is allowed to show, so
// a double-click or a slow network cannot produce two recordings or two submissions.

export const PHASE = {
  IDLE: 'IDLE',
  GENERATING_QUESTION: 'GENERATING_QUESTION',
  INTERVIEWER_SPEAKING: 'INTERVIEWER_SPEAKING',
  READY_FOR_ANSWER: 'READY_FOR_ANSWER',
  CANDIDATE_SPEAKING: 'CANDIDATE_SPEAKING',
  TRANSCRIBING: 'TRANSCRIBING',
  REVIEWING_TRANSCRIPT: 'REVIEWING_TRANSCRIPT',
  SUBMITTING_ANSWER: 'SUBMITTING_ANSWER',
  GENERATING_FOLLOWUP: 'GENERATING_FOLLOWUP',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
}

// what the page is waiting on the backend for. the hook owns the candidate's turn; the page
// owns the parts that are a job being polled, and tells the hook about them through `stage`
export const STAGE = {
  WRITING_FIRST_QUESTION: 'WRITING_FIRST_QUESTION',
  WRITING_NEXT_QUESTION: 'WRITING_NEXT_QUESTION',
  EVALUATING: 'EVALUATING',
  COMPLETED: 'COMPLETED',
}

// the candidate's own half of the turn, which the hook drives
const TURN = {
  WAITING: 'WAITING', // no question to answer yet
  SPEAKING: 'SPEAKING', // the interviewer is reading the question out
  READY: 'READY', // the candidate's turn - the microphone is not open yet
  RECORDING: 'RECORDING',
  TRANSCRIBING: 'TRANSCRIBING',
  REVIEWING: 'REVIEWING', // the transcript is on screen to be checked and submitted
}

// a one-line status message per phase, shown under the interviewer
export const PHASE_MESSAGES = {
  [PHASE.IDLE]: 'Getting ready…',
  [PHASE.GENERATING_QUESTION]: 'AI is preparing your first question…',
  [PHASE.GENERATING_FOLLOWUP]: 'AI is preparing your next question…',
  [PHASE.INTERVIEWER_SPEAKING]: 'Interviewer is speaking…',
  [PHASE.READY_FOR_ANSWER]: 'Your turn to answer.',
  [PHASE.CANDIDATE_SPEAKING]: 'Listening…',
  [PHASE.TRANSCRIBING]: 'Transcribing your answer…',
  [PHASE.REVIEWING_TRANSCRIPT]: 'Check your answer, then submit it.',
  [PHASE.SUBMITTING_ANSWER]: 'Evaluating your response…',
  [PHASE.COMPLETED]: 'Interview complete.',
  [PHASE.ERROR]: 'Something needs your attention.',
}

/**
 * options:
 *   question          the current question row (or null while one is being written)
 *   interviewId       used to attribute the audio minutes to this interview
 *   stage             what the page is waiting on the backend for - see STAGE
 *   tts               the useTextToSpeech instance (shared with the settings panel)
 *   enabled           false in text mode: nothing speaks and the microphone stays shut
 *   autoStopOnSilence stop recording once the candidate stops talking
 *   autoSubmit        submit the transcript without waiting to be told (off by default)
 *   maxSeconds        the longest one spoken answer may be
 *   onSubmit          async (text, { source, audioSeconds, transcriptEdited }) => void
 */
export function useVoiceInterview({
  question,
  interviewId,
  stage = null,
  tts,
  enabled = true,
  autoStopOnSilence = false,
  autoSubmit = false,
  maxSeconds = 180,
  onSubmit,
}) {
  const [turn, setTurn] = useState(TURN.WAITING)
  const [transcript, setTranscript] = useState('')
  const [transcriptEdited, setTranscriptEdited] = useState(false)
  const [audioSeconds, setAudioSeconds] = useState(null)
  const [error, setError] = useState(null)
  // true when the last failure was a transcription we can simply try again, because the
  // recording is still in memory. a microphone failure is not retryable in that sense
  const [canRetryTranscription, setCanRetryTranscription] = useState(false)

  // the recording we are working with, kept so a failed transcription can be retried
  // without making the candidate say it all again
  const recordingRef = useRef(null)
  // the question we have already read out, so a re-render cannot start it again
  const spokenForRef = useRef(null)
  // one submission at a time, whatever the UI does
  const submittingRef = useRef(false)
  const onSubmitRef = useRef(onSubmit)
  const autoSubmitRef = useRef(autoSubmit)
  // auto-submit happens inside the transcription step, which is defined before submit() is,
  // so it goes through this ref rather than calling it directly
  const submitTranscriptRef = useRef(null)

  useEffect(() => {
    onSubmitRef.current = onSubmit
    autoSubmitRef.current = autoSubmit
  }, [onSubmit, autoSubmit])

  // ---- transcription ----

  const runTranscription = useCallback(
    async (recording) => {
      setTurn(TURN.TRANSCRIBING)
      setError(null)
      try {
        const result = await transcribeAnswer({
          blob: recording.blob,
          mimeType: recording.mimeType,
          durationSeconds: recording.durationSeconds,
          interviewId,
        })
        setTranscript(result.text)
        setTranscriptEdited(false)
        setAudioSeconds(recording.durationSeconds)
        setCanRetryTranscription(false)
        setTurn(TURN.REVIEWING)

        // auto-submit is off by default: most candidates want to read the transcript first
        if (autoSubmitRef.current) {
          // deliberately not awaited here - submit() guards against double submission
          setTimeout(() => submitTranscriptRef.current?.(result.text), 0)
        }
      } catch (transcriptionError) {
        // the recording is still in memory, so offer a retry rather than losing the answer
        setError(transcriptionError.message)
        setCanRetryTranscription(true)
        setTurn(TURN.REVIEWING)
      }
    },
    [interviewId],
  )

  // ---- the recorder ----

  const handleRecordingComplete = useCallback(
    (recording) => {
      recordingRef.current = recording
      // a recording with nothing in it is not an answer - say so instead of paying to
      // transcribe silence
      if (!recording.blob || recording.blob.size < 1024) {
        setError('That recording was empty. Check your microphone and try again.')
        setCanRetryTranscription(false)
        setTranscript('')
        setTurn(TURN.READY)
        return
      }
      runTranscription(recording)
    },
    [runTranscription],
  )

  const handleRecorderError = useCallback((message) => {
    setError(message)
    setCanRetryTranscription(false)
    setTurn(TURN.READY)
  }, [])

  const recorder = useAudioRecorder({
    maxSeconds,
    autoStopOnSilence,
    onComplete: handleRecordingComplete,
    onError: handleRecorderError,
  })

  // useAudioRecorder and useTextToSpeech both return a fresh object every render, so the
  // effects below depend on these individual callbacks (which are stable) instead
  const { start: startRecording, stop: stopRecording, cancel: cancelRecording } = recorder
  const { stop: stopSpeaking, speak } = tts

  // ---- reading the question out ----

  // speaks the current question, then hands the microphone over. the candidate's turn only
  // starts once the interviewer has finished, which is what keeps the microphone from
  // recording the question being played out of the speakers
  const askQuestion = useCallback(
    (text) => {
      setTurn(TURN.SPEAKING)
      speak(text, {
        onDone: () => {
          // if the candidate has already moved on (started recording, or the question
          // changed under us) do not drag them back
          setTurn((current) => (current === TURN.SPEAKING ? TURN.READY : current))
        },
      })
    },
    [speak],
  )

  // a new question: reset everything from the last one and read it out, once
  useEffect(() => {
    if (!enabled) return
    if (stage === STAGE.COMPLETED) return
    if (!question || question.answer) return
    if (spokenForRef.current === question.id) return

    spokenForRef.current = question.id
    recordingRef.current = null
    submittingRef.current = false
    setTranscript('')
    setTranscriptEdited(false)
    setAudioSeconds(null)
    setError(null)
    setCanRetryTranscription(false)
    askQuestion(question.question_text)
  }, [enabled, question, stage, askQuestion])

  // nothing should be speaking or listening once the interview is over
  useEffect(() => {
    if (stage !== STAGE.COMPLETED) return
    stopSpeaking()
    cancelRecording()
    setTurn(TURN.WAITING)
  }, [stage, stopSpeaking, cancelRecording])

  // leaving voice mode (switching to typing) shuts the microphone and the voice up
  useEffect(() => {
    if (enabled) return
    stopSpeaking()
    cancelRecording()
    spokenForRef.current = null
    setTurn(TURN.WAITING)
  }, [enabled, stopSpeaking, cancelRecording])

  // ---- the actions the UI calls ----

  // "Start Speaking". stops the question playing first, so the two never overlap
  const startAnswer = useCallback(async () => {
    if (recorder.recording || recorder.busy) return
    if (submittingRef.current) return
    stopSpeaking() // if they are answering early, the interviewer stops talking
    setError(null)
    setCanRetryTranscription(false)
    setTranscript('')
    setTranscriptEdited(false)
    const started = await startRecording()
    if (started) setTurn(TURN.RECORDING)
  }, [recorder.recording, recorder.busy, startRecording, stopSpeaking])

  // "Stop Speaking"
  const stopAnswer = useCallback(() => {
    if (!recorder.recording) return
    stopRecording()
  }, [recorder.recording, stopRecording])

  // "Read the question again"
  const replayQuestion = useCallback(() => {
    if (recorder.recording || !question) return
    setTurn(TURN.SPEAKING)
    speak(question.question_text, {
      onDone: () => setTurn((current) => (current === TURN.SPEAKING ? TURN.READY : current)),
    })
  }, [question, recorder.recording, speak])

  // "Start again" - throw the recording and the transcript away, back to the candidate's turn
  const discardAnswer = useCallback(() => {
    cancelRecording()
    recordingRef.current = null
    setTranscript('')
    setTranscriptEdited(false)
    setAudioSeconds(null)
    setError(null)
    setCanRetryTranscription(false)
    setTurn(TURN.READY)
  }, [cancelRecording])

  // "Try transcribing again" - the recording never left the browser, so this costs no
  // re-recording, just another transcription call
  const retryTranscription = useCallback(() => {
    const recording = recordingRef.current
    if (!recording) return
    runTranscription(recording)
  }, [runTranscription])

  // the candidate correcting the transcript before submitting it
  const editTranscript = useCallback((text) => {
    setTranscript(text)
    setTranscriptEdited(true)
  }, [])

  // submits the transcript as the answer. guarded so the same answer cannot go twice
  const submit = useCallback(
    async (textOverride) => {
      const text = (textOverride ?? transcript ?? '').trim()
      if (!text) {
        setError('There is nothing to submit yet. Record an answer first.')
        return
      }
      if (submittingRef.current) return
      submittingRef.current = true

      stopSpeaking()
      setError(null)
      try {
        await onSubmitRef.current?.(text, {
          source: 'SPOKEN',
          audioSeconds,
          transcriptEdited,
        })
        // the page takes over from here (stage becomes EVALUATING), and the next question
        // resets this state
        setTurn(TURN.WAITING)
      } catch (submitError) {
        // the transcript is still on screen, so they can try again without re-recording
        submittingRef.current = false
        setError(submitError.message)
        setTurn(TURN.REVIEWING)
      }
    },
    [transcript, audioSeconds, transcriptEdited, stopSpeaking],
  )

  useEffect(() => {
    submitTranscriptRef.current = submit
  }, [submit])

  // stops everything. used by "End Interview" and when the page unmounts
  const cleanup = useCallback(() => {
    stopSpeaking()
    cancelRecording()
    recordingRef.current = null
    submittingRef.current = false
    setTurn(TURN.WAITING)
  }, [stopSpeaking, cancelRecording])

  // ---- which phase are we actually in ----

  // the page's own waiting states win: a question being written or an answer being graded is
  // the whole screen, whatever the candidate's turn was doing
  let phase
  if (stage === STAGE.COMPLETED) {
    phase = PHASE.COMPLETED
  } else if (stage === STAGE.WRITING_FIRST_QUESTION) {
    phase = PHASE.GENERATING_QUESTION
  } else if (stage === STAGE.WRITING_NEXT_QUESTION) {
    phase = PHASE.GENERATING_FOLLOWUP
  } else if (stage === STAGE.EVALUATING) {
    phase = PHASE.SUBMITTING_ANSWER
  } else if (recorder.status === RECORDER_STATUS.ERROR && error) {
    phase = PHASE.ERROR
  } else if (turn === TURN.SPEAKING) {
    phase = PHASE.INTERVIEWER_SPEAKING
  } else if (turn === TURN.RECORDING) {
    phase = PHASE.CANDIDATE_SPEAKING
  } else if (turn === TURN.TRANSCRIBING) {
    phase = PHASE.TRANSCRIBING
  } else if (turn === TURN.REVIEWING) {
    phase = PHASE.REVIEWING_TRANSCRIPT
  } else if (turn === TURN.READY) {
    phase = PHASE.READY_FOR_ANSWER
  } else {
    phase = PHASE.IDLE
  }

  return {
    phase,
    message: error && phase !== PHASE.SUBMITTING_ANSWER ? error : PHASE_MESSAGES[phase],
    error,
    canRetryTranscription,
    transcript,
    transcriptEdited,
    audioSeconds,
    // recorder passthrough for the candidate panel
    recording: recorder.recording,
    recorderBusy: recorder.busy,
    recordingSeconds: recorder.duration,
    level: recorder.level,
    recordingSupported: recorder.supported,
    // actions
    startAnswer,
    stopAnswer,
    replayQuestion,
    discardAnswer,
    retryTranscription,
    editTranscript,
    submit,
    cleanup,
    // true while something is in flight that a second click must not duplicate
    busy:
      phase === PHASE.TRANSCRIBING ||
      phase === PHASE.SUBMITTING_ANSWER ||
      phase === PHASE.GENERATING_QUESTION ||
      phase === PHASE.GENERATING_FOLLOWUP,
  }
}
