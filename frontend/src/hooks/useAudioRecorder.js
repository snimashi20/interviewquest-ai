import { useCallback, useEffect, useRef, useState } from 'react'

// records the candidate's spoken answer through the microphone.
//
// getUserMedia for permission, MediaRecorder for the recording itself, and an AnalyserNode
// off the same stream for the level meter and the optional "stopped talking" detection.
// the recording never leaves the browser except as the upload the interview sends to
// POST /api/voice/transcribe.

// the recorder's own states, which the UI shows as Ready / Listening / Stopping / Error
export const RECORDER_STATUS = {
  IDLE: 'IDLE', // nothing running, ready to start
  REQUESTING: 'REQUESTING', // waiting for the browser's microphone prompt
  RECORDING: 'RECORDING', // listening
  STOPPING: 'STOPPING', // asked to stop, waiting for the last chunk
  ERROR: 'ERROR', // no permission, no device, or the recorder failed
}

// why a recording ended, passed to onComplete so the interview can explain itself
export const STOP_REASON = {
  MANUAL: 'MANUAL', // the candidate pressed stop
  SILENCE: 'SILENCE', // automatic silence detection decided they had finished
  LIMIT: 'LIMIT', // the maximum answer length was reached
}

// the containers worth asking MediaRecorder for, best first. Chrome and Edge give webm/opus,
// Safari gives mp4, Firefox gives ogg - all three are formats the backend accepts.
// nothing here assumes a format: whatever the browser says it supports is what gets used
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
]

// how loud counts as "speaking". this is an RMS level from the waveform, 0 to 1 - quiet room
// noise sits well under this, a voice sits well over it
const SPEECH_THRESHOLD = 0.035
// how long a pause has to last before automatic stopping calls it the end of the answer.
// short enough to feel responsive, long enough not to cut off someone thinking mid-sentence
const DEFAULT_SILENCE_MS = 2500
// ...and we refuse to auto-stop before this much actual speech, so a throat-clear or a
// "um" at the start cannot end the answer
const MIN_SPEECH_MS = 1200

// picks a container this browser can actually record. returns '' to let MediaRecorder choose
export function pickMimeType() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return ''
  for (const candidate of MIME_CANDIDATES) {
    if (window.MediaRecorder.isTypeSupported?.(candidate)) return candidate
  }
  return ''
}

// can this browser record at all? needs MediaRecorder, getUserMedia, and a secure context
// (https or localhost) - the browser itself blocks the microphone anywhere else
export function isRecordingSupported() {
  if (typeof window === 'undefined') return false
  return Boolean(
    window.MediaRecorder &&
      navigator.mediaDevices?.getUserMedia &&
      (window.isSecureContext || window.location.hostname === 'localhost'),
  )
}

// turns the browser's getUserMedia errors into something a candidate can act on
function describeMicrophoneError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow the microphone in your browser, then try again - or switch to typing.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug one in or switch to typing.'
    case 'NotReadableError':
      return 'Your microphone is in use by another app. Close that app and try again.'
    case 'AbortError':
      return 'The microphone stopped unexpectedly. Please try again.'
    default:
      return error?.message || 'Could not start recording.'
  }
}

/**
 * options:
 *   maxSeconds        hard cap on one answer - the recording stops itself at this point
 *   autoStopOnSilence whether to stop automatically once the candidate stops talking
 *   silenceMs         how long that silence has to last
 *   onComplete        ({ blob, mimeType, durationSeconds, reason }) when a recording ends
 *   onError           (message) when the microphone or the recorder fails
 */
