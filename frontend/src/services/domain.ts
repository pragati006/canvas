import type { CanvasOp, DocState } from '../canvas/model'

export type SessionState = 'draft' | 'live' | 'ended' | 'archived'
export type Role = 'owner' | 'interviewer' | 'candidate' | 'observer'
export type GuestRole = 'candidate' | 'observer'

export interface User {
  id: string
  email: string
  displayName: string
  organizationId: string | null
  createdAt: string
}

export interface Session {
  id: string
  ownerUserId: string
  title: string
  prompt: string
  state: SessionState
  candidateEditingEnabled: boolean
  cursorVisibility: boolean
  durationMinutes: number | null
  scheduledAt: string | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  updatedAt: string
  maxParticipants: number
}

export interface Membership {
  sessionId: string
  userId: string
  role: 'owner' | 'interviewer' | 'observer'
  createdAt: string
  updatedAt: string
}

export interface Invite {
  id: string
  sessionId: string
  email: string
  role: 'interviewer' | 'observer'
  createdAt: string
}

export interface GuestLink {
  id: string
  sessionId: string
  tokenHash: string
  roleGranted: GuestRole
  expiresAt: string | null
  maxUses: number | null
  useCount: number
  revokedAt: string | null
  createdAt: string
}

export interface Participant {
  id: string
  sessionId: string
  userId: string | null
  guestLinkId: string | null
  displayName: string
  role: Role
  color: string
  joinedAt: string
  leftAt: string | null
  updatedAt: string
}

export interface CanvasRecord {
  id: string
  sessionId: string
  schemaVersion: number
  latestSnapshotId: string | null
  cursor: number
  epoch: number
  state: DocState
  updatedAt: string
}

export interface Snapshot {
  id: string
  canvasDocumentId: string
  operationCursor: number
  storageKey: string
  checksum: string
  createdAt: string
}

export interface OperationRecord {
  id: string
  canvasDocumentId: string
  actorId: string
  clientOperationId: string
  payload: CanvasOp
  serverReceivedAt: string
  cursor: number
}

export interface AuditEvent {
  id: string
  sessionId: string
  actorId: string
  type: string
  at: string
  detail: string
}

export interface Credential {
  tokenHash: string
  participantId: string
  sessionId: string
  expiresAt: string
  revokedAt: string | null
}

export interface MagicLink {
  id: string
  tokenHash: string
  email: string
  expiresAt: string
  usedAt: string | null
}

export interface Database {
  revision: number
  users: User[]
  magicLinks: MagicLink[]
  sessions: Session[]
  memberships: Membership[]
  invites: Invite[]
  guestLinks: GuestLink[]
  participants: Participant[]
  documents: CanvasRecord[]
  operations: OperationRecord[]
  snapshots: Snapshot[]
  blobs: Record<string, DocState>
  audit: AuditEvent[]
  credentials: Credential[]
  rateEvents: Array<{ key: string; at: number }>
}

export function emptyDatabase(): Database {
  return {
    revision: 0,
    users: [],
    magicLinks: [],
    sessions: [],
    memberships: [],
    invites: [],
    guestLinks: [],
    participants: [],
    documents: [],
    operations: [],
    snapshots: [],
    blobs: {},
    audit: [],
    credentials: [],
    rateEvents: [],
  }
}
