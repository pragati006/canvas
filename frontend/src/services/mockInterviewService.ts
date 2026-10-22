import { SCHEMA_VERSION, applyOp, assertWithinLimits, emptyDoc, validateOp, type CanvasOp } from '../canvas/model'
import { PARTICIPANT_COLORS } from '../brand'
import { createId, randomToken, sha256Hex } from '../lib/crypto'
import { stableStringify } from '../lib/format'
import { cleanText, displayNameFromEmail, isValidEmail } from '../lib/text'
import type {
  ActorMode,
  CanvasBundle,
  CollaborationConnection,
  ConnectionStatus,
  CreateLinkInput,
  CreateSessionInput,
  InterviewService,
  IssuedLink,
  JoinPreview,
  JoinResult,
  Presence,
  ServerEvent,
  SessionDetail,
  SessionListItem,
  UpdateSessionInput,
} from './api'
import type { AuditEvent, Database, GuestLink, Participant, Role, Session, User } from './domain'
import { ServiceError } from './errors'
import { mergeDbSnapshot } from './mergeDb'
import { can } from './permissions'
import type { EventBus, KeyValueStore, Persistence } from './sharedStore'
import { MemoryKv, SharedStore } from './sharedStore'

const CREDENTIAL_TTL_MS = 2 * 60 * 60 * 1000
const MAGIC_TTL_MS = 15 * 60 * 1000
const DEFAULT_LIMITS = {
  joinPerMinute: 30,
  magicPer10Min: 5,
  createPerHour: 30,
  opsPerMinute: 600,
}

export interface SyncEvent {
  type: 'db' | 'presence' | 'presence-leave'
  origin: string
  sessionId?: string
  participantId?: string
  presence?: Presence
}

export interface MockServiceOptions {
  store?: SharedStore
  now?: () => number
  userStore?: KeyValueStore
  guestStore?: KeyValueStore
  vaultStore?: KeyValueStore
  persistence?: Persistence | null
  bus?: EventBus<SyncEvent> | null
  limits?: Partial<typeof DEFAULT_LIMITS>
}

interface GuestRecord {
  sessionId: string
  participantId: string
  credential: string
}

interface VaultFile {
  links: Record<string, { token: string; sessionId: string }>
}

export class MockCollaborationConnection implements CollaborationConnection {
  private listeners = new Set<(event: ServerEvent) => void>()
  private statusListeners = new Set<(status: ConnectionStatus) => void>()
  private status: ConnectionStatus = 'connected'
  private online = true
  private closed = false
  private started = false
  private queue: Array<{ clientOperationId: string; op: CanvasOp }> = []
  private unsubscribe: () => void
  private onUnload: (() => void) | null = null

  constructor(
    private service: MockInterviewService,
    private sessionId: string,
    private participant: Participant,
    private credential: string,
  ) {
    this.unsubscribe = service.store.subscribeEvents((event) => {
      if (this.closed) return
      if (event.type === 'synced') {
        const room = this.service.readRoom(this.sessionId)
        this.emit({
          type: 'canvas_replaced',
          document: room.document,
          cursor: room.cursor,
          epoch: room.epoch,
          session: room.session,
        })
        if (room.session.state === 'ended' || room.session.state === 'archived') {
          this.emit({ type: 'session_ended', session: room.session })
        }
        this.emit({
          type: 'permission_changed',
          candidateEditingEnabled: room.session.candidateEditingEnabled,
          cursorVisibility: room.session.cursorVisibility,
        })
        return
      }
      if (event.type !== 'server' || event.sessionId !== this.sessionId || !event.event) return
      this.emit(event.event)
    })
    if (typeof window !== 'undefined') {
      this.onUnload = () => this.close()
      window.addEventListener('beforeunload', this.onUnload)
    }
  }

  subscribe(listener: (event: ServerEvent) => void) {
    this.listeners.add(listener)
    if (!this.started) {
      this.started = true
      queueMicrotask(() => {
        if (this.closed) return
        const room = this.service.readRoom(this.sessionId)
        this.emit({
          type: 'room_joined',
          document: room.document,
          cursor: room.cursor,
          epoch: room.epoch,
          participants: this.service.store.listPresence(this.sessionId),
          session: room.session,
        })
        this.service.announcePresence(this.sessionId, this.participant, 'connected', {})
      })
    }
    return () => this.listeners.delete(listener)
  }

  onStatus(listener: (status: ConnectionStatus) => void) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  getStatus() {
    return this.status
  }

  async sendDocumentUpdate(input: { clientOperationId: string; op: CanvasOp }) {
    if (this.closed) throw new ServiceError('invalid', 'The connection is closed.')
    if (!this.online) {
      this.queue.push(input)
      return { cursor: -1, queued: true }
    }
    const result = await this.service.applyClientOp(this.sessionId, this.participant.id, this.credential, input)
    return { cursor: result.cursor, queued: false }
  }

  sendPresence(update: {
    cursor?: { x: number; y: number } | null
    selection?: string[]
    laser?: { x: number; y: number } | null
  }) {
    if (this.closed || !this.online) return
    this.service.announcePresence(this.sessionId, this.participant, this.status, update)
  }

  ping() {
    this.emit({ type: 'pong' })
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.service.leavePresence(this.sessionId, this.participant.id)
    this.unsubscribe()
    if (this.onUnload && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.onUnload)
    }
  }

  async debugSetOnline(online: boolean) {
    if (this.closed) return
    if (!online) {
      this.online = false
      this.setStatus('offline')
      this.service.announcePresence(this.sessionId, this.participant, 'offline', {})
      return
    }
    this.setStatus('reconnecting')
    this.online = true
    const queued = [...this.queue]
    this.queue = []
    const room = this.service.readRoom(this.sessionId)
    this.emit({
      type: 'canvas_replaced',
      document: room.document,
      cursor: room.cursor,
      epoch: room.epoch,
      session: room.session,
    })
    for (const item of queued) {
      try {
        await this.service.applyClientOp(this.sessionId, this.participant.id, this.credential, item)
      } catch (error) {
        const fresh = this.service.readRoom(this.sessionId)
        const serviceError = error instanceof ServiceError ? error : null
        this.emit({
          type: 'rejected',
          code: serviceError?.code ?? 'conflict',
          message:
            serviceError?.message ??
            'The canvas changed and this edit could not be merged safely. The saved canvas was kept.',
          document: fresh.document,
        })
        break
      }
    }
    this.setStatus('connected')
    this.service.announcePresence(this.sessionId, this.participant, 'connected', {})
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status
    this.statusListeners.forEach((listener) => listener(status))
  }

  private emit(event: ServerEvent) {
    this.listeners.forEach((listener) => listener(event))
  }
}

