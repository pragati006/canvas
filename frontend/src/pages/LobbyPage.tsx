import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PRODUCT_NAME } from '../brand'
import { useInterviewService } from '../services/ServiceContext'
import { errorMessage, isServiceError } from '../services/errors'

export function LobbyPage() {
  const { token = '' } = useParams()
  const service = useInterviewService()
  const navigate = useNavigate()
  const [title, setTitle] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [compatible, setCompatible] = useState(true)

  useEffect(() => {
    const modern = typeof BroadcastChannel !== 'undefined' && typeof crypto.randomUUID === 'function'
    setCompatible(modern)
    let cancelled = false
    void service.previewJoin(token).then(
      (preview) => {
        if (!cancelled) setTitle(preview.title)
      },
      (caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught))
      },
    )
    return () => {
      cancelled = true
    }
  }, [service, token])

  async function join(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await service.joinWithToken(token, { displayName, acceptPrivacy: accepted })
      navigate(`/sessions/${result.sessionId}?as=guest`)
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-story">
        <div className="wordmark">
          {PRODUCT_NAME}
          <span>.</span>
        </div>
        <div>
          <h1>{title ?? 'Join interview'}</h1>
          <p>You’ll enter a shared canvas. Shapes, labels, and drawings are saved with this interview.</p>
        </div>
        <p className="muted">Use a current desktop version of Chrome, Edge, Firefox, or Safari.</p>
      </section>
      <section className="auth-card">
        <h2>Join as a guest</h2>
        {!compatible ? (
          <p className="banner warn" role="status">
            This browser is missing features Lattice uses for live updates. Switch to a current desktop browser.
          </p>
        ) : null}
        {error && !title ? <p className="form-error" role="alert">{error}</p> : null}
        {title ? (
          <form className="form" onSubmit={join}>
            <label>
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                maxLength={40}
                autoComplete="nickname"
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
              <span>I understand that my canvas activity will be saved with this interview.</span>
            </label>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="btn" type="submit" disabled={pending || !accepted}>
              {pending ? 'Joining…' : 'Join interview'}
            </button>
          </form>
        ) : error && isServiceError(error) ? null : !error ? (
          <p className="muted">Checking the link…</p>
        ) : null}
      </section>
    </div>
  )
}
