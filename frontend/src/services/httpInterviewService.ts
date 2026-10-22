import type { CanvasOp } from '../canvas/model'
import type {
  ActorMode,
  CanvasBundle,
  CollaborationConnection,
  ConnectionStatus,
  CreateLinkInput,
  CreateSessionInput,
  IssuedLink,
  JoinPreview,
  JoinResult,
  ServerEvent,
  SessionDetail,
  SessionListItem,
  UpdateSessionInput,
} from './api'
import type { InterviewService } from './api'
import type { AuditEvent, Session, User } from './domain'
import { ServiceError } from './errors'
import type { KeyValueStore } from './sharedStore'

interface VaultEntry {
  token: string
  sessionId: string
  role: string
}

interface GuestSession {
  token: string
  sessionId: string
}

interface HttpOptions {
  origin?: string
  userStore: KeyValueStore
  guestStore: KeyValueStore
  vaultStore: KeyValueStore
  fetchImpl?: typeof fetch
  webSocket?: typeof WebSocket
}

type AuthKind = 'actor' | 'user' | 'guest' | 'none'

const OPEN_TIMEOUT_MS = 8000
const ACK_TIMEOUT_MS = 8000

export class HttpInterviewService implements InterviewService {
  private readonly origin: string
  private readonly fetchImpl: typeof fetch
  private readonly Socket: typeof WebSocket
  private readonly listeners = new Set<() => void>()
  private mode: ActorMode = 'user'
  private channel: BroadcastChannel | null = null

