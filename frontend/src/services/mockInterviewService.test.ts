import { describe, expect, it } from 'vitest'
import { addElements, materialize } from '../canvas/model'
import { sha256Hex } from '../lib/crypto'
import { stableStringify } from '../lib/format'
import type { ServerEvent } from './api'
import { ServiceError } from './errors'
import {
  MockCollaborationConnection,
  createMockInterviewService,
  type MockInterviewService,
} from './mockInterviewService'
import { MemoryBus, MemoryKv, MemoryPersistence, SharedStore } from './sharedStore'

function clock(start = Date.parse('2026-08-03T15:00:00.000Z')) {
  let now = start
  return {
    now: () => now,
    advance(ms: number) {
      now += ms
    },
  }
}

async function signIn(service: MockInterviewService, email = 'ada@lattice.test') {
  const issued = await service.requestMagicLink(email)
  const token = new URL(issued.verificationPath, 'http://localhost').searchParams.get('token')
  if (!token) throw new Error('missing magic token')
  return service.completeMagicLink(token)
}

async function openedSession(service: MockInterviewService, prompt = 'Design a feed.') {
  await signIn(service)
  return service.createSession({ title: 'News feed', prompt })
}

async function listen(connection: MockCollaborationConnection) {
  const events: ServerEvent[] = []
  connection.subscribe((event) => events.push(event))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return events
}

