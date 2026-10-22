import { mergeDoc } from '../canvas/model'
import type { Database, GuestLink, Membership, Participant, Session } from './domain'

const STATE_RANK = { draft: 0, live: 1, ended: 2, archived: 3 } as const

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function unionById<T extends { id: string }>(left: T[], right: T[], merge?: (a: T, b: T) => T): T[] {
  const map = byId(left)
  for (const item of right) {
    const existing = map.get(item.id)
    map.set(item.id, existing && merge ? merge(existing, item) : existing ?? item)
  }
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
}

function mergeSession(a: Session, b: Session): Session {
  const primary = a.updatedAt >= b.updatedAt ? a : b
  const state = STATE_RANK[a.state] >= STATE_RANK[b.state] ? a.state : b.state
  return {
    ...primary,
    state,
    startedAt: a.startedAt ?? b.startedAt,
    endedAt: a.endedAt ?? b.endedAt,
    candidateEditingEnabled: state === 'ended' || state === 'archived' ? false : primary.candidateEditingEnabled,
  }
}

function mergeMembership(a: Membership, b: Membership): Membership {
  return a.updatedAt >= b.updatedAt ? a : b
}

function mergeParticipant(a: Participant, b: Participant): Participant {
  return a.updatedAt >= b.updatedAt ? a : b
}

function mergeLink(a: GuestLink, b: GuestLink): GuestLink {
  const revokedAt = a.revokedAt && b.revokedAt ? (a.revokedAt <= b.revokedAt ? a.revokedAt : b.revokedAt) : a.revokedAt ?? b.revokedAt
  return {
    ...(a.createdAt >= b.createdAt ? a : b),
    useCount: Math.max(a.useCount, b.useCount),
    revokedAt,
  }
}

export function mergeDbSnapshot(left: Database, right: Database): Database {
  const documents = unionById(left.documents, right.documents, (a, b) => {
    const state = mergeDoc(a.state, b.state)
    return {
      ...a,
      ...b,
      state,
      epoch: state.epoch,
      cursor: Math.max(a.cursor, b.cursor),
      latestSnapshotId: a.updatedAt >= b.updatedAt ? a.latestSnapshotId : b.latestSnapshotId,
      updatedAt: a.updatedAt >= b.updatedAt ? a.updatedAt : b.updatedAt,
    }
  })
  const rateEvents = [...left.rateEvents, ...right.rateEvents]
    .filter((event, index, all) => all.findIndex((item) => item.key === event.key && item.at === event.at) === index)
    .sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1))
    .slice(-1000)

  return {
    revision: Math.max(left.revision, right.revision),
    users: unionById(left.users, right.users),
    magicLinks: unionById(left.magicLinks, right.magicLinks, (a, b) => ({
      ...a,
      ...b,
      usedAt: a.usedAt ?? b.usedAt,
    })),
    sessions: unionById(left.sessions, right.sessions, mergeSession),
    memberships: unionMemberships(left.memberships, right.memberships),
    invites: unionById(left.invites, right.invites),
    guestLinks: unionById(left.guestLinks, right.guestLinks, mergeLink),
    participants: unionById(left.participants, right.participants, mergeParticipant),
    documents,
    operations: unionById(left.operations, right.operations),
    snapshots: unionById(left.snapshots, right.snapshots),
    blobs: { ...left.blobs, ...right.blobs },
    audit: unionById(left.audit, right.audit),
    credentials: unionCredentials(left.credentials, right.credentials),
    rateEvents,
  }
}

function unionMemberships(left: Membership[], right: Membership[]): Membership[] {
  const map = new Map<string, Membership>()
  for (const item of [...left, ...right]) {
    const key = `${item.sessionId}:${item.userId}`
    const existing = map.get(key)
    map.set(key, existing ? mergeMembership(existing, item) : item)
  }
  return [...map.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.userId.localeCompare(b.userId))
}

function unionCredentials(left: Database['credentials'], right: Database['credentials']): Database['credentials'] {
  const map = new Map<string, Database['credentials'][number]>()
  for (const item of [...left, ...right]) {
    const existing = map.get(item.tokenHash)
    if (!existing) map.set(item.tokenHash, item)
    else {
      map.set(item.tokenHash, {
        ...existing,
        revokedAt: existing.revokedAt ?? item.revokedAt,
      })
    }
  }
  return [...map.values()].sort((a, b) => (a.tokenHash < b.tokenHash ? -1 : 1))
}