export function useAudioRecorder({
  maxSeconds = 180,
  autoStopOnSilence = false,
  silenceMs = DEFAULT_SILENCE_MS,
  onComplete,
  onError,
} = {}) {
  const [status, setStatus] = useState(RECORDER_STATUS.IDLE)
  const [duration, setDuration] = useState(0) // seconds, for the on-screen timer
  const [level, setLevel] = useState(0) // 0..1, for the level meter
  const [error, setError] = useState(null)

  // everything below is held in refs rather than state: these are live browser objects, and
  // re-rendering must not restart a recording or drop a stream
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const frameRef = useRef(null)
  const tickRef = useRef(null)
  const startedAtRef = useRef(0)
  const stopReasonRef = useRef(STOP_REASON.MANUAL)
  // guards against two recordings at once: a double-click, or a second component trying to
  // start while the first is still going
  const activeRef = useRef(false)
  // silence tracking
  const speechMsRef = useRef(0)
  const silenceSinceRef = useRef(null)

  // the callbacks are kept in refs so the long-lived MediaRecorder handlers below always see
  // the current ones without having to tear the recorder down and rebuild it
  const onCompleteRef = useRef(onComplete)
  const onErrorRef = useRef(onError)
  const autoStopRef = useRef(autoStopOnSilence)
  const silenceMsRef = useRef(silenceMs)
  const maxSecondsRef = useRef(maxSeconds)

  useEffect(() => {
    onCompleteRef.current = onComplete
    onErrorRef.current = onError
    autoStopRef.current = autoStopOnSilence
    silenceMsRef.current = silenceMs
    maxSecondsRef.current = maxSeconds
  }, [onComplete, onError, autoStopOnSilence, silenceMs, maxSeconds])

  // hands the microphone back to the operating system and tears down the audio graph.
  // this is the function that matters for "release the microphone": the browser keeps the
  // recording indicator on until every track is stopped
  const releaseMicrophone = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // a track that has already ended throws; nothing to do about it
        }
      })
      streamRef.current = null
    }
    if (audioContextRef.current) {
      const context = audioContextRef.current
      audioContextRef.current = null
      analyserRef.current = null
      // close() is a promise and can reject if the context is already closed
      context.close?.().catch(() => {})
    }
    recorderRef.current = null
    activeRef.current = false
    setLevel(0)
  }, [])

  // watches the waveform: drives the level meter, and decides when the candidate has
  // stopped talking if automatic stopping is turned on
  const watchLevel = useCallback((stopRecording) => {
    const analyser = analyserRef.current
    if (!analyser) return

    const samples = new Uint8Array(analyser.fftSize)
    let lastFrameAt = performance.now()

    const tick = () => {
      if (!analyserRef.current) return

      analyser.getByteTimeDomainData(samples)
      // root mean square of the waveform around its midpoint - a rough loudness
      let sum = 0
      for (let index = 0; index < samples.length; index += 1) {
        const value = (samples[index] - 128) / 128
        sum += value * value
      }
      const rms = Math.sqrt(sum / samples.length)
      setLevel(Math.min(1, rms * 4)) // scaled so a normal speaking voice fills the meter

      const now = performance.now()
      const elapsed = now - lastFrameAt
      lastFrameAt = now

      if (rms >= SPEECH_THRESHOLD) {
        speechMsRef.current += elapsed
        silenceSinceRef.current = null
      } else if (speechMsRef.current >= MIN_SPEECH_MS) {
        // only start the silence clock once they have actually said something
        if (silenceSinceRef.current === null) silenceSinceRef.current = now
        if (autoStopRef.current && now - silenceSinceRef.current >= silenceMsRef.current) {
          stopRecording(STOP_REASON.SILENCE)
          return
        }
      }

      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
  }, [])

  // stops the recording. `reason` explains why, and ends up on the onComplete payload
  const stop = useCallback(
    (reason = STOP_REASON.MANUAL) => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state === 'inactive') return
      stopReasonRef.current = reason
      setStatus(RECORDER_STATUS.STOPPING)
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      try {
        recorder.stop() // the 'stop' handler set up in start() does the rest
      } catch {
        releaseMicrophone()
        setStatus(RECORDER_STATUS.IDLE)
      }
    },
    [releaseMicrophone],
  )

  const fail = useCallback(
    (message) => {
      releaseMicrophone()
      setStatus(RECORDER_STATUS.ERROR)
      setError(message)
      setDuration(0)
      if (onErrorRef.current) onErrorRef.current(message)
    },
    [releaseMicrophone],
  )

  // opens the microphone and starts recording. safe to call twice - the second call is
  // ignored rather than starting a second recording over the top of the first
  const start = useCallback(async () => {
    if (activeRef.current) return false
    if (!isRecordingSupported()) {
      fail(
        'This browser cannot record audio. Use Chrome, Edge or Safari over https (or localhost), or switch to typing.',
      )
      return false
    }

    activeRef.current = true
    setError(null)
    setDuration(0)
    setLevel(0)
    speechMsRef.current = 0
    silenceSinceRef.current = null
    chunksRef.current = []
    stopReasonRef.current = STOP_REASON.MANUAL
    setStatus(RECORDER_STATUS.REQUESTING)

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // echo cancellation is the other half of not recording the interviewer: the
          // question has normally finished before the microphone opens, but if the candidate
          // starts early this stops the speakers bleeding into the answer
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (mediaError) {
      fail(describeMicrophoneError(mediaError))
      return false
    }

    streamRef.current = stream

    // a microphone unplugged mid-answer ends its track
    stream.getTracks().forEach((track) => {
      track.addEventListener?.('ended', () => {
        if (activeRef.current) fail('The microphone was disconnected. Reconnect it and try again.')
      })
    })

    const mimeType = pickMimeType()
    let recorder
    try {
      recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    } catch {
      // a browser that rejects our preferred container still gets a chance with its own
      try {
        recorder = new window.MediaRecorder(stream)
      } catch (recorderError) {
        fail(describeMicrophoneError(recorderError))
        return false
      }
    }

    recorderRef.current = recorder

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
    })

    recorder.addEventListener('error', () => {
      fail('Recording failed. Please try again, or switch to typing.')
    })

    recorder.addEventListener('stop', () => {
      const type = recorder.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type })
      const seconds = (Date.now() - startedAtRef.current) / 1000
      chunksRef.current = []

      releaseMicrophone()
      setStatus(RECORDER_STATUS.IDLE)
      setDuration(0)

      if (onCompleteRef.current) {
        onCompleteRef.current({
          blob,
          mimeType: type,
          durationSeconds: Math.round(seconds * 10) / 10,
          reason: stopReasonRef.current,
        })
      }
    })

    // the level meter and the silence detector both read from this analyser
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (AudioContextClass) {
        const context = new AudioContextClass()
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.6
        source.connect(analyser) // analyser only - never back to the speakers
        audioContextRef.current = context
        analyserRef.current = analyser
        watchLevel(stop)
      }
    } catch {
      // no meter and no silence detection, but the recording itself still works
    }

    startedAtRef.current = Date.now()
    recorder.start(250) // emit a chunk every 250ms so a crash cannot lose the whole answer
    setStatus(RECORDER_STATUS.RECORDING)

    // the on-screen timer, and the hard cap on how long one answer can be
    tickRef.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setDuration(seconds)
      if (seconds >= maxSecondsRef.current) stop(STOP_REASON.LIMIT)
    }, 250)

    return true
  }, [fail, releaseMicrophone, stop, watchLevel])

  // throws the recording away instead of handing it over - used by "start again"
  const cancel = useCallback(() => {
    const recorder = recorderRef.current
    chunksRef.current = []
    if (recorder && recorder.state !== 'inactive') {
      // drop the stop handler so nothing gets transcribed, then stop the hardware
      recorderRef.current = null
      try {
        recorder.stop()
      } catch {
        // ignore
      }
    }
    releaseMicrophone()
    setStatus(RECORDER_STATUS.IDLE)
    setDuration(0)
    setError(null)
  }, [releaseMicrophone])

  const clearError = useCallback(() => {
    setError(null)
    setStatus(RECORDER_STATUS.IDLE)
  }, [])

  // unmounting while recording must not leave the microphone open. this is the cleanup that
  // turns the browser's recording indicator off when the candidate navigates away
  useEffect(
    () => () => {
      const recorder = recorderRef.current
      recorderRef.current = null
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          // ignore
        }
      }
      releaseMicrophone()
    },
    [releaseMicrophone],
  )

  return {
    status,
    duration,
    level,
    error,
    start,
    stop,
    cancel,
    clearError,
    supported: isRecordingSupported(),
    recording: status === RECORDER_STATUS.RECORDING,
    busy: status === RECORDER_STATUS.REQUESTING || status === RECORDER_STATUS.STOPPING,
  }
}
