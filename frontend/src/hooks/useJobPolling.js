import { useEffect, useState } from 'react'
import { getJob } from '../services/api'

const POLL_INTERVAL_MS = 1500 // how often (in ms) we check the job again

// custom hook - keeps calling GET /api/jobs/{id} every 1.5s until the job is
// COMPLETED or FAILED, since the backend runs it in the background and can't
// just respond with the final result straight away
export function useJobPolling(jobId) {
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!jobId) return undefined // nothing to poll yet

    let cancelled = false // used to stop updating state after this component unmounts
    let timeoutId

    const poll = async () => {
      try {
        const result = await getJob(jobId)
        if (cancelled) return
        setJob(result)
        // still working? check again in a bit
        if (result.status === 'PENDING' || result.status === 'IN_PROGRESS') {
          timeoutId = setTimeout(poll, POLL_INTERVAL_MS)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    }

    poll() // kick off the first check immediately

    // cleanup function - runs when jobId changes or the component unmounts
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [jobId])

  return { job, error }
}
