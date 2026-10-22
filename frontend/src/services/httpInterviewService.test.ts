import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasOp } from '../canvas/model'
import { HttpInterviewService } from './httpInterviewService'
import { MemoryKv } from './sharedStore'
import { isServiceError } from './errors'

class FakeSocket {
  static instances: FakeSocket[] = []
  static OPEN = 1
  readyState = 0
  sent: string[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = FakeSocket.OPEN
      this.onopen?.()
    })
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.onclose?.({ code: 1000 })
  }

  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function serviceWith(fetchImpl: typeof fetch) {
  return new HttpInterviewService({
    origin: 'http://127.0.0.1:8000',
    userStore: new MemoryKv(),
    guestStore: new MemoryKv(),
    vaultStore: new MemoryKv(),
    fetchImpl,
    webSocket: FakeSocket as unknown as typeof WebSocket,
  })
}

afterEach(() => {
  FakeSocket.instances = []
})

describe('HttpInterviewService', () => {
  it('calls fetch as a page function so the browser accepts the request', async () => {
    const fetchImpl = vi.fn(async function (this: unknown, _input: RequestInfo | URL, _init?: RequestInit) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return jsonResponse({ verificationPath: '/auth/verify?token=abc' })
    })
    const service = serviceWith(fetchImpl)
    await expect(service.requestMagicLink('ada@lattice.test')).resolves.toEqual({
      verificationPath: '/auth/verify?token=abc',
    })
  })

  it('stores the bearer token from a magic link and sends it on later requests', async () => {
    const user = {
      id: 'user-1',
      email: 'ada@lattice.test',
      displayName: 'Ada',
      organizationId: 'org-1',
      createdAt: '2026-08-03T15:00:00.000Z',
    }
    let authorization: string | null = null
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      authorization = new Headers(init?.headers).get('Authorization')
      if (url.endsWith('/auth/magic-links/complete')) {
        return jsonResponse(user, 200, { 'X-Access-Token': 'user-token' })
      }
      return jsonResponse([
        {
          id: 'checkout-demo',
          title: 'Checkout API',
          state: 'live',
          createdAt: '2026-08-03T15:00:00.000Z',
          updatedAt: '2026-08-03T15:00:00.000Z',
          scheduledAt: null,
          startedAt: '2026-08-03T15:00:00.000Z',
          endedAt: null,
          participantNames: ['Ada'],
          role: 'owner',
          hasActiveGuestLink: true,
        },
      ])
    })
    const service = serviceWith(fetchImpl)
    await expect(service.completeMagicLink('abc')).resolves.toEqual(user)
    const sessions = await service.listSessions()
    expect(sessions[0]?.title).toBe('Checkout API')
    expect(authorization).toBe('Bearer user-token')
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe('http://127.0.0.1:8000/v1/sessions')
  })

  it('posts a new interview and keeps a guest-link token locally', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/sessions') && init?.method === 'POST') {
        return jsonResponse({ id: 'news', title: 'News feed', state: 'draft' }, 201)
      }
      if (url.endsWith('/guest-links')) {
        return jsonResponse(
          {
            id: 'link-1',
            sessionId: 'news',
            roleGranted: 'candidate',
            expiresAt: null,
            maxUses: null,
            createdAt: '2026-08-03T15:00:00.000Z',
            token: 'guest-token',
            path: '/join/guest-token',
          },
          201,
        )
      }
      return jsonResponse({
        session: { id: 'news' },
        participants: [],
        myRole: 'owner',
        myParticipantId: 'p1',
        links: [
          {
            id: 'link-1',
            roleGranted: 'candidate',
            expiresAt: null,
            maxUses: null,
            useCount: 0,
            revokedAt: null,
            createdAt: '2026-08-03T15:00:00.000Z',
            hasLocalToken: false,
          },
        ],
        snapshots: [],
      })
    })
    const service = serviceWith(fetchImpl)
    await service.createSession({ title: 'News feed' })
    const issued = await service.createGuestLink('news')
    expect(issued.path).toBe('/join/guest-token')
    await expect(service.getGuestLinkPath('news', 'link-1')).resolves.toBe('/join/guest-token')
    const detail = await service.getSession('news')
    expect(detail.links[0]?.hasLocalToken).toBe(true)
    const createCall = fetchImpl.mock.calls[0]
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({ title: 'News feed' })
  })

  it('maps an API error body to a service error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 'unauthorized', message: 'Sign in to continue.' }, 401))
    const service = serviceWith(fetchImpl)
    await service.completeMagicLink('abc').catch(() => undefined)
    const error = await service.listSessions().catch((caught: unknown) => caught)
    expect(isServiceError(error)).toBe(true)
    if (!isServiceError(error)) return
    expect(error.code).toBe('unauthorized')
    expect(error.status).toBe(401)
  })

  it('sends canvas edits over the collaboration socket and waits for the ack', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 'ada' }, 200, { 'X-Access-Token': 'user-token' }))
    const service = serviceWith(fetchImpl)
    await service.completeMagicLink('abc')
    const events: string[] = []
    const connection = await service.connect('checkout-demo')
    const socket = FakeSocket.instances[0]
    expect(socket?.url).toBe(
      'ws://127.0.0.1:8000/v1/sessions/checkout-demo/collaboration?access_token=user-token&actor=user',
    )
    connection.subscribe((event) => events.push(event.type))
    socket?.receive({
      type: 'room_joined',
      document: { schemaVersion: 1, epoch: 1, elements: {}, connectors: {}, strokes: {} },
      cursor: 0,
      epoch: 1,
      participants: [],
      session: { id: 'checkout-demo' },
    })
    expect(events).toEqual(['room_joined'])
    const op: CanvasOp = { kind: 'patch', epoch: 1, elements: [] }
    const pending = connection.sendDocumentUpdate({ clientOperationId: 'op-1', op })
    await vi.waitUntil(() => (socket?.sent.length ?? 0) > 0)
    expect(JSON.parse(socket?.sent[0] ?? '{}')).toMatchObject({ type: 'document_update', clientOperationId: 'op-1' })
    socket?.receive({
      type: 'document_update',
      cursor: 4,
      actorId: 'ada',
      clientOperationId: 'op-1',
      op,
    })
    await expect(pending).resolves.toEqual({ cursor: 4, queued: false })
    expect(events).toContain('document_update')
  })
})
