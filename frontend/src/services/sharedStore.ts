import { stableStringify } from '../lib/format'
import { emptyDatabase, type Database } from './domain'
import { mergeDbSnapshot } from './mergeDb'

export interface Persistence {
  load(): Database | null
  save(db: Database): void
}

export interface EventBus<T> {
  publish(event: T): void
  subscribe(listener: (event: T) => void): () => void
}

export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export class MemoryKv implements KeyValueStore {
  private values = new Map<string, string>()
  get(key: string) {
    return this.values.get(key) ?? null
  }
  set(key: string, value: string) {
    this.values.set(key, value)
  }
  remove(key: string) {
    this.values.delete(key)
  }
}

export class MemoryPersistence implements Persistence {
  value: Database | null = null
  load() {
    return this.value ? structuredClone(this.value) : null
  }
  save(db: Database) {
    this.value = structuredClone(db)
  }
}

export class MemoryBus<T> implements EventBus<T> {
  private listeners = new Set<(event: T) => void>()
  publish(event: T) {
    for (const listener of [...this.listeners]) listener(event)
  }
  subscribe(listener: (event: T) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export class WebKv implements KeyValueStore {
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

export interface StoreEvent {
  type: 'server' | 'synced'
  sessionId?: string
  event?: import('./api').ServerEvent
}

export class SharedStore {
  db: Database
  onCommit: ((draft: Database) => Database) | null = null
  presenceRooms = new Map<string, Map<string, import('./api').Presence>>()
  private changeListeners = new Set<() => void>()
  private eventListeners = new Set<(event: StoreEvent) => void>()

  constructor(initial?: Database) {
    this.db = initial ?? emptyDatabase()
  }

  mutate<T>(fn: (db: Database) => T): T {
    const draft = structuredClone(this.db)
    const result = fn(draft)
    const next = this.onCommit ? this.onCommit(draft) : draft
    this.db = next
    this.changeListeners.forEach((listener) => listener())
    return result
  }

  adopt(remote: Database) {
    const merged = mergeDbSnapshot(this.db, remote)
    if (stableStringify(merged) === stableStringify(this.db)) return false
    this.db = merged
    this.changeListeners.forEach((listener) => listener())
    this.emit({ type: 'synced' })
    return true
  }

  upsertPresence(sessionId: string, presence: import('./api').Presence) {
    const room = this.presenceRooms.get(sessionId) ?? new Map()
    room.set(presence.participantId, presence)
    this.presenceRooms.set(sessionId, room)
  }

  removePresence(sessionId: string, participantId: string) {
    this.presenceRooms.get(sessionId)?.delete(participantId)
  }

  listPresence(sessionId: string) {
    return [...(this.presenceRooms.get(sessionId)?.values() ?? [])]
  }

  subscribe(listener: () => void) {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  subscribeEvents(listener: (event: StoreEvent) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  emit(event: StoreEvent) {
    this.eventListeners.forEach((listener) => listener(event))
  }
}