export class MockInterviewService implements InterviewService {
  readonly store: SharedStore
  readonly instanceId = createId()
  private readonly now: () => number
  private readonly userStore: KeyValueStore
  private readonly guestStore: KeyValueStore
  private readonly vaultStore: KeyValueStore
  private readonly persistence: Persistence | null
  private readonly bus: EventBus<SyncEvent> | null
  private readonly limits: typeof DEFAULT_LIMITS
  private mode: ActorMode = 'user'
  private queue: Promise<void> = Promise.resolve()

  constructor(options: MockServiceOptions = {}) {
    this.store = options.store ?? new SharedStore()
    this.now = options.now ?? (() => Date.now())
    this.userStore = options.userStore ?? new MemoryKv()
    this.guestStore = options.guestStore ?? new MemoryKv()
    this.vaultStore = options.vaultStore ?? new MemoryKv()
    this.persistence = options.persistence ?? null
    this.bus = options.bus ?? null
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
    if (this.persistence) {
      const persistence = this.persistence
      this.store.onCommit = (draft) => {
        const latest = persistence.load()
        const merged = latest ? mergeDbSnapshot(draft, latest) : draft
        persistence.save(merged)
        return merged
      }
    }
    this.bus?.subscribe((event) => this.onBus(event))
  }

  debugDatabase(): Database {
    return structuredClone(this.store.db)
  }

  requestMagicLink(email: string) {
    return this.enqueue(async () => {
      const normalized = email.trim().toLowerCase()
      if (!isValidEmail(normalized)) throw new ServiceError('invalid', 'Enter a valid email address.')
      this.commit((db) => this.consumeRate(db, `magic:${normalized}`, this.limits.magicPer10Min, 10 * 60 * 1000))
      const token = randomToken(32)
      const tokenHash = await sha256Hex(token)
      this.commit((db) => {
        db.magicLinks.push({
          id: createId(),
          tokenHash,
          email: normalized,
          expiresAt: this.iso(this.now() + MAGIC_TTL_MS),
          usedAt: null,
        })
      })
      return { verificationPath: `/auth/verify?token=${encodeURIComponent(token)}` }
    })
  }

  completeMagicLink(token: string) {
    return this.enqueue(async () => {
      const tokenHash = await sha256Hex(token)
      const user = this.commit((db) => {
        const link = db.magicLinks.find((item) => item.tokenHash === tokenHash)
        if (!link) throw new ServiceError('not_found', 'This sign-in link is not valid.', 404)
        if (link.usedAt) throw new ServiceError('invalid', 'This sign-in link was already used.')
        if (Date.parse(link.expiresAt) <= this.now()) throw new ServiceError('expired', 'This sign-in link has expired.')
        link.usedAt = this.iso()
        let next = db.users.find((item) => item.email === link.email)
        if (!next) {
          next = {
            id: createId(),
            email: link.email,
            displayName: displayNameFromEmail(link.email),
            organizationId: null,
            createdAt: this.iso(),
          }
          db.users.push(next)
        }
        const pending = db.invites.filter((invite) => invite.email === next!.email)
        for (const invite of pending) {
          const membership = db.memberships.find(
            (item) => item.sessionId === invite.sessionId && item.userId === next!.id,
          )
          if (!membership) {
            db.memberships.push({
              sessionId: invite.sessionId,
              userId: next.id,
              role: invite.role,
              createdAt: this.iso(),
              updatedAt: this.iso(),
            })
          } else if (membership.role !== 'owner') {
            membership.role = invite.role
            membership.updatedAt = this.iso()
          }
        }
        db.invites = db.invites.filter((invite) => invite.email !== next!.email)
        return structuredClone(next)
      })
      this.userStore.set('userId', user.id)
      this.mode = 'user'
      return user
    })
  }

  getCurrentUser() {
    return this.enqueue(async () => this.currentUser())
  }

  signOut() {
    return this.enqueue(async () => {
      this.userStore.remove('userId')
      this.mode = 'user'
    })
  }

  setActorMode(mode: ActorMode) {
    this.mode = mode
  }

  listSessions() {
    return this.enqueue(async () => {
      const user = this.requireCurrentUser()
      return this.store.db.sessions
        .filter((session) =>
          this.store.db.memberships.some((item) => item.sessionId === session.id && item.userId === user.id),
        )
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .map((session) => this.toListItem(session, user.id))
    })
  }

  createSession(input: CreateSessionInput) {
    return this.enqueue(async () => {
      const user = this.requireCurrentUser()
      const title = cleanText(input.title.trim(), 200)
      if (!title) throw new ServiceError('invalid', 'Enter a title.')
      const prompt = cleanText(input.prompt?.trim() ?? '', 10_000)
      const durationMinutes = normalizeDuration(input.durationMinutes)
      const scheduledAt = normalizeSchedule(input.scheduledAt)
      if (input.initialDocument && input.initialDocument.schemaVersion !== SCHEMA_VERSION) {
        throw new ServiceError('invalid', 'This canvas template is unsupported.')
      }
      this.commit((db) => this.consumeRate(db, `create:${user.id}`, this.limits.createPerHour, 60 * 60 * 1000))
      return this.commit((db) => {
        const now = this.iso()
        const session: Session = {
          id: createId(),
          ownerUserId: user.id,
          title,
          prompt,
          state: 'draft',
          candidateEditingEnabled: true,
          cursorVisibility: true,
          durationMinutes,
          scheduledAt,
          startedAt: null,
          endedAt: null,
          createdAt: now,
          updatedAt: now,
          maxParticipants: 10,
        }
        db.sessions.push(session)
        db.memberships.push({
          sessionId: session.id,
          userId: user.id,
          role: 'owner',
          createdAt: now,
          updatedAt: now,
        })
        db.participants.push(this.makeParticipant(db, session.id, user.displayName, 'owner', user.id, null))
        const state = input.initialDocument ? structuredClone(input.initialDocument) : emptyDoc()
        const limit = assertWithinLimits(state)
        if (limit) throw new ServiceError('too_large', limit)
        db.documents.push({
          id: createId(),
          sessionId: session.id,
          schemaVersion: SCHEMA_VERSION,
          latestSnapshotId: null,
          cursor: 0,
          epoch: state.epoch,
          state,
          updatedAt: now,
        })
        this.addAudit(db, session.id, user.id, 'session_created', 'Session created')
        return structuredClone(session)
      })
    })
  }

