import { useCallback, useEffect, useRef, useState } from 'react'

// how long a program is allowed to run before we pull the plug on it
const TIMEOUT_MS = 15000

// the languages the workspace can actually execute, and what each one's file is called
export const RUNTIMES = {
  python: { label: 'Python', filename: 'main.py', comment: '#' },
  javascript: { label: 'JavaScript', filename: 'main.js', comment: '//' },
}

export const DEFAULT_LANGUAGE = 'python'

// builds the right worker for a language. the `new URL(..., import.meta.url)` form is what
// lets Vite find the worker file and bundle it for production
function createWorker(language) {
  if (language === 'javascript') {
    return new Worker(new URL('../workers/jsRunner.js', import.meta.url))
  }
  return new Worker(new URL('../workers/pythonRunner.js', import.meta.url))
}

// runs code in a throwaway Web Worker and collects whatever it prints.
//
// everything happens in the browser: nothing is uploaded, and because the worker is a
// separate thread we can terminate an infinite loop instead of freezing the tab.
export default function useCodeRunner() {
  const [output, setOutput] = useState([]) // [{ stream: 'stdout' | 'stderr' | 'meta', text }]
  const [running, setRunning] = useState(false)
  const workerRef = useRef(null)
  const timeoutRef = useRef(null)

  // kill the worker and clear the timer - used on stop, on timeout and on unmount
  const teardown = useCallback(() => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  // make sure a running program doesn't outlive the page
  useEffect(() => teardown, [teardown])

  const append = useCallback((stream, text) => {
    setOutput((current) => [...current, { stream, text }])
  }, [])

  const clearOutput = useCallback(() => setOutput([]), [])

  const run = useCallback(
    (code, language) => {
      teardown() // a second Run replaces the first rather than racing it
      setOutput([])
      setRunning(true)

      let worker
      try {
        worker = createWorker(language)
      } catch (error) {
        // workers are blocked in a handful of environments (strict CSP, some embedded views)
        append('stderr', `Could not start the ${language} runtime: ${error.message}`)
        setRunning(false)
        return
      }
      workerRef.current = worker

      const finish = () => {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
        setRunning(false)
      }

      worker.onmessage = (event) => {
        const { type, text } = event.data
        if (type === 'stdout' || type === 'stderr') {
          append(type, text)
        } else if (type === 'status') {
          append('meta', text)
        } else if (type === 'done') {
          finish()
        } else if (type === 'error') {
          append('stderr', text)
          finish()
        }
        // 'started' just means the runtime is up; nothing to show for it
      }

      // a worker that fails to load (offline, CDN blocked) lands here
      worker.onerror = (event) => {
        append('stderr', event.message || 'The runtime failed to start. Are you offline?')
        finish()
      }

      worker.postMessage({ code })

      timeoutRef.current = setTimeout(() => {
        append('stderr', `Stopped after ${TIMEOUT_MS / 1000}s - is there an infinite loop?`)
        finish()
      }, TIMEOUT_MS)
    },
    [append, teardown],
  )

  // the Stop button
  const stop = useCallback(() => {
    if (!workerRef.current) return
    teardown()
    setRunning(false)
    append('meta', 'Stopped.')
  }, [append, teardown])

  return { output, running, run, stop, clearOutput }
}
