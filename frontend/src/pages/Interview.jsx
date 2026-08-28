import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import AnswerInput from '../components/AnswerInput'
import InterviewLoader from '../components/InterviewLoader'
import QuestionCard from '../components/QuestionCard'
import { useJobPolling } from '../hooks/useJobPolling'
import { getInterview, submitAnswer } from '../services/api'

export default function Interview() {
  const { interviewId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const [interview, setInterview] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [answerJobId, setAnswerJobId] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const questionJobId = location.state?.jobId ?? null
  const { job: questionJob, error: questionJobError } = useJobPolling(questionJobId)
  const { job: evaluationJob, error: evaluationJobError } = useJobPolling(answerJobId)

  const refetchInterview = useCallback(async () => {
    try {
      const data = await getInterview(interviewId)
      setInterview(data)
    } catch (err) {
      setLoadError(err.message)
    }
  }, [interviewId])

  useEffect(() => {
    if (!questionJobId || questionJob?.status === 'COMPLETED') {
      refetchInterview()
    }
  }, [questionJobId, questionJob?.status, refetchInterview])

  useEffect(() => {
    if (evaluationJob?.status === 'COMPLETED') {
      navigate(`/results/${interviewId}`)
    }
  }, [evaluationJob?.status, interviewId, navigate])

  useEffect(() => {
    if (interview?.questions?.[0]?.answer) {
      navigate(`/results/${interviewId}`, { replace: true })
    }
  }, [interview, interviewId, navigate])

  const handleAnswerSubmit = async (answerText) => {
    const question = interview.questions[0]
    setSubmitting(true)
    try {
      const job = await submitAnswer(interviewId, question.id, answerText)
      setAnswerJobId(job.id)
    } catch (err) {
      setLoadError(err.message)
      setSubmitting(false)
    }
  }

  if (questionJobId && (!questionJob || ['PENDING', 'IN_PROGRESS'].includes(questionJob.status))) {
    return (
      <div className="page">
        <InterviewLoader label="Generating your question…" error={questionJobError} />
      </div>
    )
  }

  if (questionJob?.status === 'FAILED') {
    return (
      <div className="page">
        <InterviewLoader error={questionJob.error || 'Question generation failed.'} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page">
        <InterviewLoader error={loadError} />
      </div>
    )
  }

  if (!interview) {
    return (
      <div className="page">
        <InterviewLoader label="Loading interview…" />
      </div>
    )
  }

  const question = interview.questions[0]

  if (!question) {
    return (
      <div className="page">
        <InterviewLoader label="Waiting for your question…" />
      </div>
    )
  }

  if (answerJobId) {
    return (
      <div className="page">
        <QuestionCard question={question} />
        <InterviewLoader
          label="Evaluating your answer…"
          error={evaluationJobError || (evaluationJob?.status === 'FAILED' ? evaluationJob.error : null)}
        />
      </div>
    )
  }

  return (
    <div className="page">
      <QuestionCard question={question} />
      <AnswerInput onSubmit={handleAnswerSubmit} submitting={submitting} />
    </div>
  )
}
