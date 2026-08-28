const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8002/api'

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = body?.detail || `Request failed with status ${response.status}`
    throw new Error(message)
  }

  return response.status === 204 ? null : response.json()
}

export function createInterview(role, difficulty) {
  return request('/interviews', {
    method: 'POST',
    body: JSON.stringify({ role, difficulty }),
  })
}

export function listInterviews() {
  return request('/interviews')
}

export function getInterview(interviewId) {
  return request(`/interviews/${interviewId}`)
}

export function submitAnswer(interviewId, questionId, answerText) {
  return request(`/interviews/${interviewId}/questions/${questionId}/answers`, {
    method: 'POST',
    body: JSON.stringify({ answer_text: answerText }),
  })
}

export function getJob(jobId) {
  return request(`/jobs/${jobId}`)
}
