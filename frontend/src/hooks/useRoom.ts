import { useCallback, useEffect, useRef, useState } from 'react'
import { applyOp, mergeDoc, type CanvasOp, type DocState } from '../canvas/model'
import { captureHistory, historyToOp, type HistoryEntry } from '../canvas/history'
import { createId } from '../lib/crypto'
import type { CollaborationConnection, ConnectionStatus, Presence, ServerEvent, SessionDetail } from '../services/api'
import { useInterviewService } from '../services/ServiceContext'
import { errorMessage, isServiceError } from '../services/errors'
import { can } from '../services/permissions'

export interface CommitResult {
  state: DocState
  op: CanvasOp
  newIds?: string[]
}

export function useRoom(sessionId: string, actorMode: 'user' | 'guest') {
  const service = useInterviewService()
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [doc, setDoc] = useState<DocState | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connected')
  const [presences, setPresences] = useState<Presence[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'queued' | 'error'>('saved')
  const [removed, setRemoved] = useState(false)
  const [historyTick, setHistoryTick] = useState(0)
  const docRef = useRef<DocState | null>(null)
  const undoRef = useRef<HistoryEntry[]>([])
  const redoRef = useRef<HistoryEntry[]>([])
  const connectionRef = useRef<CollaborationConnection | null>(null)
  const detailRef = useRef<SessionDetail | null>(null)

  useEffect(() => {
    detailRef.current = detail
  }, [detail])

  useEffect(() => {
    let cancelled = false
    service.setActorMode(actorMode)
    const applyEvent = (event: ServerEvent) => {
      if (event.type === 'document_update') {
        setDoc((current) => {
          const base = current ?? docRef.current
          if (!base) return current
          const next = applyOp(base, event.op).state
          docRef.current = next
          return next
        })
      }
      if (event.type === 'canvas_replaced' || event.type === 'room_joined') {
        setDoc((current) => {
          const base = current ?? docRef.current
          const next = base ? mergeDoc(base, event.document) : event.document
          docRef.current = next
          return next
        })
        setDetail((current) => (current ? { ...current, session: event.session } : current))
      }
      if (event.type === 'room_joined') setPresences(event.participants)
      if (event.type === 'session_ended') {
        setDetail((current) => (current ? { ...current, session: event.session } : current))
      }
      if (event.type === 'permission_changed') {
        setDetail((current) =>
          current
            ? {
                ...current,
                session: {
                  ...current.session,
                  candidateEditingEnabled: event.candidateEditingEnabled,
                  cursorVisibility: event.cursorVisibility,
                },
              }
            : current,
        )
      }
      if (event.type === 'presence_update') {
        setPresences((current) => [
          ...current.filter((item) => item.participantId !== event.presence.participantId),
          event.presence,
        ])
      }
      if (event.type === 'presence_left') {
        setPresences((current) => current.filter((item) => item.participantId !== event.participantId))
      }
      if (event.type === 'participant_removed' && event.participantId === detailRef.current?.myParticipantId) {
        setRemoved(true)
      }
      if (event.type === 'rejected') {
        docRef.current = event.document
        setDoc(event.document)
        undoRef.current = []
        redoRef.current = []
        setSaveState('error')
        setNotice(event.message)
      }
    }

    void (async () => {
      try {
        if (actorMode === 'guest') await service.restoreGuest(sessionId)
        const session = await service.getSession(sessionId)
        const canvas = await service.getCanvas(sessionId)
        if (cancelled) return
        detailRef.current = session
        setDetail(session)
        docRef.current = canvas.document
        setDoc(canvas.document)
        const connection = await service.connect(sessionId)
        if (cancelled) {
          connection.close()
          return
        }
        connectionRef.current = connection
        connection.onStatus((next) => {
          setStatus(next)
          if (next === 'offline') setSaveState('queued')
          if (next === 'connected') setSaveState('saved')
        })
        connection.subscribe(applyEvent)
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught))
      }
    })()

    return () => {
      cancelled = true
      connectionRef.current?.close()
      connectionRef.current = null
    }
  }, [actorMode, service, sessionId])

  const readOnly = !detail
    ? true
    : removed || !can(detail.myRole, 'edit_canvas', detail.session)

  async function commit(build: (state: DocState) => CommitResult | null) {
    const current = docRef.current
    const connection = connectionRef.current
    if (!current || !connection || readOnly) return
    const result = build(current)
    if (!result) return
    const entry = captureHistory(current, result.op)
    docRef.current = result.state
    setDoc(result.state)
    if (entry) {
      undoRef.current = [...undoRef.current, entry].slice(-100)
      redoRef.current = []
      setHistoryTick((value) => value + 1)
    }
    setSaveState(connection.getStatus() === 'offline' ? 'queued' : 'saving')
    try {
      const sent = await connection.sendDocumentUpdate({ clientOperationId: createId(), op: result.op })
      setSaveState(sent.queued ? 'queued' : 'saved')
      return result
    } catch (caught) {
      if (isServiceError(caught) && (caught.code === 'conflict' || caught.code === 'locked' || caught.code === 'ended' || caught.code === 'forbidden')) {
        const fresh = await service.getCanvas(sessionId).catch(() => null)
        if (fresh) {
          docRef.current = fresh.document
          setDoc(fresh.document)
        }
        undoRef.current = []
        redoRef.current = []
        setNotice(caught.message)
      }
      setSaveState('error')
    }
  }

  async function step(direction: 'undo' | 'redo') {
    const current = docRef.current
    const connection = connectionRef.current
    const actor = detailRef.current?.myParticipantId
    if (!current || !connection || !actor || readOnly) return
    const entry = (direction === 'undo' ? undoRef.current : redoRef.current).pop()
    if (!entry) return
    const op = historyToOp(entry, direction, current, actor, Date.now())
    ;(direction === 'undo' ? redoRef.current : undoRef.current).push(entry)
    const next = applyOp(current, op).state
    docRef.current = next
    setDoc(next)
    setHistoryTick((value) => value + 1)
    await connection.sendDocumentUpdate({ clientOperationId: createId(), op })
  }

  return {
    detail,
    doc,
    status,
    presences,
    error,
    notice,
    clearNotice: () => setNotice(null),
    saveState,
    removed,
    readOnly,
    canUndo: historyTick >= 0 && undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    commit,
    undo: () => void step('undo'),
    redo: () => void step('redo'),
    sendPresence: useCallback((update: { cursor?: { x: number; y: number } | null; selection?: string[]; laser?: { x: number; y: number } | null }) => {
      connectionRef.current?.sendPresence(update)
    }, []),
    reload: async () => {
      const session = await service.getSession(sessionId)
      detailRef.current = session
      setDetail(session)
      return session
    },
  }
}
