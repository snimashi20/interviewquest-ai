import { useEffect, useState } from 'react'
import { getJob } from '../services/api'

const POLL_INTERVAL_MS = 1500

/**
 * Polls a job until it reaches COMPLETED/FAILED, since job creation is
 * fire-and-forget on the backend (FastAPI BackgroundTasks).
 */
export function useJobPolling(jobId) {
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!jobId) return undefined

    let cancelled = false
    let timeoutId

    const poll = async () => {
      try {
        const result = await getJob(jobId)
        if (cancelled) return
        setJob(result)
        if (result.status === 'PENDING' || result.status === 'IN_PROGRESS') {
          timeoutId = setTimeout(poll, POLL_INTERVAL_MS)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    }

    poll()

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [jobId])

  return { job, error }
}