  getSession(sessionId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      if (actor.userId) {
        const participant = await this.ensureParticipant(sessionId, actor)
        actor.participantId = participant.id
        actor.actorId = participant.id
      }
      const session = this.requireSession(sessionId)
      this.assertCanView(actor.role, session)
      return this.toDetail(session, actor)
    })
  }

  updateSession(sessionId: string, patch: UpdateSessionInput) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'update the interview')
      return this.commit((db) => {
        const session = this.sessionIn(db, sessionId)
        if (session.state === 'ended' || session.state === 'archived') {
          throw new ServiceError('ended', 'Ended interviews are read-only.', 403)
        }
        if (patch.title !== undefined) {
          const title = cleanText(patch.title.trim(), 200)
          if (!title) throw new ServiceError('invalid', 'Enter a title.')
          session.title = title
        }
        if (patch.prompt !== undefined) session.prompt = cleanText(patch.prompt, 10_000)
        if (patch.scheduledAt !== undefined) session.scheduledAt = normalizeSchedule(patch.scheduledAt)
        if (patch.durationMinutes !== undefined) session.durationMinutes = normalizeDuration(patch.durationMinutes)
        if (patch.maxParticipants !== undefined) {
          if (patch.maxParticipants < 2 || patch.maxParticipants > 10) {
            throw new ServiceError('invalid', 'Participant capacity must be between 2 and 10.')
          }
          session.maxParticipants = patch.maxParticipants
        }
        session.updatedAt = this.iso()
        return structuredClone(session)
      })
      this.broadcastRoom(sessionId)
      return structuredClone(this.requireSession(sessionId))
    })
  }

  startSession(sessionId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      const existing = this.requireSession(sessionId)
      if (existing.state === 'live') return structuredClone(existing)
      if (actor.role !== 'owner') this.assertOwner(actor.role, 'start the interview')
      if (existing.state !== 'draft') throw new ServiceError('invalid', 'Only a draft interview can be started.')
      return this.commit((db) => {
        const session = this.sessionIn(db, sessionId)
        session.state = 'live'
        session.startedAt = this.iso()
        session.updatedAt = session.startedAt
        this.addAudit(db, sessionId, actor.actorId, 'session_started', 'Session started')
        return structuredClone(session)
      })
      this.broadcastRoom(sessionId)
      return structuredClone(this.requireSession(sessionId))
    })
  }

  endSession(sessionId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'end the session')
      const existing = this.requireSession(sessionId)
      if (existing.state === 'ended' || existing.state === 'archived') {
        throw new ServiceError('invalid', 'This interview has already ended.')
      }
      await this.writeSnapshot(sessionId)
      const session = this.commit((db) => {
        const next = this.sessionIn(db, sessionId)
        next.state = 'ended'
        next.endedAt = this.iso()
        next.updatedAt = next.endedAt
        next.candidateEditingEnabled = false
        this.addAudit(db, sessionId, actor.actorId, 'session_ended', 'Session ended')
        return structuredClone(next)
      })
      this.emitToSession(sessionId, { type: 'session_ended', session })
      return session
    })
  }

  archiveSession(sessionId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'archive the session')
      const existing = this.requireSession(sessionId)
      if (existing.state === 'archived') return structuredClone(existing)
      if (existing.state === 'live' || existing.state === 'draft') await this.writeSnapshot(sessionId)
      const session = this.commit((db) => {
        const next = this.sessionIn(db, sessionId)
        if (!next.endedAt && next.state !== 'draft') next.endedAt = this.iso()
        next.state = 'archived'
        next.updatedAt = this.iso()
        next.candidateEditingEnabled = false
        this.addAudit(db, sessionId, actor.actorId, 'session_archived', 'Session archived')
        return structuredClone(next)
      })
      this.emitToSession(sessionId, { type: 'session_ended', session })
      return session
    })
  }

  duplicateSession(sessionId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'duplicate the session')
      const user = this.requireCurrentUser()
      return this.commit((db) => {
        const source = this.sessionIn(db, sessionId)
        const sourceDoc = this.documentIn(db, sessionId)
        const now = this.iso()
        const session: Session = {
          ...structuredClone(source),
          id: createId(),
          title: cleanText(`Copy of ${source.title}`, 200),
          state: 'draft',
          candidateEditingEnabled: true,
          startedAt: null,
          endedAt: null,
          createdAt: now,
          updatedAt: now,
        }
        db.sessions.push(session)
        db.memberships.push({
          sessionId: session.id,
          userId: user.id,
          role: 'owner',
          createdAt: now,
          updatedAt: now,
        })
        db.participants.push(this.makeParticipant(db, session.id, user.displayName, 'owner', user.id, null))
        db.documents.push({
          id: createId(),
          sessionId: session.id,
          schemaVersion: SCHEMA_VERSION,
          latestSnapshotId: null,
          cursor: 0,
          epoch: sourceDoc.state.epoch,
          state: structuredClone(sourceDoc.state),
          updatedAt: now,
        })
        this.addAudit(db, session.id, actor.actorId, 'session_duplicated', 'Session duplicated')
        return structuredClone(session)
      })
    })
  }

  clearCanvas(sessionId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'clear the canvas')
      const existing = this.requireSession(sessionId)
      if (existing.state === 'ended' || existing.state === 'archived') {
        throw new ServiceError('ended', 'Ended interviews are read-only.', 403)
      }
      const snapshotId = await this.writeSnapshot(sessionId)
      const clientOperationId = createId()
      this.commit((db) => {
        const doc = this.documentIn(db, sessionId)
        const nextEpoch = doc.epoch + 1
        const cleared = emptyDoc(nextEpoch)
        doc.state = cleared
        doc.epoch = nextEpoch
        doc.cursor += 1
        doc.updatedAt = this.iso()
        db.operations.push({
          id: createId(),
          canvasDocumentId: doc.id,
          actorId: actor.actorId,
          clientOperationId,
          payload: { kind: 'restore', epoch: nextEpoch, state: cleared },
          serverReceivedAt: this.iso(),
          cursor: doc.cursor,
        })
        this.sessionIn(db, sessionId).updatedAt = doc.updatedAt
        this.addAudit(db, sessionId, actor.actorId, 'canvas_cleared', 'Canvas cleared')
      })
      const room = this.readRoom(sessionId)
      this.emitToSession(sessionId, {
        type: 'document_update',
        cursor: room.cursor,
        actorId: actor.actorId,
        clientOperationId,
        op: { kind: 'restore', epoch: room.epoch, state: room.document },
      })
      return { snapshotId }
    })
  }

  restoreSnapshot(sessionId: string, snapshotId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'restore a snapshot')
      const existing = this.requireSession(sessionId)
      if (existing.state === 'ended' || existing.state === 'archived') {
        throw new ServiceError('ended', 'Ended interviews are read-only.', 403)
      }
      const clientOperationId = createId()
      this.commit((db) => {
        const snapshot = db.snapshots.find((item) => item.id === snapshotId)
        const blob = snapshot ? db.blobs[snapshot.storageKey] : undefined
        if (!snapshot || !blob) throw new ServiceError('not_found', 'That snapshot could not be found.', 404)
        const doc = this.documentIn(db, sessionId)
        const nextEpoch = doc.epoch + 1
        const restored = { ...structuredClone(blob), epoch: nextEpoch, schemaVersion: SCHEMA_VERSION }
        doc.state = restored
        doc.epoch = nextEpoch
        doc.cursor += 1
        doc.latestSnapshotId = snapshot.id
        doc.updatedAt = this.iso()
        db.operations.push({
          id: createId(),
          canvasDocumentId: doc.id,
          actorId: actor.actorId,
          clientOperationId,
          payload: { kind: 'restore', epoch: nextEpoch, state: restored },
          serverReceivedAt: doc.updatedAt,
          cursor: doc.cursor,
        })
        this.addAudit(db, sessionId, actor.actorId, 'snapshot_restored', 'Canvas snapshot restored')
      })
      const room = this.readRoom(sessionId)
      this.emitToSession(sessionId, {
        type: 'document_update',
        cursor: room.cursor,
        actorId: actor.actorId,
        clientOperationId,
        op: { kind: 'restore', epoch: room.epoch, state: room.document },
      })
    })
  }

  createGuestLink(sessionId: string, input: CreateLinkInput = {}) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'change the guest link')
      const current = this.requireSession(sessionId)
      if (current.state === 'ended' || current.state === 'archived') {
        throw new ServiceError('archived', 'This interview is no longer accepting guests.', 403)
      }
      const roleGranted = input.roleGranted ?? 'candidate'
      if (input.maxUses !== undefined && input.maxUses !== null && input.maxUses < 1) {
        throw new ServiceError('invalid', 'Maximum uses must be at least 1.')
      }
      if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) {
        throw new ServiceError('invalid', 'Expiration is not a valid time.')
      }
      const token = randomToken(32)
      const tokenHash = await sha256Hex(token)
      const issued = this.commit((db) => {
        const now = this.iso()
        for (const link of db.guestLinks) {
          if (link.sessionId === sessionId && link.roleGranted === roleGranted && !link.revokedAt) {
            link.revokedAt = now
          }
        }
        const link: GuestLink = {
          id: createId(),
          sessionId,
          tokenHash,
          roleGranted,
          expiresAt: input.expiresAt ?? null,
          maxUses: input.maxUses ?? null,
          useCount: 0,
          revokedAt: null,
          createdAt: now,
        }
        db.guestLinks.push(link)
        this.sessionIn(db, sessionId).updatedAt = now
        this.addAudit(db, sessionId, actor.actorId, 'link_created', 'Guest link created')
        return {
          id: link.id,
          sessionId,
          roleGranted,
          expiresAt: link.expiresAt,
          maxUses: link.maxUses,
          createdAt: link.createdAt,
          token,
          path: `/join/${token}`,
        } satisfies IssuedLink
      })
      const vault = this.readVault()
      for (const [linkId, entry] of Object.entries(vault.links)) {
        if (entry.sessionId === sessionId) {
          const known = this.store.db.guestLinks.find((link) => link.id === linkId)
          if (known?.revokedAt) delete vault.links[linkId]
        }
      }
      vault.links[issued.id] = { token, sessionId }
      this.writeVault(vault)
      return issued
    })
  }

  revokeGuestLink(sessionId: string, linkId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'revoke the guest link')
      this.commit((db) => {
        const link = db.guestLinks.find((item) => item.id === linkId && item.sessionId === sessionId)
        if (!link) throw new ServiceError('not_found', 'That guest link could not be found.', 404)
        if (!link.revokedAt) link.revokedAt = this.iso()
        this.addAudit(db, sessionId, actor.actorId, 'link_revoked', 'Guest link revoked')
      })
      const vault = this.readVault()
      delete vault.links[linkId]
      this.writeVault(vault)
    })
  }

  getGuestLinkPath(sessionId: string, linkId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'copy the guest link')
      const link = this.store.db.guestLinks.find((item) => item.id === linkId && item.sessionId === sessionId)
      if (!link || link.revokedAt) return null
      const token = this.readVault().links[linkId]?.token
      return token ? `/join/${token}` : null
    })
  }

  inviteByEmail(sessionId: string, input: { email: string; role: 'interviewer' | 'observer' }) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'invite people')
      const email = input.email.trim().toLowerCase()
      if (!isValidEmail(email)) throw new ServiceError('invalid', 'Enter a valid email address.')
      const owner = this.requireCurrentUser()
      if (owner.email === email) throw new ServiceError('invalid', 'You already own this interview.')
      this.commit((db) => {
        const existingUser = db.users.find((user) => user.email === email)
        if (existingUser) {
          const membership = db.memberships.find(
            (item) => item.sessionId === sessionId && item.userId === existingUser.id,
          )
          if (membership?.role === 'owner') throw new ServiceError('invalid', 'You already own this interview.')
          if (membership) {
            membership.role = input.role
            membership.updatedAt = this.iso()
          } else {
            db.memberships.push({
              sessionId,
              userId: existingUser.id,
              role: input.role,
              createdAt: this.iso(),
              updatedAt: this.iso(),
            })
          }
          const removed = db.participants.find(
            (item) => item.sessionId === sessionId && item.userId === existingUser.id && item.leftAt,
          )
          if (removed) {
            removed.leftAt = null
            removed.role = input.role
            removed.updatedAt = this.iso()
          }
        } else if (!db.invites.some((invite) => invite.sessionId === sessionId && invite.email === email)) {
          db.invites.push({
            id: createId(),
            sessionId,
            email,
            role: input.role,
            createdAt: this.iso(),
          })
        } else {
          const invite = db.invites.find((item) => item.sessionId === sessionId && item.email === email)
          if (invite) invite.role = input.role
        }
        this.addAudit(db, sessionId, actor.actorId, 'invite_sent', `Invited an ${input.role}`)
      })
    })
  }

  removeParticipant(sessionId: string, participantId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'remove a participant')
      this.commit((db) => {
        const participant = db.participants.find((item) => item.id === participantId && item.sessionId === sessionId)
        if (!participant) throw new ServiceError('not_found', 'That participant could not be found.', 404)
        if (participant.role === 'owner') throw new ServiceError('invalid', 'The owner cannot be removed.')
        participant.leftAt = this.iso()
        participant.updatedAt = participant.leftAt
        if (participant.userId) {
          db.memberships = db.memberships.filter(
            (item) => !(item.sessionId === sessionId && item.userId === participant.userId && item.role !== 'owner'),
          )
        }
        for (const credential of db.credentials) {
          if (credential.participantId === participant.id) credential.revokedAt = participant.leftAt
        }
        this.addAudit(db, sessionId, actor.actorId, 'participant_removed', 'Participant removed')
      })
      this.leavePresence(sessionId, participantId)
      this.emitToSession(sessionId, { type: 'participant_removed', participantId })
    })
  }

  setCandidateEditing(sessionId: string, enabled: boolean) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'lock candidate editing')
      const session = this.commit((db) => {
        const next = this.sessionIn(db, sessionId)
        if (next.state === 'ended' || next.state === 'archived') {
          throw new ServiceError('ended', 'Ended interviews are read-only.', 403)
        }
        next.candidateEditingEnabled = enabled
        next.updatedAt = this.iso()
        this.addAudit(
          db,
          sessionId,
          actor.actorId,
          'permission_changed',
          enabled ? 'Candidate editing unlocked' : 'Candidate editing locked',
        )
        return structuredClone(next)
      })
      this.emitToSession(sessionId, {
        type: 'permission_changed',
        candidateEditingEnabled: session.candidateEditingEnabled,
        cursorVisibility: session.cursorVisibility,
      })
      return session
    })
  }

  setCursorVisibility(sessionId: string, visible: boolean) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      this.assertOwner(actor.role, 'change cursor visibility')
      const session = this.commit((db) => {
        const next = this.sessionIn(db, sessionId)
        next.cursorVisibility = visible
        next.updatedAt = this.iso()
        return structuredClone(next)
      })
      this.emitToSession(sessionId, {
        type: 'permission_changed',
        candidateEditingEnabled: session.candidateEditingEnabled,
        cursorVisibility: session.cursorVisibility,
      })
      return session
    })
  }

  previewJoin(token: string) {
    return this.enqueue(async () => this.lookupJoin(token))
  }

  joinWithToken(token: string, input: { displayName: string; acceptPrivacy: boolean }) {
    return this.enqueue(async () => {
      if (!input.acceptPrivacy) throw new ServiceError('invalid', 'Accept the privacy notice to join.')
      const displayName = cleanText(input.displayName.trim(), 40)
      if (!displayName) throw new ServiceError('invalid', 'Enter a display name.')
      const located = await this.lookupJoin(token)
      const tokenHash = await sha256Hex(token)
      const credential = randomToken(32)
      const credentialHash = await sha256Hex(credential)
      const participant = this.commit((db) => {
        const link = db.guestLinks.find((item) => item.tokenHash === tokenHash)
        if (!link) throw new ServiceError('not_found', 'This link is not valid. Check the address with your interviewer.', 404)
        const session = this.sessionIn(db, link.sessionId)
        const blocked = this.joinBlocker(db, session, link)
        if (blocked) throw blocked
        link.useCount += 1
        const next = this.makeParticipant(db, session.id, displayName, link.roleGranted, null, link.id)
        db.participants.push(next)
        db.credentials.push({
          tokenHash: credentialHash,
          participantId: next.id,
          sessionId: session.id,
          expiresAt: this.iso(this.now() + CREDENTIAL_TTL_MS),
          revokedAt: null,
        })
        return structuredClone(next)
      })
      const guest: GuestRecord = { sessionId: located.sessionId, participantId: participant.id, credential }
      this.guestStore.set('guest', JSON.stringify(guest))
      this.mode = 'guest'
      const session = this.requireSession(located.sessionId)
      return this.joinResult(session, participant)
    })
  }

  restoreGuest(sessionId: string) {
    return this.enqueue(async () => {
      const guest = this.readGuest()
      if (!guest || guest.sessionId !== sessionId) return null
      await this.assertCredential(guest.credential, guest.participantId)
      const participant = this.store.db.participants.find((item) => item.id === guest.participantId)
      if (!participant || participant.leftAt) {
        throw new ServiceError('removed', 'You were removed from this interview.', 403)
      }
      const session = this.requireSession(sessionId)
      if (participant.role === 'candidate' && (session.state === 'ended' || session.state === 'archived')) {
        throw new ServiceError('ended', 'This interview has ended.', 403)
      }
      this.mode = 'guest'
      return this.joinResult(session, participant)
    })
  }

  getCanvas(sessionId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      const session = this.requireSession(sessionId)
      this.assertCanView(actor.role, session)
      const doc = this.documentIn(this.store.db, sessionId)
      return {
        schemaVersion: doc.schemaVersion,
        cursor: doc.cursor,
        epoch: doc.epoch,
        document: structuredClone(doc.state),
      } satisfies CanvasBundle
    })
  }

  exportCanvas(sessionId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      const session = this.requireSession(sessionId)
      if (!can(actor.role, 'export', session)) {
        throw new ServiceError('forbidden', 'You cannot export this interview.', 403)
      }
      const doc = this.documentIn(this.store.db, sessionId)
      return JSON.stringify(
        {
          schemaVersion: SCHEMA_VERSION,
          sessionId: session.id,
          title: session.title,
          exportedAt: this.iso(),
          document: doc.state,
        },
        null,
        2,
      )
    })
  }

  connect(sessionId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      const session = this.requireSession(sessionId)
      this.assertCanView(actor.role, session)
      const participant = await this.ensureParticipant(sessionId, actor)
      const credential = actor.credential ?? (await this.issueCredential(sessionId, participant.id))
      return new MockCollaborationConnection(this, sessionId, participant, credential) as CollaborationConnection
    })
  }

  listAuditEvents(sessionId: string) {
    return this.enqueue(async () => {
      const actor = await this.resolveActor(sessionId)
      if (actor.role !== 'owner' && actor.role !== 'interviewer') {
        throw new ServiceError('forbidden', 'You cannot view the activity log.', 403)
      }
      return this.store.db.audit
        .filter((event) => event.sessionId === sessionId)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .map((event) => structuredClone(event))
    })
  }

  subscribe(listener: () => void) {
    return this.store.subscribe(listener)
  }

  readRoom(sessionId: string) {
    const session = this.store.db.sessions.find((item) => item.id === sessionId)
    const document = this.store.db.documents.find((item) => item.sessionId === sessionId)
    if (!session || !document) throw new ServiceError('not_found', 'This interview could not be found.', 404)
    return {
      session: structuredClone(session),
      document: structuredClone(document.state),
      cursor: document.cursor,
      epoch: document.epoch,
    }
  }

  announcePresence(
    sessionId: string,
    participant: Participant,
    connectionState: ConnectionStatus,
    update: { cursor?: { x: number; y: number } | null; selection?: string[]; laser?: { x: number; y: number } | null },
  ) {
    const current = this.store.listPresence(sessionId).find((item) => item.participantId === participant.id)
    const presence: Presence = {
      participantId: participant.id,
      displayName: participant.displayName,
      color: participant.color,
      role: participant.role,
      connectionState,
      cursor: update.cursor === undefined ? (current?.cursor ?? null) : update.cursor,
      selection: update.selection ?? current?.selection ?? [],
      laser: update.laser === undefined ? (current?.laser ?? null) : update.laser,
      lastSeen: this.now(),
    }
    this.store.upsertPresence(sessionId, presence)
    this.emitToSession(sessionId, { type: 'presence_update', presence })
    this.bus?.publish({ type: 'presence', origin: this.instanceId, sessionId, presence })
  }

  leavePresence(sessionId: string, participantId: string) {
    this.store.removePresence(sessionId, participantId)
    this.emitToSession(sessionId, { type: 'presence_left', participantId })
    this.bus?.publish({ type: 'presence-leave', origin: this.instanceId, sessionId, participantId })
  }

  applyClientOp(
    sessionId: string,
    participantId: string,
    credential: string,
    input: { clientOperationId: string; op: CanvasOp },
  ) {
    return this.enqueue(async () => {
      await this.assertCredential(credential, participantId)
      const validation = validateOp(input.op)
      if (validation) throw new ServiceError('invalid', validation)
      if (JSON.stringify(input.op).length > 500_000) {
        throw new ServiceError('too_large', 'That edit is too large.')
      }
      this.commit((db) => this.consumeRate(db, `ops:${participantId}`, this.limits.opsPerMinute, 60_000))
      const outcome = this.commit((db) => {
        const participant = db.participants.find((item) => item.id === participantId && item.sessionId === sessionId)
        if (!participant || participant.leftAt) {
          throw new ServiceError('removed', 'You were removed from this interview.', 403)
        }
        const session = this.sessionIn(db, sessionId)
        this.assertCanEdit(participant.role, session)
        const doc = this.documentIn(db, sessionId)
        const duplicate = db.operations.find(
          (item) => item.clientOperationId === input.clientOperationId && item.canvasDocumentId === doc.id,
        )
        if (duplicate) return { cursor: duplicate.cursor, duplicate: true }
        const applied = applyOp(doc.state, input.op)
        if (!applied.applied) {
          throw new ServiceError(
            'conflict',
            'The canvas changed and this edit could not be merged safely. The saved canvas was kept.',
            409,
          )
        }
        const limit = assertWithinLimits(applied.state)
        if (limit) throw new ServiceError('too_large', limit)
        doc.state = applied.state
        doc.epoch = applied.state.epoch
        doc.cursor += 1
        doc.updatedAt = this.iso()
        session.updatedAt = doc.updatedAt
        db.operations.push({
          id: createId(),
          canvasDocumentId: doc.id,
          actorId: participant.id,
          clientOperationId: input.clientOperationId,
          payload: input.op,
          serverReceivedAt: doc.updatedAt,
          cursor: doc.cursor,
        })
        return { cursor: doc.cursor, duplicate: false }
      })
      if (!outcome.duplicate) {
        const room = this.readRoom(sessionId)
        this.emitToSession(sessionId, {
          type: 'document_update',
          cursor: outcome.cursor,
          actorId: participantId,
          clientOperationId: input.clientOperationId,
          op: input.op.kind === 'patch' ? input.op : { kind: 'restore', epoch: room.epoch, state: room.document },
        })
      }
      return { cursor: outcome.cursor }
    })
  }

  adoptRemote(remote: Database) {
    const before = stableStringify(remote)
    const changed = this.store.adopt(remote)
    if (!changed || !this.persistence) return
    const merged = stableStringify(this.store.db)
    if (merged !== before) {
      this.persistence.save(this.store.db)
      this.publishDb()
    }
  }

  private onBus(event: SyncEvent) {
    if (event.origin === this.instanceId) return
    if (event.type === 'db' && this.persistence) {
      const remote = this.persistence.load()
      if (remote) this.adoptRemote(remote)
      return
    }
    if (event.type === 'presence' && event.sessionId && event.presence) {
      this.store.upsertPresence(event.sessionId, event.presence)
      this.emitToSession(event.sessionId, { type: 'presence_update', presence: event.presence })
    }
    if (event.type === 'presence-leave' && event.sessionId && event.participantId) {
      this.store.removePresence(event.sessionId, event.participantId)
      this.emitToSession(event.sessionId, { type: 'presence_left', participantId: event.participantId })
    }
  }

  private async lookupJoin(token: string): Promise<JoinPreview> {
    const tokenHash = await sha256Hex(token)
    this.commit((db) => this.consumeRate(db, `join:${tokenHash}`, this.limits.joinPerMinute, 60_000))
    const link = this.store.db.guestLinks.find((item) => item.tokenHash === tokenHash)
    if (!link) {
      throw new ServiceError('not_found', 'This link is not valid. Check the address with your interviewer.', 404)
    }
    const session = this.requireSession(link.sessionId)
    const blocked = this.joinBlocker(this.store.db, session, link)
    if (blocked) throw blocked
    return { sessionId: session.id, title: session.title, state: session.state }
  }

  private joinBlocker(db: Database, session: Session, link: GuestLink) {
    if (link.revokedAt) {
      return new ServiceError('revoked', 'This link has been revoked. Ask the interviewer for a new one.', 403)
    }
    if (link.expiresAt && Date.parse(link.expiresAt) <= this.now()) {
      return new ServiceError('expired', 'This link has expired.', 403)
    }
    if (link.maxUses !== null && link.useCount >= link.maxUses) {
      return new ServiceError('expired', 'This link has already been used.', 403)
    }
    if (session.state === 'ended') return new ServiceError('ended', 'This interview has ended.', 403)
    if (session.state === 'archived') return new ServiceError('archived', 'This interview has been archived.', 403)
    const active = db.participants.filter((item) => item.sessionId === session.id && !item.leftAt).length
    if (active >= session.maxParticipants) return new ServiceError('capacity', 'This interview is full.', 403)
    return null
  }

  private joinResult(session: Session, participant: Participant): JoinResult {
    return {
      sessionId: session.id,
      title: session.title,
      prompt: session.prompt,
      state: session.state,
      participant: structuredClone(participant),
      candidateEditingEnabled: session.candidateEditingEnabled,
      cursorVisibility: session.cursorVisibility,
      durationMinutes: session.durationMinutes,
      startedAt: session.startedAt,
    }
  }

  private async issueCredential(sessionId: string, participantId: string) {
    const credential = randomToken(32)
    const tokenHash = await sha256Hex(credential)
    this.commit((db) => {
      db.credentials.push({
        tokenHash,
        participantId,
        sessionId,
        expiresAt: this.iso(this.now() + CREDENTIAL_TTL_MS),
        revokedAt: null,
      })
    })
    return credential
  }

  private async ensureParticipant(
    sessionId: string,
    actor: { role: Role; userId: string | null; participantId: string; credential: string | null },
  ) {
    const existing = this.store.db.participants.find((item) => item.id === actor.participantId && !item.leftAt)
    if (existing) return structuredClone(existing)
    const user = actor.userId ? this.store.db.users.find((item) => item.id === actor.userId) : undefined
    if (!user) throw new ServiceError('unauthorized', 'Sign in to continue.', 401)
    return this.commit((db) => {
      const again = db.participants.find((item) => item.sessionId === sessionId && item.userId === user.id && !item.leftAt)
      if (again) return structuredClone(again)
      const created = this.makeParticipant(db, sessionId, user.displayName, actor.role, user.id, null)
      db.participants.push(created)
      return structuredClone(created)
    })
  }

  private async resolveActor(sessionId: string): Promise<{
    actorId: string
    role: Role
    participantId: string
    userId: string | null
    credential: string | null
  }> {
    if (this.mode === 'guest') {
      const guest = this.readGuest()
      if (!guest || guest.sessionId !== sessionId) {
        throw new ServiceError('forbidden', 'You do not have access to this interview.', 403)
      }
      await this.assertCredential(guest.credential, guest.participantId)
      const participant = this.store.db.participants.find((item) => item.id === guest.participantId)
      if (!participant || participant.leftAt) {
        throw new ServiceError('removed', 'You were removed from this interview.', 403)
      }
      return {
        actorId: participant.id,
        role: participant.role,
        participantId: participant.id,
        userId: null,
        credential: guest.credential,
      }
    }
    const user = this.requireCurrentUser()
    const membership = this.store.db.memberships.find((item) => item.sessionId === sessionId && item.userId === user.id)
    if (!membership) throw new ServiceError('forbidden', 'You do not have access to this interview.', 403)
    const participant = this.store.db.participants.find((item) => item.sessionId === sessionId && item.userId === user.id)
    if (participant?.leftAt) throw new ServiceError('removed', 'You were removed from this interview.', 403)
    return {
      actorId: participant?.id ?? user.id,
      role: membership.role,
      participantId: participant?.id ?? '',
      userId: user.id,
      credential: null,
    }
  }

  private async assertCredential(credential: string, participantId: string) {
    const tokenHash = await sha256Hex(credential)
    const row = this.store.db.credentials.find(
      (item) => item.tokenHash === tokenHash && item.participantId === participantId,
    )
    if (!row || row.revokedAt || Date.parse(row.expiresAt) <= this.now()) {
      throw new ServiceError('unauthorized', 'Your session expired. Join the interview again.', 401)
    }
  }

  private assertCanView(role: Role, session: Session) {
    if (!can(role, 'view_canvas', session)) {
      if (session.state === 'ended') throw new ServiceError('ended', 'This interview has ended.', 403)
      if (session.state === 'archived') throw new ServiceError('archived', 'This interview has been archived.', 403)
      throw new ServiceError('forbidden', 'You cannot view this interview.', 403)
    }
  }

  private assertCanEdit(role: Role, session: Session) {
    if (session.state === 'ended' || session.state === 'archived') {
      throw new ServiceError('ended', 'This interview is read-only.', 403)
    }
    if (role === 'candidate' && !session.candidateEditingEnabled) {
      throw new ServiceError('locked', 'The interviewer has locked candidate editing.', 403)
    }
    if (!can(role, 'edit_canvas', session)) {
      throw new ServiceError('forbidden', 'You cannot edit this canvas.', 403)
    }
  }

  private assertOwner(role: Role, action: string) {
    if (role !== 'owner') throw new ServiceError('forbidden', `Only the interview owner can ${action}.`, 403)
  }

  private async writeSnapshot(sessionId: string) {
    const doc = this.documentIn(this.store.db, sessionId)
    const checksum = await sha256Hex(stableStringify(doc.state))
    const snapshotId = createId()
    const storageKey = `snapshots/${snapshotId}`
    this.commit((db) => {
      const live = this.documentIn(db, sessionId)
      db.blobs[storageKey] = structuredClone(live.state)
      db.snapshots.push({
        id: snapshotId,
        canvasDocumentId: live.id,
        operationCursor: live.cursor,
        storageKey,
        checksum,
        createdAt: this.iso(),
      })
      live.latestSnapshotId = snapshotId
    })
    return snapshotId
  }

  private makeParticipant(
    db: Database,
    sessionId: string,
    displayName: string,
    role: Role,
    userId: string | null,
    guestLinkId: string | null,
  ): Participant {
    const now = this.iso()
    const index = db.participants.filter((item) => item.sessionId === sessionId).length
    return {
      id: createId(),
      sessionId,
      userId,
      guestLinkId,
      displayName,
      role,
      color: PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length]!,
      joinedAt: now,
      leftAt: null,
      updatedAt: now,
    }
  }

  private toListItem(session: Session, userId: string): SessionListItem {
    const role = this.store.db.memberships.find((item) => item.sessionId === session.id && item.userId === userId)?.role
    const names = this.store.db.participants
      .filter((item) => item.sessionId === session.id && !item.leftAt)
      .map((item) => item.displayName)
    return {
      id: session.id,
      title: session.title,
      state: session.state,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      scheduledAt: session.scheduledAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      participantNames: names,
      role: role ?? 'interviewer',
      hasActiveGuestLink: this.store.db.guestLinks.some(
        (link) => link.sessionId === session.id && link.roleGranted === 'candidate' && !link.revokedAt,
      ),
    }
  }

  private toDetail(
    session: Session,
    actor: { role: Role; participantId: string },
  ): SessionDetail {
    const vault = this.readVault()
    return {
      session: structuredClone(session),
      participants: this.store.db.participants
        .filter((item) => item.sessionId === session.id)
        .map((item) => structuredClone(item)),
      myRole: actor.role,
      myParticipantId: actor.participantId,
      links: this.store.db.guestLinks
        .filter((link) => link.sessionId === session.id)
        .map((link) => ({
          id: link.id,
          roleGranted: link.roleGranted,
          expiresAt: link.expiresAt,
          maxUses: link.maxUses,
          useCount: link.useCount,
          revokedAt: link.revokedAt,
          createdAt: link.createdAt,
          hasLocalToken: Boolean(vault.links[link.id]),
        })),
      snapshots: this.store.db.snapshots
        .filter((snapshot) => {
          const doc = this.store.db.documents.find((item) => item.sessionId === session.id)
          return doc && snapshot.canvasDocumentId === doc.id
        })
        .map((snapshot) => ({
          id: snapshot.id,
          operationCursor: snapshot.operationCursor,
          createdAt: snapshot.createdAt,
          checksum: snapshot.checksum,
        })),
    }
  }

  private addAudit(db: Database, sessionId: string, actorId: string, type: string, detail: string) {
    const event: AuditEvent = {
      id: createId(),
      sessionId,
      actorId,
      type,
      at: this.iso(),
      detail,
    }
    db.audit.push(event)
  }

  private consumeRate(db: Database, key: string, limit: number, windowMs: number) {
    const now = this.now()
    const cutoff = now - windowMs
    db.rateEvents = db.rateEvents.filter((event) => event.at >= cutoff)
    const count = db.rateEvents.filter((event) => event.key === key).length
    if (count >= limit) {
      throw new ServiceError('rate_limited', 'Too many attempts. Wait a moment and try again.', 429)
    }
    db.rateEvents.push({ key, at: now })
  }

  private currentUser(): User | null {
    const userId = this.userStore.get('userId')
    if (!userId) return null
    const user = this.store.db.users.find((item) => item.id === userId)
    return user ? structuredClone(user) : null
  }

  private requireCurrentUser() {
    const user = this.currentUser()
    if (!user) throw new ServiceError('unauthorized', 'Sign in to continue.', 401)
    return user
  }

  private requireSession(sessionId: string) {
    const session = this.store.db.sessions.find((item) => item.id === sessionId)
    if (!session) throw new ServiceError('not_found', 'This interview could not be found.', 404)
    return session
  }

  private sessionIn(db: Database, sessionId: string) {
    const session = db.sessions.find((item) => item.id === sessionId)
    if (!session) throw new ServiceError('not_found', 'This interview could not be found.', 404)
    return session
  }

  private documentIn(db: Database, sessionId: string) {
    const document = db.documents.find((item) => item.sessionId === sessionId)
    if (!document) throw new ServiceError('not_found', 'This canvas could not be found.', 404)
    return document
  }

  private readGuest(): GuestRecord | null {
    const raw = this.guestStore.get('guest')
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as GuestRecord
      if (!parsed.sessionId || !parsed.participantId || !parsed.credential) return null
      return parsed
    } catch {
      return null
    }
  }

  private readVault(): VaultFile {
    const raw = this.vaultStore.get('links')
    if (!raw) return { links: {} }
    try {
      const parsed = JSON.parse(raw) as VaultFile
      return { links: parsed.links ?? {} }
    } catch {
      return { links: {} }
    }
  }

  private writeVault(vault: VaultFile) {
    this.vaultStore.set('links', JSON.stringify(vault))
  }

  private emitToSession(sessionId: string, event: ServerEvent) {
    this.store.emit({ type: 'server', sessionId, event })
  }

  private broadcastRoom(sessionId: string) {
    const room = this.readRoom(sessionId)
    this.emitToSession(sessionId, {
      type: 'canvas_replaced',
      document: room.document,
      cursor: room.cursor,
      epoch: room.epoch,
      session: room.session,
    })
  }

  private publishDb() {
    this.bus?.publish({ type: 'db', origin: this.instanceId })
  }

  private commit<T>(fn: (db: Database) => T): T {
    const result = this.store.mutate(fn)
    this.publishDb()
    return result
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private iso(at = this.now()) {
    return new Date(at).toISOString()
  }
}

export function createMockInterviewService(options?: MockServiceOptions) {
  return new MockInterviewService(options)
}

function normalizeDuration(value: number | null | undefined) {
  if (value === undefined || value === null || value === 0) return null
  if (!Number.isFinite(value) || value < 5 || value > 240) {
    throw new ServiceError('invalid', 'Duration must be between 5 and 240 minutes.')
  }
  return Math.round(value)
}

function normalizeSchedule(value: string | null | undefined) {
  if (value === undefined || value === null || value === '') return null
  if (Number.isNaN(Date.parse(value))) throw new ServiceError('invalid', 'Scheduled time is not valid.')
  return new Date(value).toISOString()
}
