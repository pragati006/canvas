import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PRODUCT_NAME } from '../brand'
import { useInterviewService } from '../services/ServiceContext'
import { errorMessage } from '../services/errors'

export function LoginPage() {
  const service = useInterviewService()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void service.getCurrentUser().then((user) => {
      if (user) navigate('/')
    })
  }, [navigate, service])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const issued = await service.requestMagicLink(email)
      setLink(issued.verificationPath)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-story">
        <a className="wordmark" href="/">
          {PRODUCT_NAME}
          <span>.</span>
        </a>
        <div>
          <h1>A shared board for the system design interview.</h1>
          <p>
            Create a session, send one candidate link, and work the architecture together in real time.
          </p>
          <div className="story-points">
            <div>Components, connectors, notes, and freehand on one canvas.</div>
            <div>Lock editing, end the session, and keep the final board.</div>
          </div>
        </div>
        <p className="muted">Interviews are saved on the API server. Sign in with ada@lattice.test to open the sample interviews.</p>
      </section>
      <section className="auth-card">
        <h2>Sign in</h2>
        <p className="muted">Interviewers use an email magic link. Candidates join from a session link instead.</p>
        <form className="form" onSubmit={submit}>
          <label>
            Email
            <input
              ref={emailRef}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </form>
        {link ? (
          <div className="form">
            <p className="banner ok">Magic link ready. In this demo, open it directly.</p>
            <Link className="btn secondary" to={link}>
              Open magic link
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  )
}
