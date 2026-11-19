import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// reads text aloud with the browser's own speech synthesiser. this is the "AI interviewer
// speaking" half of a voice interview, and it is free - nothing here calls a paid TTS API.
//
// only ever hand this the question text. feedback, scores and anything else the backend
// sends back are never spoken: the interviewer asks the question and says nothing else.

// the student's choices are remembered between interviews
const STORAGE_KEY = 'iq-tts-settings'

// how fast the interviewer talks. 1 is the browser's normal pace; a little under that is
// easier to follow when the question is technical
export const MIN_RATE = 0.6
export const MAX_RATE = 1.4
export const DEFAULT_RATE = 0.95

// voices whose names suggest a clear, neutral, professional reading, best first. the browser
// decides what it actually has installed, so this is only an order of preference
const PREFERRED_VOICES = [
  'Google UK English Female',
  'Google UK English Male',
  'Microsoft Sonia Online (Natural) - English (United Kingdom)',
  'Microsoft Libby Online (Natural) - English (United Kingdom)',
  'Microsoft Aria Online (Natural) - English (United States)',
  'Google US English',
  'Samantha',
  'Daniel',
]

// does this browser have speech synthesis at all? Safari and Chrome do, some embedded
// webviews do not, and the interview has to stay usable either way
export function isSpeechSynthesisSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

function readStoredSettings() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {}
  } catch {
    return {} // a browser with storage blocked still gets a working interviewer
  }
}

function storeSettings(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // not being able to remember the voice choice is not worth an error
  }
}

// picks the voice to start on: the one the student chose last time if it is still installed,
// otherwise the first of our preferred names, otherwise any English voice at all
function chooseVoice(voices, storedURI) {
  if (!voices.length) return null

  const stored = voices.find((voice) => voice.voiceURI === storedURI)
  if (stored) return stored

  for (const name of PREFERRED_VOICES) {
    const match = voices.find((voice) => voice.name === name)
    if (match) return match
  }

  return voices.find((voice) => voice.default) || voices[0]
}

