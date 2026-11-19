import { vi } from 'vitest'

// Stand-ins for the browser APIs the voice interview uses. jsdom has none of them, and the
// tests must never open a real microphone or make a real sound, so every test installs these
// instead and then drives them by hand.

// ---------------- microphone and recording ----------------

export class FakeMediaRecorder {
  // what this "browser" claims it can record. a test can shorten this list to check the
  // format negotiation
  static supportedTypes = ['audio/webm;codecs=opus', 'audio/webm']
  static instances = []

  static isTypeSupported(type) {
    return FakeMediaRecorder.supportedTypes.includes(type)
  }

  constructor(stream, options) {
    this.stream = stream
    this.mimeType = options?.mimeType || 'audio/webm'
    this.state = 'inactive'
    this.listeners = {}
    FakeMediaRecorder.instances.push(this)
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || []
    this.listeners[type].push(handler)
  }

  emit(type, event) {
    ;(this.listeners[type] || []).forEach((handler) => handler(event))
  }

  start() {
    this.state = 'recording'
  }

  // the real thing emits whatever audio it has buffered, then a stop event
  stop({ bytes = 4096 } = {}) {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    if (bytes > 0) {
      this.emit('dataavailable', { data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }) })
    }
    this.emit('stop', {})
  }
}

// installs a working microphone. returns the handles a test needs to inspect it
export function installMicrophone({ fail = null } = {}) {
  FakeMediaRecorder.instances = []

  const track = { kind: 'audio', stop: vi.fn(), addEventListener: vi.fn() }
  const stream = { getTracks: () => [track] }

  const getUserMedia = vi.fn(async () => {
    if (fail) {
      const error = new Error(fail === 'NotAllowedError' ? 'Permission denied' : fail)
      error.name = fail
      throw error
    }
    return stream
  })

  globalThis.navigator.mediaDevices = { getUserMedia }
  globalThis.MediaRecorder = FakeMediaRecorder
  globalThis.isSecureContext = true

  // the level meter and the silence detection read from an analyser
  globalThis.AudioContext = class FakeAudioContext {
    createMediaStreamSource() {
      return { connect: vi.fn() }
    }

    createAnalyser() {
      return {
        fftSize: 1024,
        smoothingTimeConstant: 0.6,
        // a flat line at the midpoint: silence, which is all these tests need
        getByteTimeDomainData: (array) => array.fill(128),
      }
    }

    close() {
      return Promise.resolve()
    }
  }

  return { getUserMedia, track, stream, recorders: FakeMediaRecorder.instances }
}

// takes the microphone away entirely, as an unsupported browser would
export function removeMicrophone() {
  globalThis.navigator.mediaDevices = undefined
  globalThis.MediaRecorder = undefined
}

// ---------------- speech synthesis ----------------

export class FakeUtterance {
  constructor(text) {
    this.text = text
    this.onstart = null
    this.onend = null
    this.onerror = null
  }
}

// installs a speech synthesiser that records what it was asked to say. nothing is spoken
// out loud - `finishSpeaking()` is how a test says "the voice got to the end"
export function installSpeechSynthesis({ voices = null } = {}) {
  const spoken = []
  let current = null

  const voiceList =
    voices ??
    [
      { voiceURI: 'uri-uk-female', name: 'Google UK English Female', lang: 'en-GB', default: false },
      { voiceURI: 'uri-us', name: 'Google US English', lang: 'en-US', default: true },
      { voiceURI: 'uri-fr', name: 'Google français', lang: 'fr-FR', default: false },
    ]

  const synth = {
    speaking: false,
    paused: false,
    getVoices: () => voiceList,
    speak: vi.fn((utterance) => {
      spoken.push(utterance.text)
      current = utterance
      synth.speaking = true
      utterance.onstart?.()
    }),
    cancel: vi.fn(() => {
      const utterance = current
      current = null
      synth.speaking = false
      // a real cancel() fires onend on whatever was being spoken
      utterance?.onend?.()
    }),
    pause: vi.fn(() => {
      synth.paused = true
    }),
    resume: vi.fn(() => {
      synth.paused = false
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }

  globalThis.window.speechSynthesis = synth
  globalThis.window.SpeechSynthesisUtterance = FakeUtterance

  return {
    synth,
    spoken,
    // the voice reaches the end of the question on its own
    finishSpeaking() {
      const utterance = current
      current = null
      synth.speaking = false
      utterance?.onend?.()
    },
    isSpeaking: () => Boolean(current),
  }
}

// a browser with no speech synthesis at all
export function removeSpeechSynthesis() {
  delete globalThis.window.speechSynthesis
  delete globalThis.window.SpeechSynthesisUtterance
}
