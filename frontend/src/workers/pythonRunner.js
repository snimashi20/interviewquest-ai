/* eslint-env worker */
// Runs the student's Python in a Web Worker using Pyodide (CPython compiled to WebAssembly).
//
// Why a worker: the code is theirs, so it can easily contain an infinite loop. On the main
// thread that would freeze the whole tab with no way out; in a worker the page stays alive
// and useCodeRunner can just terminate it.
//
// Nothing is sent to our backend - the code never leaves the browser, and the WebAssembly
// sandbox has no file system, no network and no access to the page.

// pinned on purpose: "latest" would silently change the runtime under the student
const PYODIDE_VERSION = 'v0.28.0'
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`

let pyodidePromise = null

// downloads and starts the Python runtime the first time Run is pressed, then reuses it.
// it is a ~10MB download, hence the status message while it happens
function getPyodide() {
  if (!pyodidePromise) {
    post('status', 'Starting Python (first run downloads the runtime)…')
    pyodidePromise = (async () => {
      // classic worker, so the CDN script is pulled in with importScripts
      self.importScripts(`${PYODIDE_URL}pyodide.js`)
      const pyodide = await self.loadPyodide({ indexURL: PYODIDE_URL })
      // send anything the program prints straight back to the output pane
      pyodide.setStdout({ batched: (text) => post('stdout', text) })
      pyodide.setStderr({ batched: (text) => post('stderr', text) })
      return pyodide
    })().catch((error) => {
      // let the next Run try again from scratch rather than reusing a failed load
      pyodidePromise = null
      throw error
    })
  }
  return pyodidePromise
}

function post(type, text) {
  self.postMessage({ type, text })
}

self.onmessage = async (event) => {
  const { code } = event.data
  try {
    const pyodide = await getPyodide()
    post('started', null)
    await pyodide.runPythonAsync(code)
    post('done', null)
  } catch (error) {
    // a Python exception arrives here with its traceback already in the message
    post('error', String(error?.message || error))
  }
}
