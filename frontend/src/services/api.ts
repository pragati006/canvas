import type { CanvasOp, DocState } from '../canvas/model'
import type { AuditEvent, GuestRole, Participant, Role, Session, SessionState, User } from './domain'

export type ActorMode = 'user' | 'guest'
export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline'

export interface Presence {
  participantId: string
  displayName: string
  color: string
  role: Role
  connectionState: ConnectionStatus
  cursor: { x: number; y: number } | null
  selection: string[]
  laser: { x: number; y: number } | null
  lastSeen: number
}

export interface SessionListItem {
  id: string
  title: string
  state: SessionState
  createdAt: string
  updatedAt: string
  scheduledAt: string | null
  startedAt: string | null
  endedAt: string | null
  participantNames: string[]
  role: Role
  hasActiveGuestLink: boolean
}

export interface GuestLinkPublic {
  id: string
  roleGranted: GuestRole
  expiresAt: string | null
  maxUses: number | null
  useCount: number
  revokedAt: string | null
  createdAt: string
  hasLocalToken: boolean
}

export interface SnapshotInfo {
  id: string
  operationCursor: number
  createdAt: string
  checksum: string
}

export interface SessionDetail {
  session: Session
  participants: Participant[]
  myRole: Role
  myParticipantId: string
  links: GuestLinkPublic[]
  snapshots: SnapshotInfo[]
}

export interface CreateSessionInput {
  title: string
  prompt?: string
  scheduledAt?: string | null
  durationMinutes?: number | null
  initialDocument?: DocState
}

export interface UpdateSessionInput {
  title?: string
  prompt?: string
  scheduledAt?: string | null
  durationMinutes?: number | null
  maxParticipants?: number
}

export interface CreateLinkInput {
  roleGranted?: GuestRole
  expiresAt?: string | null
  maxUses?: number | null
}

export interface IssuedLink {
  id: string
  sessionId: string
  roleGranted: GuestRole
  expiresAt: string | null
  maxUses: number | null
  createdAt: string
  token: string
  path: string
}

export interface JoinPreview {
  sessionId: string
  title: string
  state: SessionState
}

export interface JoinResult {
  sessionId: string
  title: string
  prompt: string
  state: SessionState
  participant: Participant
  candidateEditingEnabled: boolean
  cursorVisibility: boolean
  durationMinutes: number | null
  startedAt: string | null
}

export interface CanvasBundle {
  schemaVersion: number
  cursor: number
  epoch: number
  document: DocState
}

export type ServerEvent =
  | {
      type: 'room_joined'
      document: DocState
      cursor: number
      epoch: number
      participants: Presence[]
      session: Session
    }
  | { type: 'document_update'; cursor: number; actorId: string; clientOperationId: string; op: CanvasOp }
  | { type: 'canvas_replaced'; document: DocState; cursor: number; epoch: number; session: Session }
  | { type: 'presence_update'; presence: Presence }
  | { type: 'presence_left'; participantId: string }
  | { type: 'permission_changed'; candidateEditingEnabled: boolean; cursorVisibility: boolean }
  | { type: 'session_ended'; session: Session }
  | { type: 'participant_removed'; participantId: string }
  | { type: 'rejected'; code: string; message: string; document: DocState }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' }

export interface CollaborationConnection {
  subscribe(listener: (event: ServerEvent) => void): () => void
  onStatus(listener: (status: ConnectionStatus) => void): () => void
  getStatus(): ConnectionStatus
  sendDocumentUpdate(input: { clientOperationId: string; op: CanvasOp }): Promise<{ cursor: number; queued: boolean }>
  sendPresence(update: {
    cursor?: { x: number; y: number } | null
    selection?: string[]
    laser?: { x: number; y: number } | null
  }): void
  ping(): void
  close(): void
}

export interface InterviewService {
  requestMagicLink(email: string): Promise<{ verificationPath: string }>
  completeMagicLink(token: string): Promise<User>
  getCurrentUser(): Promise<User | null>
  signOut(): Promise<void>
  setActorMode(mode: ActorMode): void
  listSessions(): Promise<SessionListItem[]>
  createSession(input: CreateSessionInput): Promise<Session>
  getSession(sessionId: string): Promise<SessionDetail>
  updateSession(sessionId: string, patch: UpdateSessionInput): Promise<Session>
  startSession(sessionId: string): Promise<Session>
  endSession(sessionId: string): Promise<Session>
  archiveSession(sessionId: string): Promise<Session>
  duplicateSession(sessionId: string): Promise<Session>
  clearCanvas(sessionId: string): Promise<{ snapshotId: string }>
  restoreSnapshot(sessionId: string, snapshotId: string): Promise<void>
  createGuestLink(sessionId: string, input?: CreateLinkInput): Promise<IssuedLink>
  revokeGuestLink(sessionId: string, linkId: string): Promise<void>
  getGuestLinkPath(sessionId: string, linkId: string): Promise<string | null>
  inviteByEmail(sessionId: string, input: { email: string; role: 'interviewer' | 'observer' }): Promise<void>
  removeParticipant(sessionId: string, participantId: string): Promise<void>
  setCandidateEditing(sessionId: string, enabled: boolean): Promise<Session>
  setCursorVisibility(sessionId: string, visible: boolean): Promise<Session>
  previewJoin(token: string): Promise<JoinPreview>
  joinWithToken(token: string, input: { displayName: string; acceptPrivacy: boolean }): Promise<JoinResult>
  restoreGuest(sessionId: string): Promise<JoinResult | null>
  getCanvas(sessionId: string): Promise<CanvasBundle>
  exportCanvas(sessionId: string): Promise<string>
  connect(sessionId: string): Promise<CollaborationConnection>
  listAuditEvents(sessionId: string): Promise<AuditEvent[]>
  subscribe(listener: () => void): () => void
}
