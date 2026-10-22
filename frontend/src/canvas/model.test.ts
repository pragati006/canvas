import { describe, expect, it } from 'vitest'
import { stableStringify } from '../lib/format'
import {
  addElements,
  applyOp,
  emptyDoc,
  materialize,
  mergeDoc,
  patchElements,
  reg,
  translateElements,
} from './model'
import { captureHistory, historyToOp } from './history'

const shape = {
  id: 'api',
  type: 'service' as const,
  x: 10,
  y: 20,
  width: 160,
  height: 72,
  label: 'API',
}

describe('canvas document', () => {
  it('keeps simultaneous edits to different objects', () => {
    const left = addElements(emptyDoc(), [shape], 'ada', 10)
    const right = addElements(
      emptyDoc(),
      [{ ...shape, id: 'db', type: 'sql', x: 240, label: 'SQL' }],
      'bea',
      12,
    )
    const forward = applyOp(left.state, right.op).state
    const backward = applyOp(right.state, left.op).state
    expect(stableStringify(forward)).toBe(stableStringify(backward))
    expect(materialize(forward).elements.map((item) => item.id).sort()).toEqual(['api', 'db'])
  })

  it('resolves same-field edits by clock, independent of arrival order', () => {
    const created = addElements(emptyDoc(), [shape], 'ada', 5)
    const newer = patchElements(created.state, [{ id: 'api', label: reg('Newer', { t: 0, a: 'bea' }) }], 'bea', 30)
    const older = patchElements(created.state, [{ id: 'api', label: reg('Older', { t: 0, a: 'cy' }) }], 'cy', 20)
    const forward = applyOp(applyOp(created.state, older.op).state, newer.op).state
    const backward = applyOp(applyOp(created.state, newer.op).state, older.op).state
    expect(materialize(forward).elements[0]?.label).toBe('Newer')
    expect(stableStringify(forward)).toBe(stableStringify(backward))
  })

  it('applies a duplicate patch without changing the document', () => {
    const created = addElements(emptyDoc(), [shape], 'ada', 5)
    const twice = applyOp(created.state, created.op)
    expect(stableStringify(twice.state)).toBe(stableStringify(created.state))
  })

  it('drops a stale edit after the canvas epoch advances', () => {
    const created = addElements(emptyDoc(), [shape], 'ada', 5)
    const cleared = applyOp(created.state, {
      kind: 'restore',
      epoch: 1,
      state: emptyDoc(1),
    }).state
    const stale = applyOp(cleared, created.op)
    expect(stale.applied).toBe(false)
    expect(materialize(stale.state).elements).toHaveLength(0)
  })

  it('moves an element and can undo only that change', () => {
    const created = addElements(emptyDoc(), [shape], 'ada', 5)
    const other = addElements(created.state, [{ ...shape, id: 'db', x: 300, label: 'DB' }], 'bea', 6)
    const moved = translateElements(other.state, ['api'], 40, 15, 'ada', 8)
    expect(moved).not.toBeNull()
    const entry = captureHistory(other.state, moved!.op)
    expect(entry).not.toBeNull()
    const undone = applyOp(moved!.state, historyToOp(entry!, 'undo', moved!.state, 'ada', 9)).state
    const view = materialize(undone)
    expect(view.elements.find((item) => item.id === 'api')).toMatchObject({ x: 10, y: 20 })
    expect(view.elements.find((item) => item.id === 'db')?.label).toBe('DB')
  })

  it('merges two replicas into the same document', () => {
    const left = addElements(emptyDoc(), [shape], 'ada', 4).state
    const right = addElements(emptyDoc(), [{ ...shape, id: 'cache', type: 'cache', label: 'Cache' }], 'bea', 8).state
    expect(stableStringify(mergeDoc(left, right))).toBe(stableStringify(mergeDoc(right, left)))
    expect(materialize(mergeDoc(left, right)).elements).toHaveLength(2)
  })
})
