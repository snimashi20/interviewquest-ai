import { useCallback, useEffect, useState } from 'react'

// where the ticked topics are kept. there is no login yet, so progress lives in the browser.
const STORAGE_KEY = 'interviewquest.fundamentals.done.v1'

// read the saved topic ids, ignoring anything corrupt or a private-mode localStorage that throws
function readSavedIds() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

// keeps the set of topics the user has already covered, and saves it on every change.
// ids are stored flat (not per role) so a topic ticked under one position stays ticked
// under the others - revising DSA once counts everywhere.
export default function useTopicProgress() {
  const [doneIds, setDoneIds] = useState(() => new Set(readSavedIds()))

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...doneIds]))
    } catch {
      // storage can be unavailable or full - progress just won't persist, the page still works
    }
  }, [doneIds])

  // tick or untick one topic
  const toggleTopic = useCallback((topicId) => {
    setDoneIds((current) => {
      const next = new Set(current)
      if (next.has(topicId)) {
        next.delete(topicId)
      } else {
        next.add(topicId)
      }
      return next
    })
  }, [])

  // untick a specific group of topics (used by the "clear" button on the page)
  const clearTopics = useCallback((topicIds) => {
    setDoneIds((current) => {
      const next = new Set(current)
      topicIds.forEach((id) => next.delete(id))
      return next
    })
  }, [])

  return { doneIds, toggleTopic, clearTopics }
}
