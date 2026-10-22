import { describe, expect, it } from 'vitest'
import { addElements, emptyDoc } from '../canvas/model'
import { stableStringify } from '../lib/format'
import { emptyDatabase, type CanvasRecord } from './domain'
import { mergeDbSnapshot } from './mergeDb'

describe('database merge', () => {
  it('unions canvas replicas and is idempotent', () => {
    const left = databaseWith('a', 'Service A')
    const right = databaseWith('b', 'Service B')
    const merged = mergeDbSnapshot(left, right)
    expect(Object.keys(merged.documents[0]!.state.elements).sort()).toEqual(['a', 'b'])
    expect(stableStringify(mergeDbSnapshot(merged, right))).toBe(stableStringify(merged))
    expect(stableStringify(mergeDbSnapshot(left, right))).toBe(stableStringify(mergeDbSnapshot(right, left)))
  })
})

function databaseWith(id: string, label: string) {
  const db = emptyDatabase()
  const record: CanvasRecord = {
    id: 'doc-1',
    sessionId: 'session-1',
    schemaVersion: 1,
    latestSnapshotId: null,
    cursor: 1,
    epoch: 0,
    state: addElements(emptyDoc(), [{ id, type: 'service', x: 0, y: 0, width: 120, height: 60, label }], id, 5).state,
    updatedAt: '2026-08-03T00:00:00.000Z',
  }
  db.documents.push(record)
  return db
}
