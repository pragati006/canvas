import {
  type CanvasOp,
  type Clock,
  type ConnectorState,
  type DocState,
  type ElementState,
  type StrokeState,
  nextClock,
  reg,
} from './model'

export interface HistoryChange {
  entity: 'element' | 'connector' | 'stroke'
  id: string
  undo: ElementState | ConnectorState | StrokeState | null
  redo: ElementState | ConnectorState | StrokeState
}

export interface HistoryEntry {
  changes: HistoryChange[]
}

function touchedElement(before: ElementState | undefined, patch: ElementState): ElementState | null {
  if (!before) return null
  const undo: ElementState = { id: patch.id }
  if (patch.tomb) undo.tomb = before.tomb ? { ...before.tomb } : reg(false, patch.tomb.c)
  if (patch.type && before.type) undo.type = { ...before.type }
  if (patch.x && before.x) undo.x = { ...before.x }
  if (patch.y && before.y) undo.y = { ...before.y }
  if (patch.width && before.width) undo.width = { ...before.width }
  if (patch.height && before.height) undo.height = { ...before.height }
  if (patch.label && before.label) undo.label = { ...before.label }
  if (patch.description && before.description) undo.description = { ...before.description }
  if (patch.fill && before.fill) undo.fill = { ...before.fill }
  if (patch.z && before.z) undo.z = { ...before.z }
  if (patch.parentId && before.parentId) undo.parentId = { ...before.parentId }
  return undo
}

function touchedConnector(before: ConnectorState | undefined, patch: ConnectorState): ConnectorState | null {
  if (!before) return null
  const undo: ConnectorState = { id: patch.id }
  if (patch.tomb) undo.tomb = before.tomb ? { ...before.tomb } : reg(false, patch.tomb.c)
  if (patch.fromId && before.fromId) undo.fromId = { ...before.fromId }
  if (patch.toId && before.toId) undo.toId = { ...before.toId }
  if (patch.fromAnchor && before.fromAnchor) undo.fromAnchor = { ...before.fromAnchor }
  if (patch.toAnchor && before.toAnchor) undo.toAnchor = { ...before.toAnchor }
  if (patch.route && before.route) undo.route = { ...before.route }
  if (patch.arrowStart && before.arrowStart) undo.arrowStart = { ...before.arrowStart }
  if (patch.arrowEnd && before.arrowEnd) undo.arrowEnd = { ...before.arrowEnd }
  if (patch.dashed && before.dashed) undo.dashed = { ...before.dashed }
  if (patch.color && before.color) undo.color = { ...before.color }
  if (patch.width && before.width) undo.width = { ...before.width }
  if (patch.label && before.label) undo.label = { ...before.label }
  return undo
}

function touchedStroke(before: StrokeState | undefined, patch: StrokeState): StrokeState | null {
  if (!before) return null
  const undo: StrokeState = { id: patch.id }
  if (patch.tomb) undo.tomb = before.tomb ? { ...before.tomb } : reg(false, patch.tomb.c)
  if (patch.tool && before.tool) undo.tool = { ...before.tool }
  if (patch.color && before.color) undo.color = { ...before.color }
  if (patch.width && before.width) undo.width = { ...before.width }
  if (patch.opacity && before.opacity) undo.opacity = { ...before.opacity }
  if (patch.points && before.points) undo.points = { v: before.points.v.map((point) => ({ ...point })), c: before.points.c }
  return undo
}

export function captureHistory(before: DocState, op: CanvasOp): HistoryEntry | null {
  if (op.kind !== 'patch') return null
  const changes: HistoryChange[] = []
  for (const patch of op.elements ?? []) {
    const undo = touchedElement(before.elements[patch.id], patch)
    changes.push({
      entity: 'element',
      id: patch.id,
      undo,
      redo: structuredClone(patch),
    })
  }
  for (const patch of op.connectors ?? []) {
    changes.push({
      entity: 'connector',
      id: patch.id,
      undo: touchedConnector(before.connectors[patch.id], patch),
      redo: structuredClone(patch),
    })
  }
  for (const patch of op.strokes ?? []) {
    changes.push({
      entity: 'stroke',
      id: patch.id,
      undo: touchedStroke(before.strokes[patch.id], patch),
      redo: structuredClone(patch),
    })
  }
  return changes.length ? { changes } : null
}

function restampClock<T extends { id: string; tomb?: { v: boolean; c: Clock } }>(
  source: T,
  clock: Clock,
): T {
  const next = structuredClone(source)
  for (const [key, value] of Object.entries(next)) {
    if (value && typeof value === 'object' && 'c' in value && 'v' in value) {
      ;(next as unknown as Record<string, { v: unknown; c: Clock }>)[key] = {
        v: (value as { v: unknown }).v,
        c: clock,
      }
    }
  }
  return next
}

export function historyToOp(
  entry: HistoryEntry,
  direction: 'undo' | 'redo',
  state: DocState,
  actor: string,
  now: number,
): CanvasOp {
  const clock = nextClock(state, actor, now)
  const elements: ElementState[] = []
  const connectors: ConnectorState[] = []
  const strokes: StrokeState[] = []
  for (const change of entry.changes) {
    const source = direction === 'undo' ? change.undo : change.redo
    if (!source) {
      const tomb = { id: change.id, tomb: reg(true, clock) }
      if (change.entity === 'element') elements.push(tomb)
      else if (change.entity === 'connector') connectors.push(tomb)
      else strokes.push(tomb)
      continue
    }
    const stamped = restampClock(source, clock)
    if (change.entity === 'element') elements.push(stamped as ElementState)
    else if (change.entity === 'connector') connectors.push(stamped as ConnectorState)
    else strokes.push(stamped as StrokeState)
  }
  return { kind: 'patch', epoch: state.epoch, elements, connectors, strokes }
}
