import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PRODUCT_NAME } from '../brand'
import { CanvasEditor, type EditorTool } from '../components/canvas/CanvasEditor'
import { Dialog } from '../components/Dialog'
import { SidePanel } from '../components/interview/SidePanel'
import { Toolbar } from '../components/interview/Toolbar'
import { useRoom } from '../hooks/useRoom'
import { formatClock } from '../lib/format'
import type { ComponentType } from '../canvas/model'
import type { AuditEvent } from '../services/domain'
import { useInterviewService } from '../services/ServiceContext'
import { errorMessage } from '../services/errors'
import { useToast } from '../App'

export function InterviewPage() {
  const { sessionId = '' } = useParams()
  const [params] = useSearchParams()
  const asGuest = params.get('as') === 'guest'
  const service = useInterviewService()
  const navigate = useNavigate()
  const toast = useToast()
  const room = useRoom(sessionId, asGuest ? 'guest' : 'user')
  const [tool, setTool] = useState<EditorTool>('select')
  const [placeType, setPlaceType] = useState<ComponentType>('service')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [strokeColor, setStrokeColor] = useState('#f4efe6')
  const [selection, setSelection] = useState<string[]>([])
  const [shareOpen, setShareOpen] = useState(false)
  const [confirm, setConfirm] = useState<'end' | 'clear' | 'revoke' | null>(null)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [linkExpires, setLinkExpires] = useState('')
  const [linkMaxUses, setLinkMaxUses] = useState('')
  const now = useNow()
  const sendPresenceRef = useRef(room.sendPresence)
  sendPresenceRef.current = room.sendPresence

  useEffect(() => {
    if (asGuest) return
    void service.getCurrentUser().then((user) => {
      if (!user) navigate('/login')
    })
  }, [asGuest, navigate, service])

  useEffect(() => {
    if (!room.detail) return
    sendPresenceRef.current({ selection })
  }, [room.detail, room.status, selection])

  if (room.error) {
    return (
      <div className="page">
        <h1>Can’t open this interview</h1>
        <p className="form-error" role="alert">{room.error}</p>
        <Link to={asGuest ? '/' : '/'}>Back</Link>
      </div>
    )
  }
  if (room.removed) {
    return (
      <div className="page">
        <h1>You were removed</h1>
        <p>The interviewer removed you from this session.</p>
      </div>
    )
  }
  if (!room.detail || !room.doc) {
    return (
      <div className="page">
        <p>Opening the interview…</p>
      </div>
    )
  }

  const { session, myRole, myParticipantId, participants } = room.detail
  const ended = session.state === 'ended' || session.state === 'archived'
  const me = participants.find((item) => item.id === myParticipantId)
  const activeLink = room.detail.links.find((link) => link.roleGranted === 'candidate' && !link.revokedAt)

  async function copyLink(path: string | null) {
    if (!path) {
      toast('Create a candidate link first.', 'warn')
      return
    }
    const url = `${window.location.origin}${path}`
    try {
      await navigator.clipboard.writeText(url)
      toast('Candidate link copied.')
    } catch {
      toast(url)
    }
  }

  async function createLink() {
    try {
      const issued = await service.createGuestLink(sessionId, {
        expiresAt: linkExpires ? new Date(linkExpires).toISOString() : null,
        maxUses: linkMaxUses ? Number(linkMaxUses) : null,
      })
      await room.reload()
      await copyLink(issued.path)
    } catch (caught) {
      toast(errorMessage(caught), 'warn')
    }
  }

  async function exportJson() {
    const json = await service.exportCanvas(sessionId)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${session.title || 'interview'}.lattice.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="room">
      <header className="topbar">
        <Link className="wordmark" to={asGuest ? `/sessions/${sessionId}?as=guest` : '/'}>
          {PRODUCT_NAME}
          <span>.</span>
        </Link>
        {myRole === 'owner' && !ended ? (
          <input
            className="title-input"
            aria-label="Session title"
            defaultValue={session.title}
            key={session.title}
            onBlur={(event) => {
              if (event.target.value !== session.title) {
                void service.updateSession(sessionId, { title: event.target.value }).then(() => room.reload())
              }
            }}
          />
        ) : (
          <h1>{session.title}</h1>
        )}
        <span className={`pill status-pill`} data-testid="connection-status">
          {statusLabel(room.status, room.saveState)}
        </span>
        <span className="timer" aria-label="Interview timer">
          {timerLabel(session.startedAt, session.durationMinutes, now)}
        </span>
        <span className="pill">{session.candidateEditingEnabled && !ended ? 'Editing open' : 'Editing locked'}</span>
        <div className="topbar-spacer" />
        <div className="cluster">
          <button className="btn secondary small mobile-only" type="button" onClick={() => setPanelOpen((open) => !open)}>
            Details
          </button>
          <button className="btn secondary small" type="button" aria-expanded={peopleOpen} onClick={() => setPeopleOpen((open) => !open)}>
            People ({participants.filter((item) => !item.leftAt).length})
          </button>
          {myRole === 'owner' && !ended ? (
            <>
              <button className="btn secondary small" type="button" onClick={() => setShareOpen(true)}>
                Share
              </button>
              <button
                className="btn secondary small"
                type="button"
                aria-pressed={!session.candidateEditingEnabled}
                onClick={() => void service.setCandidateEditing(sessionId, !session.candidateEditingEnabled).then(() => room.reload())}
              >
                {session.candidateEditingEnabled ? 'Lock candidates' : 'Unlock candidates'}
              </button>
              {session.state === 'draft' ? (
                <button className="btn accent small" type="button" onClick={() => void service.startSession(sessionId).then(() => room.reload())}>
                  Start
                </button>
              ) : null}
              <button className="btn danger small" type="button" onClick={() => setConfirm('end')}>
                End
              </button>
            </>
          ) : null}
          {ended && myRole === 'owner' ? (
            <>
              <button className="btn secondary small" type="button" onClick={() => void exportJson()}>
                Export JSON
              </button>
              <button
                className="btn small"
                type="button"
                onClick={() => void service.duplicateSession(sessionId).then((copy) => navigate(`/sessions/${copy.id}`))}
              >
                Duplicate
              </button>
            </>
          ) : null}
        </div>
      </header>
      <div className="room-banners">
        {room.notice ? <div className="room-banner banner warn" role="status">{room.notice}</div> : null}
        {ended ? <div className="room-banner banner">This interview has ended. The canvas is read-only.</div> : null}
        {!ended && myRole === 'candidate' && !session.candidateEditingEnabled ? (
          <div className="room-banner banner warn">The interviewer has locked candidate editing.</div>
        ) : null}
        {room.status === 'offline' ? (
          <div className="room-banner banner warn">You are offline. Edits stay queued until you reconnect.</div>
        ) : null}
        <div className="phone-banner banner warn">Phone editing isn’t supported. Join from a desktop browser to draw.</div>
      </div>
      <div className="room-body">
        <Toolbar
          tool={tool}
          placeType={placeType}
          disabled={room.readOnly}
          paletteOpen={paletteOpen}
          onTool={(next) => {
            setTool(next)
            setPaletteOpen(false)
          }}
          onTogglePalette={() => setPaletteOpen((open) => !open)}
          onPlace={(type) => {
            setPlaceType(type)
            setTool('place')
            setPaletteOpen(false)
          }}
        />
        <CanvasEditor
          document={room.doc}
          readOnly={room.readOnly}
          tool={tool}
          placeType={placeType}
          strokeColor={strokeColor}
          onStrokeColor={setStrokeColor}
          strokeWidth={3}
          route="elbow"
          dashed={false}
          arrowEnd
          selection={selection}
          onSelection={setSelection}
          onCommit={room.commit}
          onTool={setTool}
          actorId={myParticipantId}
          actorName={me?.displayName ?? 'You'}
          actorColor={me?.color ?? '#2f6fed'}
          presences={presencesWithFallback(room.presences, participants)}
          cursorsVisible={session.cursorVisibility}
          onPresence={room.sendPresence}
          canUndo={room.canUndo}
          canRedo={room.canRedo}
          onUndo={room.undo}
          onRedo={room.redo}
        />
        <SidePanel
          document={room.doc}
          selection={selection}
          session={session}
          role={myRole}
          actorId={myParticipantId}
          readOnly={room.readOnly}
          open={panelOpen}
          onSelection={setSelection}
          onCommit={room.commit}
          onPrompt={(prompt) => void service.updateSession(sessionId, { prompt }).then(() => room.reload())}
          onClear={() => setConfirm('clear')}
        />
      </div>
      {peopleOpen ? (
        <div className="popover" role="region" aria-label="Participants">
          {participants.filter((item) => !item.leftAt).map((person) => {
            const presence = room.presences.find((item) => item.participantId === person.id)
            const active = presence?.connectionState === 'connected'
            return (
              <div key={person.id} className="participant-row">
                <div>
                  <strong>{person.displayName}</strong>
                  <div className="muted">
                    {person.role} · {active ? 'Active' : 'Offline'}
                  </div>
                </div>
                {myRole === 'owner' && person.role !== 'owner' ? (
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => void service.removeParticipant(sessionId, person.id).then(() => room.reload())}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
      {shareOpen ? (
        <Dialog title="Share candidate link" onClose={() => setShareOpen(false)}>
          <p className="muted">The link is shown once and stored only as a hash on the session. Revoking it blocks new guests and leaves people already inside.</p>
          {activeLink?.hasLocalToken ? (
            <div className="cluster">
              <button className="btn small" type="button" onClick={() => void service.getGuestLinkPath(sessionId, activeLink.id).then((path) => copyLink(path))}>
                Copy link
              </button>
              <button
                className="btn secondary small"
                type="button"
                onClick={() =>
                  void service.getGuestLinkPath(sessionId, activeLink.id).then((path) => {
                    if (path) window.open(path, '_blank', 'noopener')
                  })
                }
              >
                Open lobby
              </button>
              <button className="btn ghost small" type="button" onClick={() => setConfirm('revoke')}>
                Revoke
              </button>
            </div>
          ) : (
            <>
              <label>
                Link expires
                <input type="datetime-local" value={linkExpires} onChange={(event) => setLinkExpires(event.target.value)} />
              </label>
              <label>
                Maximum uses
                <input
                  type="number"
                  min={1}
                  value={linkMaxUses}
                  placeholder="Unlimited"
                  onChange={(event) => setLinkMaxUses(event.target.value)}
                />
              </label>
              <button className="btn" type="button" onClick={() => void createLink()}>
                Create candidate link
              </button>
            </>
          )}
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const email = String(data.get('email') ?? '')
              const role = String(data.get('role') ?? 'interviewer') as 'interviewer' | 'observer'
              void service.inviteByEmail(sessionId, { email, role }).then(() => {
                toast('Invitation saved.')
                void room.reload()
              }).catch((caught: unknown) => toast(errorMessage(caught), 'warn'))
            }}
          >
            <label>
              Invite by email
              <input name="email" type="email" placeholder="interviewer@company.com" />
            </label>
            <label>
              Role
              <select name="role" defaultValue="interviewer">
                <option value="interviewer">Interviewer</option>
                <option value="observer">Observer</option>
              </select>
            </label>
            <button className="btn secondary" type="submit">Invite</button>
          </form>
          <button
            className="btn ghost small"
            type="button"
            onClick={() => void service.listAuditEvents(sessionId).then(setAudit).catch((caught: unknown) => toast(errorMessage(caught), 'warn'))}
          >
            Show activity
          </button>
          {audit.length ? (
            <ul>
              {audit.map((event) => (
                <li key={event.id}>{event.detail}</li>
              ))}
            </ul>
          ) : null}
        </Dialog>
      ) : null}
      {confirm ? (
        <Dialog
          title={confirm === 'end' ? 'End this interview?' : confirm === 'clear' ? 'Clear the canvas?' : 'Revoke the candidate link?'}
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm === 'end'
              ? 'Candidates will lose edit access and a final snapshot will be saved.'
              : confirm === 'clear'
                ? 'The current canvas is saved as a snapshot you can restore.'
                : 'New guests will be turned away. People already in the interview stay connected.'}
          </p>
          <div className="dialog-actions">
            <button className="btn secondary" type="button" onClick={() => setConfirm(null)}>Cancel</button>
            <button
              className="btn danger"
              type="button"
              onClick={() => {
                const action = confirm
                setConfirm(null)
                if (action === 'end') void service.endSession(sessionId).then(() => room.reload())
                if (action === 'clear') void service.clearCanvas(sessionId)
                if (action === 'revoke' && activeLink) {
                  void service.revokeGuestLink(sessionId, activeLink.id).then(() => room.reload())
                }
              }}
            >
              Confirm
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function timerLabel(startedAt: string | null, durationMinutes: number | null, now: number) {
  if (!startedAt) return durationMinutes ? `${durationMinutes} min` : 'Not started'
  const elapsed = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  if (!durationMinutes) return formatClock(elapsed)
  const remaining = durationMinutes * 60 - elapsed
  return remaining >= 0 ? `${formatClock(remaining)} left` : 'Time is up'
}

function statusLabel(status: string, save: string) {
  if (status === 'offline' || save === 'queued') return 'Offline'
  if (status === 'reconnecting') return 'Reconnecting'
  if (save === 'saving') return 'Saving'
  if (save === 'error') return 'Sync issue'
  return 'Connected'
}

function presencesWithFallback(
  presences: ReturnType<typeof useRoom>['presences'],
  participants: { id: string; displayName: string; color: string; role: 'owner' | 'interviewer' | 'candidate' | 'observer' }[],
) {
  if (presences.length) return presences
  return participants.map((person) => ({
    participantId: person.id,
    displayName: person.displayName,
    color: person.color,
    role: person.role,
    connectionState: 'offline' as const,
    cursor: null,
    selection: [],
    laser: null,
    lastSeen: 0,
  }))
}
