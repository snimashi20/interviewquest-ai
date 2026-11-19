// use the URL from the .env file, or fall back to localhost for local dev
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8002/api'

// small helper so every function below doesn't repeat the same fetch boilerplate.
// `body` is sent as JSON; for a file upload use requestUpload() instead, because the
// browser has to set the multipart Content-Type itself (it includes a random boundary)
async function request(path, options = {}) {
  const { body, ...rest } = options

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    // only send a JSON content type when there is actually a JSON body
    headers: body === undefined ? rest.headers : { 'Content-Type': 'application/json', ...rest.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  // if the backend returned an error status, turn it into a JS Error we can catch later
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const message = errorBody?.detail || `Request failed with status ${response.status}`
    throw new Error(message)
  }

  return response.status === 204 ? null : response.json()
}

// same as request() but for a FormData body (the CV file), with no Content-Type header set
async function requestUpload(path, formData) {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', body: formData })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const message = errorBody?.detail || `Upload failed with status ${response.status}`
    throw new Error(message)
  }

  return response.json()
}

// ---------- interviews ----------

// calls POST /api/interviews - starts a new interview.
// cvId is optional: pass it to get questions written from the student's own CV.
// interviewType is 'TEXT' (type the answers) or 'VOICE' (spoken, read aloud and transcribed).
// questionFlow is left to the backend by default: a voice interview gets 'ADAPTIVE' (one
// question at a time, following up on the last answer), a text one gets 'BATCH'
export function createInterview({
  role,
  difficulty,
  cvId = null,
  questionCount = 5,
  interviewType = 'TEXT',
  questionFlow = null,
}) {
  return request('/interviews', {
    method: 'POST',
    body: {
      role,
      difficulty,
      cv_id: cvId,
      question_count: questionCount,
      interview_type: interviewType,
      ...(questionFlow ? { question_flow: questionFlow } : {}),
    },
  })
}

// ---------- practice ----------

// calls the same POST /api/interviews, but in PRACTICE mode: one subject instead of a role,
// a model answer written alongside every question, and optionally coding tasks.
// questionStyle is 'THEORY', 'CODING' or 'MIXED'.
export function createPracticeSet({
  role,
  difficulty,
  topic,
  focus = null,
  questionStyle = 'THEORY',
  questionCount = 5,
}) {
  return request('/interviews', {
    method: 'POST',
    body: {
      role,
      difficulty,
      mode: 'PRACTICE',
      practice_topic: topic,
      practice_focus: focus,
      question_style: questionStyle,
      question_count: questionCount,
    },
  })
}

// calls GET /api/interviews - gets the list for the History page
export function listInterviews() {
  return request('/interviews')
}

// calls GET /api/interviews/{id} - gets one interview with all its questions and answers
export function getInterview(interviewId) {
  return request(`/interviews/${interviewId}`)
}

// calls POST /api/interviews/{id}/questions/{id}/answers - submits the student's answer.
// the third argument is the text; the fourth is optional and only used by voice answers:
//   source           'TYPED' (default) or 'SPOKEN'
//   audioSeconds     how long the recording ran
//   transcriptEdited whether the candidate corrected the transcript before submitting
export function submitAnswer(interviewId, questionId, answerText, meta = {}) {
  const { source = 'TYPED', audioSeconds = null, transcriptEdited = false } = meta
  return request(`/interviews/${interviewId}/questions/${questionId}/answers`, {
    method: 'POST',
    body: {
      answer_text: answerText,
      source,
      audio_seconds: audioSeconds,
      transcript_edited: transcriptEdited,
    },
  })
}


// calls POST /api/interviews/{id}/next-question - asks an adaptive interview for its next
// question, once the previous answer has been graded.
// safe to call twice: the backend hands back the job already running rather than starting
// a second one. the reply is { job_id, question_ready } - when question_ready is true there
// is already a question waiting and nothing had to be generated
export function requestNextQuestion(interviewId) {
  return request(`/interviews/${interviewId}/next-question`, { method: 'POST' })
}


// calls POST /api/interviews/{id}/end - the candidate pressed "End Interview".
// whatever has been graded so far still counts; nothing is invented for the rest
export function endInterview(interviewId) {
  return request(`/interviews/${interviewId}/end`, { method: 'POST' })
}


// calls GET /api/interviews/{id}/usage - the optional "what did this interview cost"
// summary. an estimate from the server's configured rates, not a bill
export function getInterviewUsage(interviewId) {
  return request(`/interviews/${interviewId}/usage`)
}

// ---------- voice ----------

// calls GET /api/voice/limits - the formats and size/length caps the backend will accept.
// the recorder reads these rather than hard-coding limits that could drift out of step
export function getVoiceLimits() {
  return request('/voice/limits')
}


// calls POST /api/voice/transcribe - sends one recording and gets the text back.
//
// the audio goes to our own backend, which holds the OpenAI key - the browser never sees it.
// the transcript comes back for the candidate to read and correct; it only becomes an answer
// when submitAnswer() is called with it.
export async function transcribeAnswer({ blob, mimeType, durationSeconds, interviewId = null }) {
  const formData = new FormData()
  // the extension only has to match the container; the backend reads the content type too
  const extension = (mimeType || 'audio/webm').includes('mp4') ? 'mp4' : 'webm'
  formData.append('file', blob, `answer.${extension}`)
  if (durationSeconds != null) formData.append('duration_seconds', String(durationSeconds))
  if (interviewId != null) formData.append('interview_id', String(interviewId))

  // a transcription that never comes back would leave the interview stuck on "Transcribing",
  // so give up after a minute and a half and let the candidate retry
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90000)

  try {
    const response = await fetch(`${API_BASE_URL}/voice/transcribe`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null)
      throw new Error(errorBody?.detail || `Transcription failed with status ${response.status}`)
    }

    return response.json()
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Transcription took too long. Your recording was kept - please try again.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

// ---------- jobs ----------

// calls GET /api/jobs/{id} - used to check if a background task has finished yet
export function getJob(jobId) {
  return request(`/jobs/${jobId}`)
}

// ---------- CVs and the study checklist ----------

// calls POST /api/cvs - uploads the CV file itself
export function uploadCV(file) {
  const formData = new FormData()
  formData.append('file', file)
  return requestUpload('/cvs', formData)
}

// calls GET /api/cvs - every CV uploaded so far (newest first)
export function listCVs() {
  return request('/cvs')
}

// calls GET /api/cvs/{id} - one CV with its study topics grouped into categories
export function getCV(cvId) {
  return request(`/cvs/${cvId}`)
}

// calls PATCH /api/cvs/topics/{id} - ticks or unticks one topic on the checklist
export function setTopicCompleted(topicId, completed) {
  return request(`/cvs/topics/${topicId}`, { method: 'PATCH', body: { completed } })
}
