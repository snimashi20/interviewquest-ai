import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInterview,
  endInterview,
  getVoiceLimits,
  requestNextQuestion,
  submitAnswer,
  transcribeAnswer,
} from './api'

// what the browser actually sends. fetch is stubbed, so no test here reaches a backend.
describe('the API service', () => {
  let fetchMock

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function respondWith(body, { ok = true, status = 200 } = {}) {
    fetchMock.mockResolvedValue({ ok, status, json: async () => body })
  }

  // the body of the last JSON request
  function sentBody() {
    return JSON.parse(fetchMock.mock.calls[0][1].body)
  }

  describe('starting an interview', () => {
    it('sends the interview type, and lets the backend choose the flow', async () => {
      respondWith({ interview_id: 1, job_id: 'job-1' })

      await createInterview({
        role: 'Backend Developer',
        difficulty: 'Intermediate',
        questionCount: 10,
        interviewType: 'VOICE',
      })

      const body = sentBody()
      expect(body.interview_type).toBe('VOICE')
      expect(body.question_count).toBe(10)
      // not sent at all, so the backend applies its own default per interview type
      expect('question_flow' in body).toBe(false)
    })

    it('sends an explicit flow when one is asked for', async () => {
      respondWith({ interview_id: 1, job_id: 'job-1' })

      await createInterview({
        role: 'Backend Developer',
        difficulty: 'Beginner',
        interviewType: 'VOICE',
        questionFlow: 'BATCH',
      })

      expect(sentBody().question_flow).toBe('BATCH')
    })

    it('still defaults to a text interview', async () => {
      respondWith({ interview_id: 1, job_id: 'job-1' })

      await createInterview({ role: 'Frontend Developer', difficulty: 'Beginner' })

      expect(sentBody().interview_type).toBe('TEXT')
    })
  })

  describe('submitting an answer', () => {
    it('marks a typed answer as typed, with no audio', async () => {
      respondWith({ id: 'job-2', status: 'PENDING' })

      await submitAnswer(3, 9, 'My typed answer.')

      const body = sentBody()
      expect(body.answer_text).toBe('My typed answer.')
      expect(body.source).toBe('TYPED')
      expect(body.audio_seconds).toBeNull()
      expect(body.transcript_edited).toBe(false)
    })

    it('carries the recording details on a spoken answer', async () => {
      respondWith({ id: 'job-2', status: 'PENDING' })

      await submitAnswer(3, 9, 'My spoken answer.', {
        source: 'SPOKEN',
        audioSeconds: 31.4,
        transcriptEdited: true,
      })

      const body = sentBody()
      expect(body.source).toBe('SPOKEN')
      expect(body.audio_seconds).toBe(31.4)
      expect(body.transcript_edited).toBe(true)
    })

    it('turns a backend error into a readable message', async () => {
      respondWith({ detail: 'Answer already submitted for this question' }, { ok: false, status: 400 })

      await expect(submitAnswer(3, 9, 'Again.')).rejects.toThrow('Answer already submitted for this question')
    })
  })

  describe('the adaptive endpoints', () => {
    it('asks for the next question', async () => {
      respondWith({ job_id: 'job-3', question_ready: false })

      const result = await requestNextQuestion(12)

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toContain('/interviews/12/next-question')
      expect(options.method).toBe('POST')
      expect(result.job_id).toBe('job-3')
    })

    it('ends an interview', async () => {
      respondWith({ id: 12, status: 'COMPLETED', ended_early: true })

      const result = await endInterview(12)

      expect(fetchMock.mock.calls[0][0]).toContain('/interviews/12/end')
      expect(result.ended_early).toBe(true)
    })
  })

  describe('transcribing a recording', () => {
    const blob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' })

    it('uploads the recording as multipart form data', async () => {
      respondWith({ text: 'Transcribed words.', model: 'gpt-transcribe', characters: 18 })

      const result = await transcribeAnswer({
        blob,
        mimeType: 'audio/webm;codecs=opus',
        durationSeconds: 21.5,
        interviewId: 4,
      })

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toContain('/voice/transcribe')
      expect(options.method).toBe('POST')
      // FormData, so the browser sets the multipart boundary itself
      expect(options.body).toBeInstanceOf(FormData)
      expect(options.body.get('duration_seconds')).toBe('21.5')
      expect(options.body.get('interview_id')).toBe('4')
      expect(options.body.get('file')).toBeTruthy()
      expect(result.text).toBe('Transcribed words.')
    })

    it('names the file after the container the browser recorded', async () => {
      respondWith({ text: 'Words.', model: 'gpt-transcribe', characters: 6 })

      await transcribeAnswer({ blob, mimeType: 'audio/mp4', durationSeconds: 5 })

      expect(fetchMock.mock.calls[0][1].body.get('file').name).toBe('answer.mp4')
    })

    it('leaves out the interview when there is not one', async () => {
      respondWith({ text: 'Words.', model: 'gpt-transcribe', characters: 6 })

      await transcribeAnswer({ blob, mimeType: 'audio/webm', durationSeconds: 5 })

      expect(fetchMock.mock.calls[0][1].body.get('interview_id')).toBeNull()
    })

    it('passes the backend reason through, so the candidate knows what to do', async () => {
      respondWith(
        { detail: 'No speech was detected in that recording. Please check your microphone and try again.' },
        { ok: false, status: 400 },
      )

      await expect(transcribeAnswer({ blob, mimeType: 'audio/webm' })).rejects.toThrow(/no speech was detected/i)
    })

    it('gives up rather than hanging for ever, and says the recording was kept', async () => {
      // a fetch that never settles, aborted by the service's own timeout
      fetchMock.mockImplementation(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            })
          }),
      )
      vi.useFakeTimers()

      const pending = transcribeAnswer({ blob, mimeType: 'audio/webm' })
      vi.advanceTimersByTime(90001)

      await expect(pending).rejects.toThrow(/took too long(.*)recording was kept/i)
    })
  })

  describe('the voice limits', () => {
    it('reads the caps from the backend rather than hard-coding them', async () => {
      respondWith({
        supported_content_types: ['audio/webm'],
        max_audio_bytes: 10485760,
        max_audio_seconds: 180,
        transcription_model: 'gpt-transcribe',
        store_audio: false,
      })

      const limits = await getVoiceLimits()

      expect(fetchMock.mock.calls[0][0]).toContain('/voice/limits')
      expect(limits.max_audio_seconds).toBe(180)
      expect(limits.store_audio).toBe(false)
    })
  })
})