  constructor(private readonly options: HttpOptions) {
    this.origin = (options.origin ?? '').replace(/\/$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.Socket = options.webSocket ?? WebSocket
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel('lattice.api.v1')
        this.channel.addEventListener('message', () => this.emitLocal())
      }
    } catch {
      this.channel = null
    }
  }

  requestMagicLink(email: string) {
    return this.request<{ verificationPath: string }>('POST', '/auth/magic-links', { email }, { auth: 'none' })
  }

  async completeMagicLink(token: string) {
    const { data, accessToken } = await this.send<User>('POST', '/auth/magic-links/complete', { token }, { auth: 'none' })
    if (!accessToken) throw new ServiceError('unauthorized', 'Sign in to continue.', 401)
    this.options.userStore.set('token', accessToken)
    this.mode = 'user'
    this.notify()
    return data
  }

  async getCurrentUser() {
    if (!this.options.userStore.get('token')) return null
    try {
      return await this.request<User | null>('GET', '/me', undefined, { auth: 'user' })
    } catch (error) {
      if (error instanceof ServiceError && error.status === 401) {
        this.options.userStore.remove('token')
        return null
      }
      throw error
    }
  }

  async signOut() {
    try {
      if (this.options.userStore.get('token')) {
        await this.request<void>('POST', '/auth/sign-out', undefined, { auth: 'user' })
      }
    } finally {
      this.options.userStore.remove('token')
      this.mode = 'user'
      this.notify()
    }
  }

  setActorMode(mode: ActorMode) {
    this.mode = mode
  }

  listSessions() {
    return this.request<SessionListItem[]>('GET', '/sessions', undefined, { auth: 'user' })
  }

  async createSession(input: CreateSessionInput) {
    const session = await this.request<Session>('POST', '/sessions', input, { auth: 'user' })
    this.notify()
    return session
  }

  async getSession(sessionId: string) {
    const detail = await this.request<SessionDetail>('GET', `/sessions/${sessionId}`)
    const vault = this.readVault()
    return {
      ...detail,
      links: detail.links.map((link) => ({
        ...link,
        hasLocalToken: vault[link.id]?.sessionId === sessionId && Boolean(vault[link.id]?.token),
      })),
    }
  }

  async updateSession(sessionId: string, patch: UpdateSessionInput) {
    const session = await this.request<Session>('PATCH', `/sessions/${sessionId}`, patch)
    this.notify()
    return session
  }

  startSession(sessionId: string) {
    return this.mutate<Session>('POST', `/sessions/${sessionId}/start`)
  }

  endSession(sessionId: string) {
    return this.mutate<Session>('POST', `/sessions/${sessionId}/end`)
  }

  archiveSession(sessionId: string) {
    return this.mutate<Session>('POST', `/sessions/${sessionId}/archive`)
  }

  duplicateSession(sessionId: string) {
    return this.mutate<Session>('POST', `/sessions/${sessionId}/duplicate`, undefined, { auth: 'user' })
  }

  clearCanvas(sessionId: string) {
    return this.mutate<{ snapshotId: string }>('POST', `/sessions/${sessionId}/canvas/clear`)
  }

  async restoreSnapshot(sessionId: string, snapshotId: string) {
    await this.mutate<void>('POST', `/sessions/${sessionId}/snapshots/${snapshotId}/restore`)
  }

  async createGuestLink(sessionId: string, input?: CreateLinkInput) {
    const issued = await this.request<IssuedLink>('POST', `/sessions/${sessionId}/guest-links`, input ?? {}, { auth: 'user' })
    const vault = this.readVault()
    for (const [linkId, entry] of Object.entries(vault)) {
      if (entry.sessionId === sessionId && entry.role === issued.roleGranted) delete vault[linkId]
    }
    vault[issued.id] = { token: issued.token, sessionId, role: issued.roleGranted }
    this.writeVault(vault)
    this.notify()
    return issued
  }

  async revokeGuestLink(sessionId: string, linkId: string) {
    await this.request<void>('DELETE', `/sessions/${sessionId}/guest-links/${linkId}`, undefined, { auth: 'user' })
    const vault = this.readVault()
    delete vault[linkId]
    this.writeVault(vault)
    this.notify()
  }

  getGuestLinkPath(sessionId: string, linkId: string) {
    const entry = this.readVault()[linkId]
    if (!entry || entry.sessionId !== sessionId || !entry.token) return Promise.resolve(null)
    return Promise.resolve(`/join/${entry.token}`)
  }

  async inviteByEmail(sessionId: string, input: { email: string; role: 'interviewer' | 'observer' }) {
    await this.request<void>('POST', `/sessions/${sessionId}/invites`, input, { auth: 'user' })
    this.notify()
  }

  async removeParticipant(sessionId: string, participantId: string) {
    await this.request<void>('DELETE', `/sessions/${sessionId}/participants/${participantId}`, undefined, { auth: 'user' })
    this.notify()
  }

  setCandidateEditing(sessionId: string, enabled: boolean) {
    return this.mutate<Session>('PUT', `/sessions/${sessionId}/candidate-editing`, { enabled }, { auth: 'user' })
  }

  setCursorVisibility(sessionId: string, visible: boolean) {
    return this.mutate<Session>('PUT', `/sessions/${sessionId}/cursor-visibility`, { visible }, { auth: 'user' })
  }

  previewJoin(token: string) {
    return this.request<JoinPreview>('GET', `/join/${encodeURIComponent(token)}`, undefined, { auth: 'none' })
  }

  async joinWithToken(token: string, input: { displayName: string; acceptPrivacy: boolean }) {
    const { data, accessToken } = await this.send<JoinResult>('POST', `/join/${encodeURIComponent(token)}`, input, { auth: 'none' })
    if (!accessToken) throw new ServiceError('unauthorized', 'Sign in to continue.', 401)
    this.writeGuest({ token: accessToken, sessionId: data.sessionId })
    this.mode = 'guest'
    return data
  }

  restoreGuest(sessionId: string) {
    const guest = this.readGuest()
    if (!guest || guest.sessionId !== sessionId) return Promise.resolve(null)
    return this.request<JoinResult | null>('POST', `/sessions/${sessionId}/guest`, undefined, { auth: 'guest' })
  }

  getCanvas(sessionId: string) {
    return this.request<CanvasBundle>('GET', `/sessions/${sessionId}/canvas`)
  }

  async exportCanvas(sessionId: string) {
    const payload = await this.request<unknown>('GET', `/sessions/${sessionId}/export`)
    return JSON.stringify(payload, null, 2)
  }

  connect(sessionId: string) {
    const token = this.actorToken()
    if (!token) return Promise.reject(new ServiceError('unauthorized', 'Sign in to continue.', 401))
    const url = `${this.wsOrigin()}/v1/sessions/${encodeURIComponent(sessionId)}/collaboration?access_token=${encodeURIComponent(token)}&actor=${this.mode}`
    return new HttpCollaborationConnection(url, this.Socket).open()
  }

  listAuditEvents(sessionId: string) {
    return this.request<AuditEvent[]>('GET', `/sessions/${sessionId}/audit`)
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private mutate<T>(method: string, path: string, body?: unknown, options?: { auth?: AuthKind }) {
    return this.request<T>(method, path, body, options).then((data) => {
      this.notify()
      return data
    })
  }

  private request<T>(method: string, path: string, body?: unknown, options?: { auth?: AuthKind }) {
    return this.send<T>(method, path, body, options).then((result) => result.data)
  }

  private async send<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { auth?: AuthKind },
  ): Promise<{ data: T; accessToken: string | null }> {
    const headers = new Headers()
    const auth = options?.auth ?? 'actor'
    const token = this.tokenFor(auth)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (auth === 'guest' || (auth === 'actor' && this.mode === 'guest')) headers.set('X-Lattice-Actor', 'guest')
    let payload: string | undefined
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json')
      payload = JSON.stringify(body)
    }
    let response: Response
    try {
      response = await this.fetchImpl.call(globalThis, `${this.origin}/v1${path}`, { method, headers, body: payload })
    } catch {
      throw new ServiceError('error', 'The API could not be reached.', 0)
    }
    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        throw new ServiceError('error', 'The API returned an unexpected response.', response.status)
      }
    }
    if (!response.ok) {
      const record = parsed && typeof parsed === 'object' ? (parsed as { code?: string; message?: string }) : {}
      throw new ServiceError(record.code || 'error', record.message || 'The request failed.', response.status)
    }
    return { data: parsed as T, accessToken: response.headers.get('X-Access-Token') }
  }

  private tokenFor(auth: AuthKind) {
    if (auth === 'none') return null
    if (auth === 'user') return this.options.userStore.get('token')
    if (auth === 'guest') return this.readGuest()?.token ?? null
    return this.actorToken()
  }

  private actorToken() {
    return this.mode === 'guest' ? (this.readGuest()?.token ?? null) : this.options.userStore.get('token')
  }

  private wsOrigin() {
    if (this.origin) {
      const url = new URL(this.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      return url.origin
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}`
  }

  private readVault() {
    const raw = this.options.vaultStore.get('links')
    if (!raw) return {} as Record<string, VaultEntry>
    try {
      const parsed = JSON.parse(raw) as Record<string, VaultEntry>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  private writeVault(vault: Record<string, VaultEntry>) {
    this.options.vaultStore.set('links', JSON.stringify(vault))
  }

  private readGuest(): GuestSession | null {
    const raw = this.options.guestStore.get('session')
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as GuestSession
      if (!parsed?.token || !parsed.sessionId) return null
      return parsed
    } catch {
      return null
    }
  }

  private writeGuest(guest: GuestSession) {
    this.options.guestStore.set('session', JSON.stringify(guest))
  }

  private notify() {
    this.emitLocal()
    this.channel?.postMessage('changed')
  }

  private emitLocal() {
    for (const listener of this.listeners) listener()
  }
}

class HttpCollaborationConnection implements CollaborationConnection {
  private socket: WebSocket | null = null
  private generation = 0
  private readonly listeners = new Set<(event: ServerEvent) => void>()
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>()
  private readonly buffer: ServerEvent[] = []
  private readonly pending = new Map<
    string,
    {
      op: { clientOperationId: string; op: CanvasOp }
      resolve: (value: { cursor: number; queued: boolean }) => void
      reject: (error: Error) => void
      timer: number
    }
  >()
  private status: ConnectionStatus = 'reconnecting'
  private closed = false
  private openedOnce = false
  private openSettled = false
  private resolveOpened: (() => void) | null = null
  private rejectOpened: ((error: Error) => void) | null = null
  private readonly opened: Promise<void>
  private onUnload: (() => void) | null = null

  constructor(
    private readonly url: string,
    private readonly Socket: typeof WebSocket,
  ) {
    this.opened = new Promise((resolve, reject) => {
      this.resolveOpened = resolve
      this.rejectOpened = reject
    })
  }

  open() {
    this.connectSocket()
    if (typeof window !== 'undefined') {
      this.onUnload = () => this.close()
      window.addEventListener('beforeunload', this.onUnload)
    }
    window.setTimeout(() => {
      if (!this.openSettled) {
        this.finishOpen(new ServiceError('error', 'The live connection could not be opened.', 0))
        this.close()
      }
    }, OPEN_TIMEOUT_MS)
    return this.opened.then(() => this as CollaborationConnection)
  }

  private connectSocket() {
    const generation = ++this.generation
    const socket = new this.Socket(this.url)
    this.socket = socket
    socket.onopen = () => {
      if (generation !== this.generation) return
      this.openedOnce = true
      this.setStatus('connected')
      this.finishOpen()
      this.flush()
    }
    socket.onmessage = (event) => {
      if (generation !== this.generation) return
      try {
        this.handle(JSON.parse(String(event.data)) as ServerEvent)
      } catch {
        /* Ignore a frame that is not JSON. */
      }
    }
    socket.onclose = (event) => {
      if (generation !== this.generation || this.closed) return
      if (!this.openedOnce) {
        this.closed = true
        const denied = event.code === 1008
        this.setStatus('offline')
        this.finishOpen(
          new ServiceError(
            denied ? 'unauthorized' : 'error',
            denied ? 'Sign in to continue.' : 'The live connection could not be opened.',
            denied ? 401 : 0,
          ),
        )
        return
      }
      this.setStatus('reconnecting')
      window.setTimeout(() => {
        if (!this.closed) this.connectSocket()
      }, 1000)
    }
  }

  subscribe(listener: (event: ServerEvent) => void) {
    this.listeners.add(listener)
    const queued = this.buffer.splice(0)
    for (const event of queued) listener(event)
    return () => this.listeners.delete(listener)
  }

  onStatus(listener: (status: ConnectionStatus) => void) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  getStatus() {
    return this.status
  }

  sendDocumentUpdate(input: { clientOperationId: string; op: CanvasOp }) {
    if (this.closed) return Promise.reject(new ServiceError('invalid', 'The connection is closed.'))
    return new Promise<{ cursor: number; queued: boolean }>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(input.clientOperationId)
        reject(new ServiceError('error', 'The server did not confirm this edit.', 0))
      }, ACK_TIMEOUT_MS)
      this.pending.set(input.clientOperationId, { op: input, resolve, reject, timer })
      this.flush()
    })
  }

  sendPresence(update: {
    cursor?: { x: number; y: number } | null
    selection?: string[]
    laser?: { x: number; y: number } | null
  }) {
    if (this.socket?.readyState !== this.Socket.OPEN) return
    this.socket.send(JSON.stringify({ type: 'presence_update', ...update }))
  }

  ping() {
    if (this.socket?.readyState !== this.Socket.OPEN) return
    this.socket.send(JSON.stringify({ type: 'ping' }))
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.generation += 1
    this.finishOpen(new ServiceError('invalid', 'The connection is closed.'))
    for (const waiter of this.pending.values()) {
      window.clearTimeout(waiter.timer)
      waiter.reject(new ServiceError('invalid', 'The connection is closed.'))
    }
    this.pending.clear()
    this.socket?.close()
    this.socket = null
    if (this.onUnload && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.onUnload)
    }
  }

  private flush() {
    const socket = this.socket
    if (socket?.readyState !== this.Socket.OPEN) return
    for (const waiter of [...this.pending.values()]) {
      socket.send(
        JSON.stringify({
          type: 'document_update',
          clientOperationId: waiter.op.clientOperationId,
          op: waiter.op.op,
        }),
      )
    }
  }

  private handle(event: ServerEvent) {
    if (event.type === 'document_update') {
      const waiter = this.pending.get(event.clientOperationId)
      if (waiter) {
        window.clearTimeout(waiter.timer)
        this.pending.delete(event.clientOperationId)
        waiter.resolve({ cursor: event.cursor, queued: false })
      }
    }
    if (event.type === 'rejected') {
      const waiter = this.pending.values().next().value
      if (waiter) {
        window.clearTimeout(waiter.timer)
        this.pending.delete(waiter.op.clientOperationId)
        waiter.reject(new ServiceError(event.code, event.message))
      }
    }
    if (this.listeners.size === 0) this.buffer.push(event)
    else for (const listener of this.listeners) listener(event)
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }

  private finishOpen(error?: Error) {
    if (this.openSettled) return
    this.openSettled = true
    if (error) this.rejectOpened?.(error)
    else this.resolveOpened?.()
  }
}
