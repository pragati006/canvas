import type { SyncEvent } from './mockInterviewService'
import type { Database } from './domain'
import type { EventBus, Persistence } from './sharedStore'

export class WebKv {
  constructor(
    private storage: Storage,
    private prefix = '',
  ) {}

  get(key: string) {
    return this.storage.getItem(this.prefix + key)
  }

  set(key: string, value: string) {
    this.storage.setItem(this.prefix + key, value)
  }

  remove(key: string) {
    this.storage.removeItem(this.prefix + key)
  }
}

export class LocalStoragePersistence implements Persistence {
  constructor(
    private storage: Storage,
    private key: string,
  ) {}

  load() {
    const raw = this.storage.getItem(this.key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as Database
    } catch {
      return null
    }
  }

  save(db: Database) {
    this.storage.setItem(this.key, JSON.stringify(db))
  }
}

export class BroadcastBus implements EventBus<SyncEvent> {
  private channel: BroadcastChannel | null

  constructor() {
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lattice.bus.v1')
  }

  publish(event: SyncEvent) {
    this.channel?.postMessage(event)
  }

  subscribe(listener: (event: SyncEvent) => void) {
    if (!this.channel) return () => undefined
    const handler = (message: MessageEvent<SyncEvent>) => listener(message.data)
    this.channel.addEventListener('message', handler)
    return () => this.channel?.removeEventListener('message', handler)
  }
}
