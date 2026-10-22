import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PRODUCT_NAME } from '../brand'
import { Dialog } from '../components/Dialog'
import { formatDateTime, formatWhen } from '../lib/format'
import type { SessionListItem } from '../services/api'
import { useInterviewService } from '../services/ServiceContext'
import { errorMessage } from '../services/errors'
import { useToast } from '../App'

export function DashboardPage() {
  const service = useInterviewService()
  const navigate = useNavigate()
  const toast = useToast()
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [archiveId, setArchiveId] = useState<string | null>(null)

  async function reload() {
    const user = await service.getCurrentUser()
    if (!user) {
      navigate('/login')
      return
    }
    service.setActorMode('user')
    setName(user.displayName)
    setSessions(await service.listSessions())
  }

  useEffect(() => {
    let cancelled = false
    void reload().catch((caught: unknown) => {
      if (!cancelled) setError(errorMessage(caught))
    })
    const unsubscribe = service.subscribe(() => {
      void reload().catch(() => undefined)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
    // reload identity is stable enough for this page's service instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service])

  async function copyLink(sessionId: string) {
    const detail = await service.getSession(sessionId)
    const active = detail.links.find((link) => link.roleGranted === 'candidate' && !link.revokedAt && link.hasLocalToken)
    const path = active ? await service.getGuestLinkPath(sessionId, active.id) : null
    const issued = path ? null : await service.createGuestLink(sessionId)
    const url = `${window.location.origin}${path ?? issued?.path}`
    await navigator.clipboard.writeText(url)
    toast('Candidate link copied.')
    await reload()
  }

  async function duplicate(sessionId: string) {
    const copy = await service.duplicateSession(sessionId)
    toast('Draft copy created.')
    navigate(`/sessions/${copy.id}`)
  }

  async function archive() {
    if (!archiveId) return
    await service.archiveSession(archiveId)
    setArchiveId(null)
    toast('Interview archived.')
    await reload()
  }

  return (
    <div className="page">
      <div className="dash-head">
        <Link className="wordmark" to="/">
          {PRODUCT_NAME}
          <span>.</span>
        </Link>
        <div className="cluster">
          <span className="muted">{name}</span>
          <button
            className="btn secondary small"
            type="button"
            onClick={() => {
              void service.signOut().then(() => navigate('/login'))
            }}
          >
            Sign out
          </button>
          <Link className="btn accent" to="/sessions/new">
            New interview
          </Link>
        </div>
      </div>
      <h1>Interviews</h1>
      <p className="muted">Sessions you own or were invited to. Open one to share a candidate link and start the board.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {sessions && sessions.length === 0 ? (
        <div className="empty-state">
          <h2>No interviews yet</h2>
          <p className="muted">Create one to get a candidate link and a shared canvas.</p>
          <Link className="btn" to="/sessions/new">New interview</Link>
        </div>
      ) : null}
      {sessions && sessions.length > 0 ? (
        <table className="session-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>State</th>
              <th>Created</th>
              <th>Scheduled</th>
              <th>Participants</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="session-title">{session.title}</td>
                <td><StatePill state={session.state} /></td>
                <td>{formatDateTime(session.createdAt)}</td>
                <td>{formatDateTime(session.scheduledAt ?? session.startedAt)}</td>
                <td>{session.participantNames.join(', ') || '—'}</td>
                <td title={formatDateTime(session.updatedAt)}>{formatWhen(session.updatedAt)}</td>
                <td>
                  <div className="row-actions">
                    <Link className="btn small" to={`/sessions/${session.id}`}>Open</Link>
                    {session.role === 'owner' ? (
                      <>
                        <button className="btn secondary small" type="button" onClick={() => void copyLink(session.id)}>
                          Copy link
                        </button>
                        <button className="btn secondary small" type="button" onClick={() => void duplicate(session.id)}>
                          Duplicate
                        </button>
                        {session.state !== 'archived' ? (
                          <button className="btn ghost small" type="button" onClick={() => setArchiveId(session.id)}>
                            Archive
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {archiveId ? (
        <Dialog title="Archive this interview?" onClose={() => setArchiveId(null)}>
          <p>Archived interviews stay on your dashboard and no longer accept new guests.</p>
          <div className="dialog-actions">
            <button className="btn secondary" type="button" onClick={() => setArchiveId(null)}>Cancel</button>
            <button className="btn danger" type="button" onClick={() => void archive()}>Archive</button>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}

function StatePill({ state }: { state: string }) {
  const label = state === 'live' ? 'Live' : state === 'ended' ? 'Ended' : state === 'archived' ? 'Archived' : 'Draft'
  const mark = state === 'live' ? '●' : state === 'ended' ? '✓' : state === 'archived' ? '▢' : '○'
  return (
    <span className={`pill ${state}`}>
      <i aria-hidden="true">{mark}</i>
      {label}
    </span>
  )
}