describe('mock interview service', () => {
  it('stores only a hash of a high-entropy guest token', async () => {
    const service = createMockInterviewService({ now: clock().now })
    const session = await openedSession(service)
    const link = await service.createGuestLink(session.id)
    expect(link.token).toHaveLength(64)
    expect(link.path).toBe(`/join/${link.token}`)
    const database = service.debugDatabase()
    expect(JSON.stringify(database)).not.toContain(link.token)
    expect(database.guestLinks[0]?.tokenHash).toBe(await sha256Hex(link.token))
    const preview = await service.previewJoin(link.token)
    expect(preview).toEqual({ sessionId: session.id, title: 'News feed', state: 'draft' })
    expect(JSON.stringify(preview)).not.toContain('Design a feed.')
  })

  it('runs the interview lifecycle for guests and a second interviewer', async () => {
    const time = clock()
    const store = new SharedStore()
    const owner = createMockInterviewService({ store, now: time.now, vaultStore: new MemoryKv() })
    const session = await openedSession(owner, 'Sketch ingestion, fan-out, and storage.')
    expect(session.maxParticipants).toBe(10)
    expect(session.state).toBe('draft')

    await owner.inviteByEmail(session.id, { email: 'bea@lattice.test', role: 'interviewer' })
    const interviewer = createMockInterviewService({
      store,
      now: time.now,
      userStore: new MemoryKv(),
      guestStore: new MemoryKv(),
      vaultStore: new MemoryKv(),
    })
    await signIn(interviewer, 'bea@lattice.test')
    expect((await interviewer.listSessions()).map((item) => item.id)).toContain(session.id)
    await expect(interviewer.endSession(session.id)).rejects.toMatchObject({ code: 'forbidden' })

    const link = await owner.createGuestLink(session.id, { maxUses: 4 })
    const guestA = createMockInterviewService({
      store,
      now: time.now,
      userStore: new MemoryKv(),
      guestStore: new MemoryKv(),
      vaultStore: new MemoryKv(),
    })
    const guestB = createMockInterviewService({
      store,
      now: time.now,
      userStore: new MemoryKv(),
      guestStore: new MemoryKv(),
      vaultStore: new MemoryKv(),
    })
    const joinedA = await guestA.joinWithToken(link.token, { displayName: 'Cand A', acceptPrivacy: true })
    const joinedB = await guestB.joinWithToken(link.token, { displayName: 'Cand B', acceptPrivacy: true })
    expect(joinedA.prompt).toContain('ingestion')
    expect(joinedA.participant.id).not.toBe(joinedB.participant.id)

    const ownerConn = (await owner.connect(session.id)) as MockCollaborationConnection
    const guestConn = (await guestA.connect(session.id)) as MockCollaborationConnection
    const interviewerConn = (await interviewer.connect(session.id)) as MockCollaborationConnection
    const ownerEvents = await listen(ownerConn)
    const guestEvents = await listen(guestConn)
    expect(ownerEvents[0]?.type).toBe('room_joined')
    expect(guestEvents[0]?.type).toBe('room_joined')

    const first = addElements(
      (await guestA.getCanvas(session.id)).document,
      [{ id: 'api', type: 'gateway', x: 40, y: 80, width: 170, height: 72, label: 'Gateway' }],
      joinedA.participant.id,
      time.now(),
    )
    await guestConn.sendDocumentUpdate({ clientOperationId: 'guest-1', op: first.op })
    const second = addElements(
      (await owner.getCanvas(session.id)).document,
      [{ id: 'db', type: 'sql', x: 320, y: 80, width: 130, height: 110, label: 'SQL' }],
      (await owner.getSession(session.id)).myParticipantId,
      time.now() + 5,
    )
    await ownerConn.sendDocumentUpdate({ clientOperationId: 'owner-1', op: second.op })
    await ownerConn.sendDocumentUpdate({ clientOperationId: 'owner-1', op: second.op })

    const converged = materialize((await interviewer.getCanvas(session.id)).document)
    expect(converged.elements.map((item) => item.label).sort()).toEqual(['Gateway', 'SQL'])
    expect(owner.debugDatabase().operations.filter((item) => item.clientOperationId === 'owner-1')).toHaveLength(1)

    await owner.setCandidateEditing(session.id, false)
    const blocked = addElements(
      (await guestA.getCanvas(session.id)).document,
      [{ id: 'extra', type: 'cache', x: 10, y: 10, width: 100, height: 80, label: 'Nope' }],
      joinedA.participant.id,
      time.now() + 10,
    )
    await expect(guestConn.sendDocumentUpdate({ clientOperationId: 'guest-2', op: blocked.op })).rejects.toMatchObject({
      code: 'locked',
    })
    expect(materialize((await owner.getCanvas(session.id)).document).elements.some((item) => item.id === 'extra')).toBe(false)
    const ownerEdit = addElements(
      (await owner.getCanvas(session.id)).document,
      [{ id: 'cache', type: 'cache', x: 520, y: 80, width: 120, height: 100, label: 'Cache' }],
      (await owner.getSession(session.id)).myParticipantId,
      time.now() + 12,
    )
    await ownerConn.sendDocumentUpdate({ clientOperationId: 'owner-2', op: ownerEdit.op })

    await owner.revokeGuestLink(session.id, link.id)
    const lateGuest = createMockInterviewService({
      store,
      now: time.now,
      userStore: new MemoryKv(),
      guestStore: new MemoryKv(),
      vaultStore: new MemoryKv(),
    })
    await expect(lateGuest.joinWithToken(link.token, { displayName: 'Late', acceptPrivacy: true })).rejects.toMatchObject({
      code: 'revoked',
    })
    expect((await guestA.getSession(session.id)).participants.some((item) => item.id === joinedA.participant.id)).toBe(true)

    await owner.setCandidateEditing(session.id, true)
    await guestConn.debugSetOnline(false)
    const offline = addElements(
      (await guestA.getCanvas(session.id)).document,
      [{ id: 'note', type: 'sticky', x: 40, y: 240, width: 160, height: 140, label: 'Queued' }],
      joinedA.participant.id,
      time.now() + 20,
    )
    await guestConn.sendDocumentUpdate({ clientOperationId: 'guest-offline', op: offline.op })
    expect(materialize((await owner.getCanvas(session.id)).document).elements.some((item) => item.id === 'note')).toBe(false)
    await guestConn.debugSetOnline(true)
    expect(materialize((await owner.getCanvas(session.id)).document).elements.some((item) => item.label === 'Queued')).toBe(true)

    const ended = await owner.endSession(session.id)
    expect(ended.state).toBe('ended')
    const snapshots = owner.debugDatabase().snapshots
    expect(snapshots.length).toBeGreaterThan(0)
    const body = owner.debugDatabase().blobs[snapshots.at(-1)!.storageKey]!
    expect(snapshots.at(-1)?.checksum).toBe(await sha256Hex(stableStringify(body)))
    await expect(guestConn.sendDocumentUpdate({ clientOperationId: 'guest-after-end', op: offline.op })).rejects.toMatchObject({
      code: 'ended',
    })
    await expect(guestA.getCanvas(session.id)).rejects.toMatchObject({ code: 'ended' })
    const reviewed = materialize((await owner.getCanvas(session.id)).document)
    expect(reviewed.elements.some((item) => item.label === 'Cache')).toBe(true)

    const other = await owner.createSession({ title: 'Other interview' })
    await expect(guestA.getCanvas(other.id)).rejects.toMatchObject({ code: 'forbidden' })

    ownerConn.close()
    guestConn.close()
    interviewerConn.close()
  })

  it('rejects expired, full, archived, and overused links', async () => {
    const time = clock()
    const service = createMockInterviewService({ now: time.now })
    const session = await openedSession(service)
    const expired = await service.createGuestLink(session.id, { expiresAt: '2026-08-01T00:00:00.000Z' })
    await expect(service.previewJoin(expired.token)).rejects.toMatchObject({ code: 'expired' })

    const limited = await service.createGuestLink(session.id, { maxUses: 1 })
    const guest = createMockInterviewService({
      store: service.store,
      now: time.now,
      userStore: new MemoryKv(),
      guestStore: new MemoryKv(),
      vaultStore: new MemoryKv(),
    })
    await guest.joinWithToken(limited.token, { displayName: 'Only', acceptPrivacy: true })
    await expect(
      createMockInterviewService({
        store: service.store,
        now: time.now,
        userStore: new MemoryKv(),
        guestStore: new MemoryKv(),
        vaultStore: new MemoryKv(),
      }).joinWithToken(limited.token, { displayName: 'Second', acceptPrivacy: true }),
    ).rejects.toMatchObject({ code: 'expired' })

    await service.updateSession(session.id, { maxParticipants: 2 })
    const roomy = await service.createGuestLink(session.id)
    await expect(
      createMockInterviewService({
        store: service.store,
        now: time.now,
        userStore: new MemoryKv(),
        guestStore: new MemoryKv(),
        vaultStore: new MemoryKv(),
      }).previewJoin(roomy.token),
    ).rejects.toMatchObject({ code: 'capacity' })

    await service.archiveSession(session.id)
    const fresh = await service.createSession({ title: 'Next' })
    const archivedLink = await service.createGuestLink(session.id).catch((error: unknown) => error)
    expect(archivedLink).toBeInstanceOf(ServiceError)
    const nextLink = await service.createGuestLink(fresh.id)
    await service.archiveSession(fresh.id)
    await expect(service.previewJoin(nextLink.token)).rejects.toMatchObject({ code: 'archived' })
  })

  it('preserves the previous snapshot when the canvas is cleared', async () => {
    const time = clock()
    const service = createMockInterviewService({ now: time.now })
    const session = await openedSession(service)
    const connection = (await service.connect(session.id)) as MockCollaborationConnection
    await listen(connection)
    const actorId = (await service.getSession(session.id)).myParticipantId
    const created = addElements(
      (await service.getCanvas(session.id)).document,
      [{ id: 'box', type: 'rect', x: 0, y: 0, width: 80, height: 40, label: 'Box' }],
      actorId,
      time.now(),
    )
    await connection.sendDocumentUpdate({ clientOperationId: 'draw', op: created.op })
    const cleared = await service.clearCanvas(session.id)
    expect(materialize((await service.getCanvas(session.id)).document).elements).toHaveLength(0)
    await service.restoreSnapshot(session.id, cleared.snapshotId)
    expect(materialize((await service.getCanvas(session.id)).document).elements[0]?.label).toBe('Box')
    connection.close()
  })

  it('syncs two persisted service instances and rate-limits joins', async () => {
    const time = clock()
    const persistence = new MemoryPersistence()
    const bus = new MemoryBus<{ type: 'db' | 'presence' | 'presence-leave'; origin: string }>()
    const userStore = new MemoryKv()
    const primary = createMockInterviewService({ persistence, bus, userStore, now: time.now })
    const secondary = createMockInterviewService({
      persistence,
      bus,
      userStore,
      now: time.now,
      guestStore: new MemoryKv(),
      vaultStore: new MemoryKv(),
    })
    const session = await openedSession(primary, 'Prompt stays server-side')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect((await secondary.listSessions()).map((item) => item.title)).toEqual(['News feed'])

    const limited = createMockInterviewService({
      now: time.now,
      limits: { joinPerMinute: 2 },
    })
    const created = await openedSession(limited)
    const link = await limited.createGuestLink(created.id)
    await limited.previewJoin(link.token)
    await limited.previewJoin(link.token)
    await expect(limited.previewJoin(link.token)).rejects.toMatchObject({ code: 'rate_limited' })
    expect(session.id).toBeTruthy()
  })

  it('rejects a second use of a magic link', async () => {
    const service = createMockInterviewService({ now: clock().now })
    const issued = await service.requestMagicLink('ada@lattice.test')
    const token = new URL(issued.verificationPath, 'http://localhost').searchParams.get('token')!
    await service.completeMagicLink(token)
    await expect(service.completeMagicLink(token)).rejects.toMatchObject({ code: 'invalid' })
    expect(JSON.stringify(service.debugDatabase())).not.toContain(token)
  })
})
