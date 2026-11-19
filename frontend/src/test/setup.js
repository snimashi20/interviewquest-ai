import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// unmount anything a test rendered. this matters more than usual here: the voice hooks
// release the microphone and cancel speech on unmount, and those paths are under test
afterEach(() => {
  cleanup()
})

// jsdom has no requestAnimationFrame worth the name, and the level meter runs on it
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 16)
  globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle)
}
