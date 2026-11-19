import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeMediaRecorder,
  installMicrophone,
  installSpeechSynthesis,
  removeSpeechSynthesis,
} from '../test/browserMocks'
import { transcribeAnswer } from '../services/api'
import { useTextToSpeech } from './useTextToSpeech'
import { PHASE, STAGE, useVoiceInterview } from './useVoiceInterview'

// the backend is never called in these tests - this is the only thing that would have
vi.mock('../services/api', () => ({ transcribeAnswer: vi.fn() }))

const QUESTION = {
  id: 7,
  question_text: 'Tell me about a performance problem you have fixed.',
  topic: 'Performance',
  question_number: 1,
  answer: null,
}

// the page wires the speech hook and the interview hook together, so the tests do too
function useHarness(props) {
  const tts = useTextToSpeech()
  const voice = useVoiceInterview({ interviewId: 1, tts, ...props })
  return { tts, voice }
}

describe('useVoiceInterview', () => {
  let speech
  let microphone

  beforeEach(() => {
    window.localStorage.clear()
    speech = installSpeechSynthesis()
    microphone = installMicrophone()
    transcribeAnswer.mockReset()
    transcribeAnswer.mockResolvedValue({
      text: 'I profiled the endpoint and added an index.',
      model: 'gpt-transcribe',
      audio_seconds: 14.2,
      characters: 42,
    })
  })

  afterEach(() => {
    removeSpeechSynthesis()
  })

  // renders the harness so that rerender(props) changes what the page is passing in
  function render(props = {}) {
    return renderHook((current) => useHarness(current), {
      initialProps: { question: QUESTION, ...props },
    })
  }

  // walks the hook up to "it is the candidate's turn"
  async function renderReady(props = {}) {
    const harness = render(props)
    await waitFor(() => expect(harness.result.current.voice.phase).toBe(PHASE.INTERVIEWER_SPEAKING))
    act(() => {
      speech.finishSpeaking()
    })
    await waitFor(() => expect(harness.result.current.voice.phase).toBe(PHASE.READY_FOR_ANSWER))
    return harness
  }

  // takes a ready harness through recording an answer
  async function recordAnswer(harness) {
    await act(async () => {
      await harness.result.current.voice.startAnswer()
    })
    await waitFor(() => expect(harness.result.current.voice.phase).toBe(PHASE.CANDIDATE_SPEAKING))
    act(() => {
      harness.result.current.voice.stopAnswer()
    })
    await waitFor(() => expect(harness.result.current.voice.phase).toBe(PHASE.REVIEWING_TRANSCRIPT))
  }

  describe('the turn-taking', () => {
    it('reads the question out, then gives the candidate the turn', async () => {
      const harness = await renderReady()

      expect(speech.spoken).toEqual([QUESTION.question_text])
      expect(harness.result.current.voice.message).toMatch(/your turn/i)
    })

    it('reads each question once, however often it re-renders', async () => {
      const harness = await renderReady()

      harness.rerender()
      harness.rerender()

      expect(speech.spoken).toEqual([QUESTION.question_text])
    })

    it('reads the next question when it arrives', async () => {
      const harness = await renderReady()

      const next = { ...QUESTION, id: 8, question_text: 'How did you measure the improvement?' }
      await act(async () => {
        harness.rerender({ question: next })
      })

      // the new question is read out, and only the new one
      await waitFor(() => expect(speech.spoken).toEqual([QUESTION.question_text, next.question_text]))
      expect(harness.result.current.voice.phase).toBe(PHASE.INTERVIEWER_SPEAKING)
      expect(harness.result.current.voice.transcript).toBe('')
    })

    it('records, transcribes and shows the transcript to be checked', async () => {
      const harness = await renderReady()
      await recordAnswer(harness)

      expect(transcribeAnswer).toHaveBeenCalledTimes(1)
      const sent = transcribeAnswer.mock.calls[0][0]
      expect(sent.interviewId).toBe(1)
      expect(sent.blob.size).toBe(4096)

      expect(harness.result.current.voice.transcript).toBe('I profiled the endpoint and added an index.')
      expect(harness.result.current.voice.message).toMatch(/check your answer/i)
    })

    it('stops the interviewer talking if the candidate answers early', async () => {
      const harness = render()
      await waitFor(() => expect(harness.result.current.voice.phase).toBe(PHASE.INTERVIEWER_SPEAKING))

      await act(async () => {
        await harness.result.current.voice.startAnswer()
      })

      // the question is cancelled rather than being recorded through the speakers
      expect(speech.synth.cancel).toHaveBeenCalled()
      expect(harness.result.current.voice.phase).toBe(PHASE.CANDIDATE_SPEAKING)
    })

    it('lets the candidate hear the question again', async () => {
      const harness = await renderReady()

      act(() => {
        harness.result.current.voice.replayQuestion()
      })

      expect(speech.spoken).toEqual([QUESTION.question_text, QUESTION.question_text])
      expect(harness.result.current.voice.phase).toBe(PHASE.INTERVIEWER_SPEAKING)
    })

    it('will not replay the question over a live recording', async () => {
      const harness = await renderReady()
      await act(async () => {
        await harness.result.current.voice.startAnswer()
      })

      act(() => {
        harness.result.current.voice.replayQuestion()
      })

      expect(speech.spoken).toEqual([QUESTION.question_text])
      expect(harness.result.current.voice.phase).toBe(PHASE.CANDIDATE_SPEAKING)
    })

    it('never opens two recordings at once', async () => {
      const harness = await renderReady()

      await act(async () => {
        await Promise.all([
          harness.result.current.voice.startAnswer(),
          harness.result.current.voice.startAnswer(),
        ])
      })

      expect(microphone.getUserMedia).toHaveBeenCalledTimes(1)
    })

    it('lets the candidate throw the answer away and start again', async () => {
      const harness = await renderReady()
      await recordAnswer(harness)

      act(() => {
        harness.result.current.voice.discardAnswer()
      })

      expect(harness.result.current.voice.transcript).toBe('')
      expect(harness.result.current.voice.phase).toBe(PHASE.READY_FOR_ANSWER)
    })
  })

  describe('submitting', () => {
    it('submits the transcript, marked as spoken', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const harness = await renderReady({ onSubmit })
      await recordAnswer(harness)

      await act(async () => {
        await harness.result.current.voice.submit()
      })

      expect(onSubmit).toHaveBeenCalledTimes(1)
      const [text, meta] = onSubmit.mock.calls[0]
      expect(text).toBe('I profiled the endpoint and added an index.')
      expect(meta.source).toBe('SPOKEN')
      expect(meta.audioSeconds).toBeGreaterThanOrEqual(0)
      expect(meta.transcriptEdited).toBe(false)
    })

    it('submits the corrected transcript, and says it was corrected', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const harness = await renderReady({ onSubmit })
      await recordAnswer(harness)

      act(() => {
        harness.result.current.voice.editTranscript('I profiled the endpoint and added a PostgreSQL index.')
      })
      await act(async () => {
        await harness.result.current.voice.submit()
      })

      const [text, meta] = onSubmit.mock.calls[0]
      expect(text).toBe('I profiled the endpoint and added a PostgreSQL index.')
      expect(meta.transcriptEdited).toBe(true)
    })

    it('submits an answer only once, however many times the button is pressed', async () => {
      let release
      const onSubmit = vi.fn(() => new Promise((resolve) => {
        release = resolve
      }))
      const harness = await renderReady({ onSubmit })
      await recordAnswer(harness)

      await act(async () => {
        harness.result.current.voice.submit()
        harness.result.current.voice.submit()
        harness.result.current.voice.submit()
      })

      expect(onSubmit).toHaveBeenCalledTimes(1)
      await act(async () => {
        release()
      })
    })

    it('refuses to submit silence', async () => {
      const onSubmit = vi.fn()
      const harness = await renderReady({ onSubmit })

      await act(async () => {
        await harness.result.current.voice.submit()
      })

      expect(onSubmit).not.toHaveBeenCalled()
      expect(harness.result.current.voice.error).toMatch(/nothing to submit/i)
    })

    it('keeps the transcript on screen when submitting fails', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error('Network unreachable'))
      const harness = await renderReady({ onSubmit })
      await recordAnswer(harness)

      await act(async () => {
        await harness.result.current.voice.submit()
      })

      expect(harness.result.current.voice.error).toMatch(/network unreachable/i)
      expect(harness.result.current.voice.transcript).toBe('I profiled the endpoint and added an index.')
      expect(harness.result.current.voice.phase).toBe(PHASE.REVIEWING_TRANSCRIPT)
    })

    it('submits on its own when auto-submit is turned on', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined)
      const harness = await renderReady({ onSubmit, autoSubmit: true })

      await act(async () => {
        await harness.result.current.voice.startAnswer()
      })
      await act(async () => {
        harness.result.current.voice.stopAnswer()
      })

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    })
  })

  describe('when things go wrong', () => {
    it('offers a retry when transcription fails, without re-recording', async () => {
      transcribeAnswer.mockRejectedValueOnce(new Error('The transcription service timed out.'))
      const harness = await renderReady()
      await recordAnswer(harness)

      expect(harness.result.current.voice.error).toMatch(/timed out/i)
      expect(harness.result.current.voice.canRetryTranscription).toBe(true)
      expect(harness.result.current.voice.transcript).toBe('')

      // the recording never left the browser, so retrying costs no re-recording
      await act(async () => {
        harness.result.current.voice.retryTranscription()
      })

      await waitFor(() =>
        expect(harness.result.current.voice.transcript).toBe('I profiled the endpoint and added an index.'),
      )
      expect(transcribeAnswer).toHaveBeenCalledTimes(2)
      expect(microphone.getUserMedia).toHaveBeenCalledTimes(1)
    })

    it('rejects an empty recording without paying to transcribe it', async () => {
      const harness = await renderReady()
      await act(async () => {
        await harness.result.current.voice.startAnswer()
      })

      // a microphone that opened but captured nothing
      await act(async () => {
        FakeMediaRecorder.instances.at(-1).stop({ bytes: 10 })
      })

      expect(transcribeAnswer).not.toHaveBeenCalled()
      expect(harness.result.current.voice.error).toMatch(/empty/i)
      expect(harness.result.current.voice.phase).toBe(PHASE.READY_FOR_ANSWER)
    })

    it('reports a blocked microphone and stays on the candidate\'s turn', async () => {
      installMicrophone({ fail: 'NotAllowedError' })
      const harness = await renderReady()

      await act(async () => {
        await harness.result.current.voice.startAnswer()
      })

      expect(harness.result.current.voice.error).toMatch(/blocked/i)
      expect(transcribeAnswer).not.toHaveBeenCalled()
    })
  })

  describe('the phases the page drives', () => {
    it('reports the first question being written', async () => {
      const harness = render({ question: null, stage: STAGE.WRITING_FIRST_QUESTION })
      expect(harness.result.current.voice.phase).toBe(PHASE.GENERATING_QUESTION)
      expect(harness.result.current.voice.message).toMatch(/first question/i)
    })

    it('reports a follow-up being written', async () => {
      const harness = render({ question: null, stage: STAGE.WRITING_NEXT_QUESTION })
      expect(harness.result.current.voice.phase).toBe(PHASE.GENERATING_FOLLOWUP)
      expect(harness.result.current.voice.message).toMatch(/next question/i)
    })

    it('reports an answer being graded', async () => {
      const harness = render({ stage: STAGE.EVALUATING })
      expect(harness.result.current.voice.phase).toBe(PHASE.SUBMITTING_ANSWER)
      expect(harness.result.current.voice.message).toMatch(/evaluating/i)
    })

    it('says nothing at all once the interview is over', async () => {
      const harness = render({ stage: STAGE.COMPLETED })

      expect(harness.result.current.voice.phase).toBe(PHASE.COMPLETED)
      // the question is never read out after the interview has finished
      expect(speech.spoken).toEqual([])
    })

    it('stops speaking and listening when the interview finishes mid-answer', async () => {
      const harness = await renderReady()
      await act(async () => {
        await harness.result.current.voice.startAnswer()
      })
      expect(harness.result.current.voice.phase).toBe(PHASE.CANDIDATE_SPEAKING)

      // "End interview" while the microphone is open
      await act(async () => {
        harness.rerender({ question: QUESTION, stage: STAGE.COMPLETED })
      })

      expect(harness.result.current.voice.phase).toBe(PHASE.COMPLETED)
      expect(microphone.track.stop).toHaveBeenCalled()
      expect(speech.synth.cancel).toHaveBeenCalled()
    })
  })

  describe('text mode', () => {
    it('says nothing and opens no microphone when voice is switched off', async () => {
      const harness = render({ enabled: false })

      expect(speech.spoken).toEqual([])
      expect(harness.result.current.voice.phase).toBe(PHASE.IDLE)
      expect(microphone.getUserMedia).not.toHaveBeenCalled()
    })

    it('shuts the microphone and the voice up when switching to typing', async () => {
      const harness = await renderReady()
      await act(async () => {
        await harness.result.current.voice.startAnswer()
      })

      act(() => {
        harness.result.current.voice.cleanup()
      })

      expect(microphone.track.stop).toHaveBeenCalled()
      expect(speech.synth.cancel).toHaveBeenCalled()
    })
  })
})
