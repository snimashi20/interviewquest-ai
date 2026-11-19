import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeMediaRecorder,
  installMicrophone,
  removeMicrophone,
} from '../test/browserMocks'
import {
  RECORDER_STATUS,
  STOP_REASON,
  isRecordingSupported,
  pickMimeType,
  useAudioRecorder,
} from './useAudioRecorder'

describe('useAudioRecorder', () => {
  afterEach(() => {
    vi.useRealTimers()
    FakeMediaRecorder.supportedTypes = ['audio/webm;codecs=opus', 'audio/webm']
  })

  describe('starting and stopping', () => {
    let microphone

    beforeEach(() => {
      microphone = installMicrophone()
    })

    it('opens the microphone and starts recording', async () => {
      const { result } = renderHook(() => useAudioRecorder({}))
      expect(result.current.status).toBe(RECORDER_STATUS.IDLE)

      await act(async () => {
        await result.current.start()
      })

      expect(microphone.getUserMedia).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe(RECORDER_STATUS.RECORDING)
      expect(result.current.recording).toBe(true)
      expect(microphone.recorders).toHaveLength(1)
    })

    it('asks for echo cancellation, so the interviewer is not recorded', async () => {
      const { result } = renderHook(() => useAudioRecorder({}))
      await act(async () => {
        await result.current.start()
      })

      const constraints = microphone.getUserMedia.mock.calls[0][0]
      expect(constraints.audio.echoCancellation).toBe(true)
      expect(constraints.audio.noiseSuppression).toBe(true)
    })

    it('hands the recording over when it stops', async () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() => useAudioRecorder({ onComplete }))

      await act(async () => {
        await result.current.start()
      })
      act(() => {
        result.current.stop()
      })

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
      const recording = onComplete.mock.calls[0][0]
      expect(recording.blob.size).toBe(4096)
      expect(recording.mimeType).toContain('audio/webm')
      expect(recording.reason).toBe(STOP_REASON.MANUAL)
      expect(result.current.status).toBe(RECORDER_STATUS.IDLE)
    })

    it('releases the microphone once the recording is over', async () => {
      const { result } = renderHook(() => useAudioRecorder({}))

      await act(async () => {
        await result.current.start()
      })
      expect(microphone.track.stop).not.toHaveBeenCalled()

      act(() => {
        result.current.stop()
      })

      // the browser keeps its recording indicator on until every track is stopped
      await waitFor(() => expect(microphone.track.stop).toHaveBeenCalled())
    })

    it('never starts a second recording over the top of the first', async () => {
      const { result } = renderHook(() => useAudioRecorder({}))

      await act(async () => {
        await Promise.all([result.current.start(), result.current.start()])
      })
      await act(async () => {
        await result.current.start()
      })

      expect(microphone.getUserMedia).toHaveBeenCalledTimes(1)
      expect(microphone.recorders).toHaveLength(1)
    })

    it('throws the recording away when it is cancelled', async () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() => useAudioRecorder({ onComplete }))

      await act(async () => {
        await result.current.start()
      })
      act(() => {
        result.current.cancel()
      })

      expect(onComplete).not.toHaveBeenCalled()
      expect(microphone.track.stop).toHaveBeenCalled()
      expect(result.current.status).toBe(RECORDER_STATUS.IDLE)
    })

    it('releases the microphone when the component goes away mid-recording', async () => {
      const { result, unmount } = renderHook(() => useAudioRecorder({}))

      await act(async () => {
        await result.current.start()
      })
      unmount()

      // this is what stops a recording continuing after the candidate navigates away
      expect(microphone.track.stop).toHaveBeenCalled()
    })

    it('stops itself at the maximum answer length', async () => {
      const onComplete = vi.fn()
      vi.useFakeTimers()
      const { result } = renderHook(() => useAudioRecorder({ maxSeconds: 5, onComplete }))

      await act(async () => {
        await result.current.start()
      })
      await act(async () => {
        vi.advanceTimersByTime(6000)
      })

      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(onComplete.mock.calls[0][0].reason).toBe(STOP_REASON.LIMIT)
    })
  })

  describe('when the microphone is not available', () => {
    it('explains a denied permission and offers the way out', async () => {
      installMicrophone({ fail: 'NotAllowedError' })
      const onError = vi.fn()
      const { result } = renderHook(() => useAudioRecorder({ onError }))

      let started
      await act(async () => {
        started = await result.current.start()
      })

      expect(started).toBe(false)
      expect(result.current.status).toBe(RECORDER_STATUS.ERROR)
      expect(result.current.error).toMatch(/blocked/i)
      expect(result.current.error).toMatch(/typing/i)
      expect(onError).toHaveBeenCalledWith(result.current.error)
    })

    it('explains a missing microphone', async () => {
      installMicrophone({ fail: 'NotFoundError' })
      const { result } = renderHook(() => useAudioRecorder({}))

      await act(async () => {
        await result.current.start()
      })

      expect(result.current.error).toMatch(/no microphone was found/i)
    })

    it('explains a microphone another app is holding', async () => {
      installMicrophone({ fail: 'NotReadableError' })
      const { result } = renderHook(() => useAudioRecorder({}))

      await act(async () => {
        await result.current.start()
      })

      expect(result.current.error).toMatch(/in use by another app/i)
    })

    it('says so when the browser cannot record at all', async () => {
      removeMicrophone()
      const { result } = renderHook(() => useAudioRecorder({}))

      let started
      await act(async () => {
        started = await result.current.start()
      })

      expect(started).toBe(false)
      expect(result.current.supported).toBe(false)
      expect(result.current.error).toMatch(/cannot record audio/i)
    })

    it('lets the candidate clear the error and try again', async () => {
      installMicrophone({ fail: 'NotAllowedError' })
      const { result } = renderHook(() => useAudioRecorder({}))

      await act(async () => {
        await result.current.start()
      })
      act(() => {
        result.current.clearError()
      })

      expect(result.current.error).toBeNull()
      expect(result.current.status).toBe(RECORDER_STATUS.IDLE)
    })
  })

  describe('picking a recording format at runtime', () => {
    beforeEach(() => {
      installMicrophone()
    })

    it('prefers webm/opus where the browser has it', () => {
      expect(pickMimeType()).toBe('audio/webm;codecs=opus')
    })

    it('falls back to whatever this browser does support', () => {
      // a Safari-shaped browser: no webm at all
      FakeMediaRecorder.supportedTypes = ['audio/mp4']
      expect(pickMimeType()).toBe('audio/mp4')
    })

    it('lets the browser choose when it supports none of our candidates', () => {
      FakeMediaRecorder.supportedTypes = []
      expect(pickMimeType()).toBe('')
    })

    it('counts a secure context as recordable', () => {
      expect(isRecordingSupported()).toBe(true)
    })
  })
})
