import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installSpeechSynthesis, removeSpeechSynthesis } from '../test/browserMocks'
import { DEFAULT_RATE, useTextToSpeech } from './useTextToSpeech'

describe('useTextToSpeech', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    removeSpeechSynthesis()
  })

  describe('reading a question out', () => {
    let speech

    beforeEach(() => {
      speech = installSpeechSynthesis()
    })

    it('speaks the text and reports that it is speaking', async () => {
      const { result } = renderHook(() => useTextToSpeech())
      expect(result.current.supported).toBe(true)

      act(() => {
        result.current.speak('Tell me about a system you have built.')
      })

      expect(speech.spoken).toEqual(['Tell me about a system you have built.'])
      expect(result.current.speaking).toBe(true)
    })

    it('calls back only once the question has actually finished', async () => {
      const onDone = vi.fn()
      const { result } = renderHook(() => useTextToSpeech())

      act(() => {
        result.current.speak('A question.', { onDone })
      })
      // the candidate's turn must not start while the interviewer is still talking
      expect(onDone).not.toHaveBeenCalled()

      act(() => {
        speech.finishSpeaking()
      })

      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
      expect(result.current.speaking).toBe(false)
    })

    it('never lets two questions overlap', async () => {
      const { result } = renderHook(() => useTextToSpeech())

      act(() => {
        result.current.speak('First question.')
      })
      act(() => {
        result.current.speak('Second question.')
      })

      // the second speak() cancels the first rather than talking over it
      expect(speech.synth.cancel).toHaveBeenCalled()
      expect(speech.spoken).toEqual(['First question.', 'Second question.'])
    })

    it('calls back when it is stopped part-way, so the interview is not left waiting', async () => {
      const onDone = vi.fn()
      const { result } = renderHook(() => useTextToSpeech())

      act(() => {
        result.current.speak('A long question.', { onDone })
      })
      act(() => {
        result.current.stop()
      })

      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
      expect(result.current.speaking).toBe(false)
    })

    it('replays the last question', async () => {
      const { result } = renderHook(() => useTextToSpeech())

      act(() => {
        result.current.speak('Repeat me.')
      })
      act(() => {
        speech.finishSpeaking()
      })
      act(() => {
        result.current.replay()
      })

      expect(speech.spoken).toEqual(['Repeat me.', 'Repeat me.'])
    })

    it('pauses and resumes', async () => {
      const { result } = renderHook(() => useTextToSpeech())

      act(() => {
        result.current.speak('A question.')
      })
      act(() => {
        result.current.pause()
      })
      expect(speech.synth.pause).toHaveBeenCalled()
      expect(result.current.paused).toBe(true)

      act(() => {
        result.current.resume()
      })
      expect(speech.synth.resume).toHaveBeenCalled()
      expect(result.current.paused).toBe(false)
    })

    it('stops talking when the page goes away', async () => {
      const { result, unmount } = renderHook(() => useTextToSpeech())

      act(() => {
        result.current.speak('A question.')
      })
      unmount()

      // navigating off the interview must not leave a voice finishing a question
      expect(speech.synth.cancel).toHaveBeenCalled()
    })

    it('does not read empty text', async () => {
      const onDone = vi.fn()
      const { result } = renderHook(() => useTextToSpeech())

      act(() => {
        result.current.speak('   ', { onDone })
      })

      expect(speech.synth.speak).not.toHaveBeenCalled()
      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    })
  })

  describe('muting', () => {
    let speech

    beforeEach(() => {
      speech = installSpeechSynthesis()
    })

    it('says nothing while muted, but still hands the turn over', async () => {
      const onDone = vi.fn()
      const { result } = renderHook(() => useTextToSpeech())

      act(() => {
        result.current.toggleMuted()
      })
      expect(result.current.muted).toBe(true)

      act(() => {
        result.current.speak('A question.', { onDone })
      })

      expect(speech.synth.speak).not.toHaveBeenCalled()
      // a muted interview still has to reach the candidate's turn
      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    })

    it('stops mid-sentence when muted while speaking', async () => {
      const { result } = renderHook(() => useTextToSpeech())

      act(() => {
        result.current.speak('A long question.')
      })
      act(() => {
        result.current.toggleMuted()
      })

      expect(speech.synth.cancel).toHaveBeenCalled()
      expect(result.current.speaking).toBe(false)
    })
  })

  describe('choosing a voice', () => {
    it('offers only English voices', async () => {
      installSpeechSynthesis()
      const { result } = renderHook(() => useTextToSpeech())

      await waitFor(() => expect(result.current.voices.length).toBeGreaterThan(0))
      expect(result.current.voices.map((voice) => voice.lang)).toEqual(['en-GB', 'en-US'])
    })

    it('prefers a clear, professional voice by default', async () => {
      installSpeechSynthesis()
      const { result } = renderHook(() => useTextToSpeech())

      await waitFor(() => expect(result.current.voiceURI).toBe('uri-uk-female'))
    })

    it('falls back to any English voice when none of the preferred ones exist', async () => {
      installSpeechSynthesis({
        voices: [{ voiceURI: 'uri-odd', name: 'Some Other Voice', lang: 'en-AU', default: true }],
      })
      const { result } = renderHook(() => useTextToSpeech())

      await waitFor(() => expect(result.current.voiceURI).toBe('uri-odd'))
    })

    it('remembers the voice and speed between interviews', async () => {
      installSpeechSynthesis()
      const first = renderHook(() => useTextToSpeech())

      await waitFor(() => expect(first.result.current.voices.length).toBeGreaterThan(0))
      act(() => {
        first.result.current.setVoiceURI('uri-us')
        first.result.current.setRate(1.2)
      })
      await waitFor(() => expect(first.result.current.rate).toBe(1.2))
      first.unmount()

      const second = renderHook(() => useTextToSpeech())
      expect(second.result.current.rate).toBe(1.2)
      await waitFor(() => expect(second.result.current.voiceURI).toBe('uri-us'))
    })

    it('starts at a slightly slower than normal pace', () => {
      installSpeechSynthesis()
      const { result } = renderHook(() => useTextToSpeech())
      expect(result.current.rate).toBe(DEFAULT_RATE)
      expect(DEFAULT_RATE).toBeLessThan(1)
    })
  })

  describe('a browser with no speech synthesis', () => {
    beforeEach(() => {
      removeSpeechSynthesis()
    })

    it('reports itself unsupported and still hands the turn over', async () => {
      const onDone = vi.fn()
      const { result } = renderHook(() => useTextToSpeech())

      expect(result.current.supported).toBe(false)

      act(() => {
        result.current.speak('A question.', { onDone })
      })

      // the interview carries on with the question on screen only
      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
      expect(result.current.speaking).toBe(false)
    })

    it('does not fall over when stopped', () => {
      const { result } = renderHook(() => useTextToSpeech())
      expect(() => act(() => result.current.stop())).not.toThrow()
    })
  })
})