export function useTextToSpeech() {
  const supported = useMemo(() => isSpeechSynthesisSupported(), [])
  const stored = useMemo(() => (supported ? readStoredSettings() : {}), [supported])

  const [voices, setVoices] = useState([])
  const [voiceURI, setVoiceURI] = useState(stored.voiceURI ?? null)
  const [rate, setRate] = useState(stored.rate ?? DEFAULT_RATE)
  const [muted, setMuted] = useState(stored.muted ?? false)
  const [speaking, setSpeaking] = useState(false)
  const [paused, setPaused] = useState(false)

  // the utterance currently being spoken, and the last thing we were asked to say (so the
  // "replay question" button has something to replay)
  const utteranceRef = useRef(null)
  const lastTextRef = useRef('')
  // whoever asked us to speak wants to know when we have finished, even if "finished" means
  // "was cancelled" or "this browser cannot speak" - the interview waits on this callback
  const doneRef = useRef(null)

  // the available voices arrive asynchronously in Chrome: the first call returns an empty
  // list and a voiceschanged event follows. both paths are handled here
  useEffect(() => {
    if (!supported) return undefined

    const synth = window.speechSynthesis
    let cancelled = false

    const load = () => {
      if (cancelled) return
      // English only - the interview is in English, and offering 80 voices is not a choice
      const available = synth.getVoices().filter((voice) => voice.lang?.toLowerCase().startsWith('en'))
      if (available.length) setVoices(available)
    }

    load()
    synth.addEventListener?.('voiceschanged', load)
    // some builds only ever fire the old-style handler
    if (!synth.addEventListener) synth.onvoiceschanged = load

    return () => {
      cancelled = true
      synth.removeEventListener?.('voiceschanged', load)
      if (synth.onvoiceschanged === load) synth.onvoiceschanged = null
    }
  }, [supported])

  // once the voices are known, settle on one
  useEffect(() => {
    if (!voices.length) return
    const chosen = chooseVoice(voices, voiceURI)
    if (chosen && chosen.voiceURI !== voiceURI) setVoiceURI(chosen.voiceURI)
  }, [voices, voiceURI])

  // remember the settings for next time
  useEffect(() => {
    if (!supported) return
    storeSettings({ voiceURI, rate, muted })
  }, [supported, voiceURI, rate, muted])

  // calls back whoever was waiting on this utterance, exactly once
  const finish = useCallback(() => {
    const done = doneRef.current
    doneRef.current = null
    utteranceRef.current = null
    setSpeaking(false)
    setPaused(false)
    if (done) done()
  }, [])

  // stops talking immediately. used when the candidate starts answering early, when the
  // question changes, when the interview ends, and when this component goes away
  const stop = useCallback(() => {
    if (supported) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        // cancelling something that was not speaking is not an error
      }
    }
    finish()
  }, [supported, finish])

  // speaks `text`, calling onDone when it finishes.
  //
  // onDone always runs: muted, unsupported, interrupted or spoken to the end. the interview
  // hands the microphone over in that callback, so it must never be the thing that hangs
  const speak = useCallback(
    (text, { onDone } = {}) => {
      const spoken = (text || '').trim()
      lastTextRef.current = spoken

      // nothing to say, no synthesiser, or the student has muted us: go straight to "done"
      if (!spoken || !supported || muted) {
        setSpeaking(false)
        setPaused(false)
        if (onDone) onDone()
        return
      }

      const synth = window.speechSynthesis
      // never let two questions overlap
      try {
        synth.cancel()
      } catch {
        // ignore
      }

      const utterance = new window.SpeechSynthesisUtterance(spoken)
      const voice = voices.find((item) => item.voiceURI === voiceURI)
      if (voice) {
        utterance.voice = voice
        utterance.lang = voice.lang
      } else {
        utterance.lang = 'en-GB'
      }
      utterance.rate = rate
      utterance.pitch = 1

      doneRef.current = onDone || null
      utteranceRef.current = utterance

      utterance.onstart = () => {
        setSpeaking(true)
        setPaused(false)
      }
      utterance.onend = () => {
        // a cancel() also fires onend, which is what we want: either way we are no longer
        // speaking and the candidate's turn can begin
        if (utteranceRef.current === utterance) finish()
      }
      utterance.onerror = () => {
        if (utteranceRef.current === utterance) finish()
      }

      setSpeaking(true)
      synth.speak(utterance)
    },
    [supported, muted, voices, voiceURI, rate, finish],
  )

  const pause = useCallback(() => {
    if (!supported || !speaking) return
    try {
      window.speechSynthesis.pause()
      setPaused(true)
    } catch {
      // some browsers refuse to pause mid-utterance; leave it running rather than break
    }
  }, [supported, speaking])

  const resume = useCallback(() => {
    if (!supported) return
    try {
      window.speechSynthesis.resume()
      setPaused(false)
    } catch {
      // ignore
    }
  }, [supported])

  // says the last question again from the start
  const replay = useCallback(
    (options) => {
      if (!lastTextRef.current) return
      speak(lastTextRef.current, options)
    },
    [speak],
  )

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      // muting mid-sentence stops the sentence
      if (!current) stop()
      return !current
    })
  }, [stop])

  // whatever happens, stop talking when this goes away: navigating off the interview page
  // must not leave a voice finishing a question to an empty screen
  useEffect(
    () => () => {
      if (isSpeechSynthesisSupported()) {
        try {
          window.speechSynthesis.cancel()
        } catch {
          // ignore
        }
      }
    },
    [],
  )

  return {
    supported,
    voices,
    voiceURI,
    setVoiceURI,
    rate,
    setRate,
    muted,
    setMuted,
    toggleMuted,
    speaking,
    paused,
    speak,
    pause,
    resume,
    stop,
    replay,
  }
}
