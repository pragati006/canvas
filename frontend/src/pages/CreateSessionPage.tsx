import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PRODUCT_NAME } from '../brand'
import { buildTemplate, TEMPLATES, type TemplateId } from '../canvas/templates'
import { useInterviewService } from '../services/ServiceContext'
import { errorMessage } from '../services/errors'

export function CreateSessionPage() {
  const service = useInterviewService()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [duration, setDuration] = useState('')
  const [template, setTemplate] = useState<TemplateId>('blank')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    void service.getCurrentUser().then((user) => {
      if (!user) navigate('/login')
    })
  }, [navigate, service])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      service.setActorMode('user')
      const session = await service.createSession({
        title,
        prompt,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        durationMinutes: duration ? Number(duration) : null,
        initialDocument: buildTemplate(template),
      })
      navigate(`/sessions/${session.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <div className="page narrow-form">
      <Link className="wordmark" to="/">
        {PRODUCT_NAME}
        <span>.</span>
      </Link>
      <div className="form-head">
        <h1>New interview</h1>
      </div>
      <p className="muted">Add a title and, if you want, a problem statement. You can place components before the candidate joins.</p>
      <form className="form" onSubmit={submit}>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
        </label>
        <label>
          Problem statement
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={10000}
            placeholder="Optional. Candidates see this after they join."
          />
        </label>
        <div className="prop-grid">
          <label>
            Scheduled time
            <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
          </label>
          <label>
            Duration in minutes
            <input
              type="number"
              min={5}
              max={240}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>
        <fieldset>
          <legend>Starting canvas</legend>
          <div className="template-grid">
            {TEMPLATES.map((item) => (
              <button
                key={item.id}
                className="template-card"
                type="button"
                aria-pressed={template === item.id}
                onClick={() => setTemplate(item.id)}
              >
                <strong>{item.name}</strong>
                <span className="muted">{item.detail}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <div className="cluster">
          <button className="btn" type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create interview'}</button>
          <Link className="btn secondary" to="/">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
