import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useInterviewService } from '../services/ServiceContext'
import { errorMessage } from '../services/errors'

export function VerifyPage() {
  const service = useInterviewService()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setError('This sign-in link is not valid.')
      return
    }
    let cancelled = false
    void service.completeMagicLink(token).then(
      () => {
        if (!cancelled) navigate('/')
      },
      async (caught: unknown) => {
        if (cancelled) return
        const user = await service.getCurrentUser()
        if (cancelled) return
        if (user) {
          navigate('/')
          return
        }
        setError(errorMessage(caught))
      },
    )
    return () => {
      cancelled = true
    }
  }, [navigate, params, service])

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <h2>Signing you in</h2>
        {error ? (
          <>
            <p className="form-error" role="alert">{error}</p>
            <Link to="/login">Back to sign in</Link>
          </>
        ) : (
          <p className="muted">Checking the magic link…</p>
        )}
      </section>
    </div>
  )
}
