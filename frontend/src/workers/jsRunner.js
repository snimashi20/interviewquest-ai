/* eslint-env worker */
// Runs the student's JavaScript inside a Web Worker.
//
// A worker is its own global scope with no DOM, no document and no access to the page, and
// it can be terminated from outside - which is how an infinite loop gets stopped. The code
// never leaves the browser.

function post(type, text) {
  self.postMessage({ type, text })
}

// turn the arguments of a console call into one printable line, the way a terminal would
function format(args) {
  return args
    .map((value) => {
      if (typeof value === 'string') return value
      try {
        return JSON.stringify(value, null, 2) ?? String(value)
      } catch {
        // circular objects and the like
        return String(value)
      }
    })
    .join(' ')
}

self.onmessage = (event) => {
  const { code } = event.data

  // point console at the output pane. everything the student logs shows up there
  self.console = {
    log: (...args) => post('stdout', format(args)),
    info: (...args) => post('stdout', format(args)),
    debug: (...args) => post('stdout', format(args)),
    warn: (...args) => post('stderr', format(args)),
    error: (...args) => post('stderr', format(args)),
  }

  post('started', null)
  try {
    // new Function keeps the student's code out of this file's scope, so it cannot reach
    // the helpers above. it is compiled as its own function body.
    const run = new Function(code)
    const result = run()
    // support a top-level `await` style script that returns a promise
    Promise.resolve(result)
      .then(() => post('done', null))
      .catch((error) => post('error', String(error?.stack || error)))
  } catch (error) {
    // syntax errors land here, before anything ran
    post('error', String(error?.stack || error))
  }
}
