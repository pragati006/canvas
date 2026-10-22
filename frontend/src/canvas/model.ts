export const SCHEMA_VERSION = 1

export const COMPONENT_TYPES = [
  'service',
  'rounded',
  'text',
  'sticky',
  'boundary',
  'icon',
  'rect',
  'ellipse',
  'sql',
  'nosql',
  'cache',
  'object-storage',
  'warehouse',
  'queue',
  'stream',
  'pubsub',
  'client',
  'browser',
  'gateway',
  'load-balancer',
  'cdn',
  'external-api',
  'server',
  'worker',
  'function',
  'container',
  'llm',
  'embedding',
  'vector-db',
  'agent',
] as const

export type ComponentType = (typeof COMPONENT_TYPES)[number]

export type AnchorSide = 'top' | 'right' | 'bottom' | 'left' | 'auto'
export type ConnectorRoute = 'straight' | 'elbow' | 'curved'
export type StrokeTool = 'pen' | 'highlighter'

export interface Clock {
  t: number
  a: string
}

export interface Reg<T> {
  v: T
  c: Clock
}

export interface ElementState {
  id: string
  createdBy?: string
  tomb?: Reg<boolean>
  type?: Reg<ComponentType>
  x?: Reg<number>
  y?: Reg<number>
  width?: Reg<number>
  height?: Reg<number>
  label?: Reg<string>
  description?: Reg<string>
  fill?: Reg<string | null>
  z?: Reg<number>
  parentId?: Reg<string | null>
}

export interface ConnectorState {
  id: string
  createdBy?: string
  tomb?: Reg<boolean>
  fromId?: Reg<string>
  toId?: Reg<string>
  fromAnchor?: Reg<AnchorSide>
  toAnchor?: Reg<AnchorSide>
  route?: Reg<ConnectorRoute>
  arrowStart?: Reg<boolean>
  arrowEnd?: Reg<boolean>
  dashed?: Reg<boolean>
  color?: Reg<string>
  width?: Reg<1 | 2 | 3>
  label?: Reg<string>
}

export interface StrokeState {
  id: string
  createdBy?: string
  tomb?: Reg<boolean>
  tool?: Reg<StrokeTool>
  color?: Reg<string>
  width?: Reg<number>
  opacity?: Reg<number>
  points?: Reg<Point[]>
}

export interface Point {
  x: number
  y: number
}

export interface DocState {
  schemaVersion: number
  epoch: number
  elements: Record<string, ElementState>
  connectors: Record<string, ConnectorState>
  strokes: Record<string, StrokeState>
}

export interface CanvasOp {
  kind: 'patch' | 'restore'
  epoch: number
  elements?: ElementState[]
  connectors?: ConnectorState[]
  strokes?: StrokeState[]
  state?: DocState
}

export interface ViewElement {
  id: string
  type: ComponentType
  x: number
  y: number
  width: number
  height: number
  label: string
  description: string
  fill: string | null
  z: number
  parentId: string | null
  createdBy: string
}

export interface ViewConnector {
  id: string
  fromId: string
  toId: string
  fromAnchor: AnchorSide
  toAnchor: AnchorSide
  route: ConnectorRoute
  arrowStart: boolean
  arrowEnd: boolean
  dashed: boolean
  color: string
  width: 1 | 2 | 3
  label: string
  createdBy: string
}

export interface ViewStroke {
  id: string
  tool: StrokeTool
  color: string
  width: number
  opacity: number
  points: Point[]
  createdBy: string
}

export interface ViewModel {
  elements: ViewElement[]
  connectors: ViewConnector[]
  strokes: ViewStroke[]
}

export function isComponentType(value: string): value is ComponentType {
  return (COMPONENT_TYPES as readonly string[]).includes(value)
}

export function emptyDoc(epoch = 0): DocState {
  return {
    schemaVersion: SCHEMA_VERSION,
    epoch,
    elements: {},
    connectors: {},
    strokes: {},
  }
}

export function reg<T>(v: T, c: Clock): Reg<T> {
  return { v, c }
}

export function clockCompare(a: Clock, b: Clock): number {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1
  if (a.a === b.a) return 0
  return a.a < b.a ? -1 : 1
}

export function mergeReg<T>(a?: Reg<T>, b?: Reg<T>): Reg<T> | undefined {
  if (!a) return b
  if (!b) return a
  return clockCompare(a.c, b.c) >= 0 ? a : b
}

function fieldClocks(regs: Array<Reg<unknown> | undefined>): Clock | null {
  let best: Clock | null = null
  for (const field of regs) {
    if (!field) continue
    if (!best || clockCompare(field.c, best) > 0) best = field.c
  }
  return best
}

export function hiddenByTomb(
  tomb: Reg<boolean> | undefined,
  fields: Array<Reg<unknown> | undefined>,
): boolean {
  if (!tomb || tomb.v === false) return false
  const latest = fieldClocks(fields)
  if (!latest) return true
  return clockCompare(tomb.c, latest) >= 0
}

function elementFields(element: ElementState): Array<Reg<unknown> | undefined> {
  return [
    element.type,
    element.x,
    element.y,
    element.width,
    element.height,
    element.label,
    element.description,
    element.fill,
    element.z,
    element.parentId,
  ]
}

function connectorFields(connector: ConnectorState): Array<Reg<unknown> | undefined> {
  return [
    connector.fromId,
    connector.toId,
    connector.fromAnchor,
    connector.toAnchor,
    connector.route,
    connector.arrowStart,
    connector.arrowEnd,
    connector.dashed,
    connector.color,
    connector.width,
    connector.label,
  ]
}

function strokeFields(stroke: StrokeState): Array<Reg<unknown> | undefined> {
  return [stroke.tool, stroke.color, stroke.width, stroke.opacity, stroke.points]
}

export function elementHidden(element: ElementState): boolean {
  return hiddenByTomb(element.tomb, elementFields(element))
}

export function connectorHidden(connector: ConnectorState): boolean {
  return hiddenByTomb(connector.tomb, connectorFields(connector))
}

export function strokeHidden(stroke: StrokeState): boolean {
  return hiddenByTomb(stroke.tomb, strokeFields(stroke))
}

function assignReg<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined) {
  if (value !== undefined) target[key] = value
}

function mergeElement(a: ElementState, b: ElementState): ElementState {
  const next: ElementState = { id: a.id }
  if (a.createdBy || b.createdBy) next.createdBy = a.createdBy || b.createdBy
  assignReg(next, 'tomb', mergeReg(a.tomb, b.tomb))
  assignReg(next, 'type', mergeReg(a.type, b.type))
  assignReg(next, 'x', mergeReg(a.x, b.x))
  assignReg(next, 'y', mergeReg(a.y, b.y))
  assignReg(next, 'width', mergeReg(a.width, b.width))
  assignReg(next, 'height', mergeReg(a.height, b.height))
  assignReg(next, 'label', mergeReg(a.label, b.label))
  assignReg(next, 'description', mergeReg(a.description, b.description))
  assignReg(next, 'fill', mergeReg(a.fill, b.fill))
  assignReg(next, 'z', mergeReg(a.z, b.z))
  assignReg(next, 'parentId', mergeReg(a.parentId, b.parentId))
  return next
}

function mergeConnector(a: ConnectorState, b: ConnectorState): ConnectorState {
  const next: ConnectorState = { id: a.id }
  if (a.createdBy || b.createdBy) next.createdBy = a.createdBy || b.createdBy
  assignReg(next, 'tomb', mergeReg(a.tomb, b.tomb))
  assignReg(next, 'fromId', mergeReg(a.fromId, b.fromId))
  assignReg(next, 'toId', mergeReg(a.toId, b.toId))
  assignReg(next, 'fromAnchor', mergeReg(a.fromAnchor, b.fromAnchor))
  assignReg(next, 'toAnchor', mergeReg(a.toAnchor, b.toAnchor))
  assignReg(next, 'route', mergeReg(a.route, b.route))
  assignReg(next, 'arrowStart', mergeReg(a.arrowStart, b.arrowStart))
  assignReg(next, 'arrowEnd', mergeReg(a.arrowEnd, b.arrowEnd))
  assignReg(next, 'dashed', mergeReg(a.dashed, b.dashed))
  assignReg(next, 'color', mergeReg(a.color, b.color))
  assignReg(next, 'width', mergeReg(a.width, b.width))
  assignReg(next, 'label', mergeReg(a.label, b.label))
  return next
}

function mergeStroke(a: StrokeState, b: StrokeState): StrokeState {
  const next: StrokeState = { id: a.id }
  if (a.createdBy || b.createdBy) next.createdBy = a.createdBy || b.createdBy
  assignReg(next, 'tomb', mergeReg(a.tomb, b.tomb))
  assignReg(next, 'tool', mergeReg(a.tool, b.tool))
  assignReg(next, 'color', mergeReg(a.color, b.color))
  assignReg(next, 'width', mergeReg(a.width, b.width))
  assignReg(next, 'opacity', mergeReg(a.opacity, b.opacity))
  assignReg(next, 'points', mergeReg(a.points, b.points))
  return next
}

function mergeMap<T extends { id: string }>(
  left: Record<string, T>,
  right: Record<string, T>,
  merge: (a: T, b: T) => T,
): Record<string, T> {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)])
  const out: Record<string, T> = {}
  for (const id of ids) {
    const a = left[id]
    const b = right[id]
    if (a && b) out[id] = merge(a, b)
    else if (a) out[id] = a
    else if (b) out[id] = b
  }
  return out
}

export function mergeDoc(a: DocState, b: DocState): DocState {
  if (a.epoch !== b.epoch) return a.epoch > b.epoch ? a : b
  return {
    schemaVersion: SCHEMA_VERSION,
    epoch: a.epoch,
    elements: mergeMap(a.elements, b.elements, mergeElement),
    connectors: mergeMap(a.connectors, b.connectors, mergeConnector),
    strokes: mergeMap(a.strokes, b.strokes, mergeStroke),
  }
}

export function applyOp(state: DocState, op: CanvasOp): { state: DocState; applied: boolean } {
  if (op.kind === 'restore') {
    if (!op.state || op.epoch < state.epoch) return { state, applied: false }
    const restored: DocState = { ...op.state, schemaVersion: SCHEMA_VERSION, epoch: op.epoch }
    if (op.epoch === state.epoch) return { state: mergeDoc(state, restored), applied: true }
    return { state: restored, applied: true }
  }
  if (op.epoch !== state.epoch) return { state, applied: false }
  return {
    applied: true,
    state: {
      ...state,
      elements: applyPatches(state.elements, op.elements, mergeElement),
      connectors: applyPatches(state.connectors, op.connectors, mergeConnector),
      strokes: applyPatches(state.strokes, op.strokes, mergeStroke),
    },
  }
}

function applyPatches<T extends { id: string }>(
  current: Record<string, T>,
  patches: T[] | undefined,
  merge: (a: T, b: T) => T,
): Record<string, T> {
  if (!patches?.length) return current
  const next = { ...current }
  for (const patch of patches) {
    const existing = next[patch.id]
    next[patch.id] = existing ? merge(existing, patch) : patch
  }
  return next
}

function walkClocks(state: DocState, visit: (clock: Clock) => void) {
  for (const element of Object.values(state.elements)) {
    for (const field of [...elementFields(element), element.tomb]) if (field) visit(field.c)
  }
  for (const connector of Object.values(state.connectors)) {
    for (const field of [...connectorFields(connector), connector.tomb]) if (field) visit(field.c)
  }
  for (const stroke of Object.values(state.strokes)) {
    for (const field of [...strokeFields(stroke), stroke.tomb]) if (field) visit(field.c)
  }
}

export function maxStateTime(state: DocState): number {
  let max = 0
  walkClocks(state, (clock) => {
    if (clock.t > max) max = clock.t
  })
  return max
}

export function nextClock(state: DocState, actor: string, now: number): Clock {
  return { t: Math.max(now, maxStateTime(state) + 1), a: actor }
}

export function materialize(state: DocState): ViewModel {
  const elements: ViewElement[] = []
  for (const element of Object.values(state.elements)) {
    if (elementHidden(element)) continue
    if (!element.type || element.x === undefined || element.y === undefined) continue
    if (element.width === undefined || element.height === undefined) continue
    elements.push({
      id: element.id,
      type: element.type.v,
      x: element.x.v,
      y: element.y.v,
      width: element.width.v,
      height: element.height.v,
      label: element.label?.v ?? '',
      description: element.description?.v ?? '',
      fill: element.fill?.v ?? null,
      z: element.z?.v ?? 0,
      parentId: element.parentId?.v ?? null,
      createdBy: element.createdBy ?? '',
    })
  }
  elements.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))

  const liveIds = new Set(elements.map((element) => element.id))
  const connectors: ViewConnector[] = []
  for (const connector of Object.values(state.connectors)) {
    if (connectorHidden(connector)) continue
    if (!connector.fromId || !connector.toId) continue
    if (!liveIds.has(connector.fromId.v) || !liveIds.has(connector.toId.v)) continue
    connectors.push({
      id: connector.id,
      fromId: connector.fromId.v,
      toId: connector.toId.v,
      fromAnchor: connector.fromAnchor?.v ?? 'auto',
      toAnchor: connector.toAnchor?.v ?? 'auto',
      route: connector.route?.v ?? 'elbow',
      arrowStart: connector.arrowStart?.v ?? false,
      arrowEnd: connector.arrowEnd?.v ?? true,
      dashed: connector.dashed?.v ?? false,
      color: connector.color?.v ?? '#d7dde6',
      width: connector.width?.v ?? 2,
      label: connector.label?.v ?? '',
      createdBy: connector.createdBy ?? '',
    })
  }
  connectors.sort((a, b) => (a.id < b.id ? -1 : 1))

  const strokes: ViewStroke[] = []
  for (const stroke of Object.values(state.strokes)) {
    if (strokeHidden(stroke) || !stroke.points || stroke.points.v.length < 2) continue
    strokes.push({
      id: stroke.id,
      tool: stroke.tool?.v ?? 'pen',
      color: stroke.color?.v ?? '#f4efe6',
      width: stroke.width?.v ?? 3,
      opacity: stroke.opacity?.v ?? 1,
      points: stroke.points.v,
      createdBy: stroke.createdBy ?? '',
    })
  }
  strokes.sort((a, b) => (a.id < b.id ? -1 : 1))
  return { elements, connectors, strokes }
}

export function validateOp(op: CanvasOp): string | null {
  if (op.kind === 'restore') {
    if (!op.state || op.state.schemaVersion !== SCHEMA_VERSION) return 'Canvas snapshot is unsupported.'
    return null
  }
  for (const element of op.elements ?? []) {
    if (element.type && !isComponentType(element.type.v)) return 'Unsupported component type.'
    if (element.label && element.label.v.length > 500) return 'Labels must be 500 characters or fewer.'
    if (element.description && element.description.v.length > 2000) {
      return 'Descriptions must be 2,000 characters or fewer.'
    }
    for (const field of [element.x, element.y, element.width, element.height, element.z]) {
      if (field && !Number.isFinite(field.v)) return 'Canvas coordinates must be finite numbers.'
    }
    if (element.width && (element.width.v <= 0 || element.width.v > 8000)) return 'Element size is out of range.'
    if (element.height && (element.height.v <= 0 || element.height.v > 8000)) return 'Element size is out of range.'
  }
  for (const connector of op.connectors ?? []) {
    if (connector.label && connector.label.v.length > 500) return 'Connector labels must be 500 characters or fewer.'
    if (connector.width && ![1, 2, 3].includes(connector.width.v)) return 'Unsupported connector width.'
    if (connector.color && connector.color.v.length > 40) return 'Unsupported connector color.'
  }
  for (const stroke of op.strokes ?? []) {
    const count = stroke.points?.v.length ?? 0
    if (count > 2000) return 'A freehand stroke is too long.'
  }
  return null
}

export function assertWithinLimits(state: DocState): string | null {
  const view = materialize(state)
  if (view.elements.length > 2000) return 'This canvas has reached the 2,000 element limit.'
  const points = view.strokes.reduce((total, stroke) => total + stroke.points.length, 0)
  if (points > 10000) return 'This canvas has reached the freehand point limit.'
  return null
}

export interface NewElementInput {
  id: string
  type: ComponentType
  x: number
  y: number
  width: number
  height: number
  label: string
  description?: string
  fill?: string | null
  z?: number
  parentId?: string | null
}

function patchResult(state: DocState, op: CanvasOp): { state: DocState; op: CanvasOp } {
  return { state: applyOp(state, op).state, op }
}

export function addElements(
  state: DocState,
  inputs: NewElementInput[],
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } {
  const clock = nextClock(state, actor, now)
  const view = materialize(state)
  const maxZ = view.elements.reduce((max, element) => Math.max(max, element.z), 0)
  const elements: ElementState[] = inputs.map((input, index) => ({
    id: input.id,
    createdBy: actor,
    type: reg(input.type, clock),
    x: reg(input.x, clock),
    y: reg(input.y, clock),
    width: reg(input.width, clock),
    height: reg(input.height, clock),
    label: reg(input.label, clock),
    description: reg(input.description ?? '', clock),
    fill: reg(input.fill ?? null, clock),
    z: reg(input.z ?? maxZ + index + 1, clock),
    parentId: reg(input.parentId ?? null, clock),
  }))
  return patchResult(state, { kind: 'patch', epoch: state.epoch, elements })
}

export function patchElements(
  state: DocState,
  patches: ElementState[],
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } {
  const clock = nextClock(state, actor, now)
  const elements = patches.map((patch) => restampElement(patch, clock))
  return patchResult(state, { kind: 'patch', epoch: state.epoch, elements })
}

function restampElement(patch: ElementState, clock: Clock): ElementState {
  const next: ElementState = { id: patch.id }
  if (patch.createdBy) next.createdBy = patch.createdBy
  if (patch.tomb) next.tomb = reg(patch.tomb.v, clock)
  if (patch.type) next.type = reg(patch.type.v, clock)
  if (patch.x) next.x = reg(patch.x.v, clock)
  if (patch.y) next.y = reg(patch.y.v, clock)
  if (patch.width) next.width = reg(patch.width.v, clock)
  if (patch.height) next.height = reg(patch.height.v, clock)
  if (patch.label) next.label = reg(patch.label.v, clock)
  if (patch.description) next.description = reg(patch.description.v, clock)
  if (patch.fill) next.fill = reg(patch.fill.v, clock)
  if (patch.z) next.z = reg(patch.z.v, clock)
  if (patch.parentId) next.parentId = reg(patch.parentId.v, clock)
  return next
}

export function expandIds(state: DocState, ids: string[]): string[] {
  const view = materialize(state)
  const selected = new Set(ids)
  let grew = true
  while (grew) {
    grew = false
    for (const element of view.elements) {
      if (element.parentId && selected.has(element.parentId) && !selected.has(element.id)) {
        selected.add(element.id)
        grew = true
      }
    }
  }
  return [...selected]
}

export function translateElements(
  state: DocState,
  ids: string[],
  dx: number,
  dy: number,
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } | null {
  if (!dx && !dy) return null
  const view = materialize(state)
  const moving = new Set(expandIds(state, ids))
  const patches: ElementState[] = []
  for (const element of view.elements) {
    if (!moving.has(element.id)) continue
    patches.push({
      id: element.id,
      x: reg(element.x + dx, { t: 0, a: actor }),
      y: reg(element.y + dy, { t: 0, a: actor }),
    })
  }
  if (!patches.length) return null
  return patchElements(state, patches, actor, now)
}

export function placeElement(
  state: DocState,
  id: string,
  rect: { x: number; y: number; width: number; height: number },
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } | null {
  const current = materialize(state).elements.find((element) => element.id === id)
  if (!current) return null
  return patchElements(
    state,
    [
      {
        id,
        x: reg(rect.x, { t: 0, a: actor }),
        y: reg(rect.y, { t: 0, a: actor }),
        width: reg(rect.width, { t: 0, a: actor }),
        height: reg(rect.height, { t: 0, a: actor }),
      },
    ],
    actor,
    now,
  )
}

export function deleteElements(
  state: DocState,
  ids: string[],
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } | null {
  const removing = new Set(expandIds(state, ids))
  if (!removing.size) return null
  const clock = { t: 0, a: actor }
  const elements: ElementState[] = [...removing].map((id) => ({ id, tomb: reg(true, clock) }))
  const connectors: ConnectorState[] = []
  for (const connector of materialize(state).connectors) {
    if (removing.has(connector.fromId) || removing.has(connector.toId)) {
      connectors.push({ id: connector.id, tomb: reg(true, clock) })
    }
  }
  const stampedElements = elements
  const opBase = patchElements(state, stampedElements, actor, now)
  if (!connectors.length) return opBase
  const connectorOp = patchConnectors(opBase.state, connectors, actor, now + 1)
  return {
    state: connectorOp.state,
    op: {
      kind: 'patch',
      epoch: state.epoch,
      elements: opBase.op.elements,
      connectors: connectorOp.op.connectors,
    },
  }
}

export interface NewConnectorInput {
  id: string
  fromId: string
  toId: string
  route?: ConnectorRoute
  arrowStart?: boolean
  arrowEnd?: boolean
  dashed?: boolean
  color?: string
  width?: 1 | 2 | 3
  label?: string
  fromAnchor?: AnchorSide
  toAnchor?: AnchorSide
}

export function addConnectors(
  state: DocState,
  inputs: NewConnectorInput[],
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } {
  const clock = nextClock(state, actor, now)
  const connectors: ConnectorState[] = inputs.map((input) => ({
    id: input.id,
    createdBy: actor,
    fromId: reg(input.fromId, clock),
    toId: reg(input.toId, clock),
    fromAnchor: reg(input.fromAnchor ?? 'auto', clock),
    toAnchor: reg(input.toAnchor ?? 'auto', clock),
    route: reg(input.route ?? 'elbow', clock),
    arrowStart: reg(input.arrowStart ?? false, clock),
    arrowEnd: reg(input.arrowEnd ?? true, clock),
    dashed: reg(input.dashed ?? false, clock),
    color: reg(input.color ?? '#d5dbe3', clock),
    width: reg(input.width ?? 2, clock),
    label: reg(input.label ?? '', clock),
  }))
  return patchResult(state, { kind: 'patch', epoch: state.epoch, connectors })
}

export function patchConnectors(
  state: DocState,
  patches: ConnectorState[],
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } {
  const clock = nextClock(state, actor, now)
  const connectors = patches.map((patch) => {
    const next: ConnectorState = { id: patch.id }
    if (patch.tomb) next.tomb = reg(patch.tomb.v, clock)
    if (patch.fromId) next.fromId = reg(patch.fromId.v, clock)
    if (patch.toId) next.toId = reg(patch.toId.v, clock)
    if (patch.fromAnchor) next.fromAnchor = reg(patch.fromAnchor.v, clock)
    if (patch.toAnchor) next.toAnchor = reg(patch.toAnchor.v, clock)
    if (patch.route) next.route = reg(patch.route.v, clock)
    if (patch.arrowStart) next.arrowStart = reg(patch.arrowStart.v, clock)
    if (patch.arrowEnd) next.arrowEnd = reg(patch.arrowEnd.v, clock)
    if (patch.dashed) next.dashed = reg(patch.dashed.v, clock)
    if (patch.color) next.color = reg(patch.color.v, clock)
    if (patch.width) next.width = reg(patch.width.v, clock)
    if (patch.label) next.label = reg(patch.label.v, clock)
    return next
  })
  return patchResult(state, { kind: 'patch', epoch: state.epoch, connectors })
}

export function addStrokes(
  state: DocState,
  inputs: Array<{
    id: string
    tool: StrokeTool
    color: string
    width: number
    opacity: number
    points: Point[]
  }>,
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } {
  const clock = nextClock(state, actor, now)
  const strokes: StrokeState[] = inputs.map((input) => ({
    id: input.id,
    createdBy: actor,
    tool: reg(input.tool, clock),
    color: reg(input.color, clock),
    width: reg(input.width, clock),
    opacity: reg(input.opacity, clock),
    points: reg(input.points.slice(0, 2000), clock),
  }))
  return patchResult(state, { kind: 'patch', epoch: state.epoch, strokes })
}

export function deleteStrokes(
  state: DocState,
  ids: string[],
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } | null {
  if (!ids.length) return null
  const clock = nextClock(state, actor, now)
  const strokes = ids.map((id) => ({ id, tomb: reg(true, clock) }))
  return patchResult(state, { kind: 'patch', epoch: state.epoch, strokes })
}

export function duplicateElements(
  state: DocState,
  ids: string[],
  actor: string,
  now: number,
  createId: () => string,
): { state: DocState; op: CanvasOp; newIds: string[] } | null {
  const view = materialize(state)
  const selected = new Set(expandIds(state, ids))
  const elements = view.elements.filter((element) => selected.has(element.id))
  if (!elements.length) return null
  const idMap = new Map(elements.map((element) => [element.id, createId()]))
  const created = addElements(
    state,
    elements.map((element) => ({
      id: idMap.get(element.id)!,
      type: element.type,
      x: element.x + 24,
      y: element.y + 24,
      width: element.width,
      height: element.height,
      label: element.label,
      description: element.description,
      fill: element.fill,
      z: element.z + elements.length,
      parentId: element.parentId && idMap.has(element.parentId) ? idMap.get(element.parentId)! : element.parentId,
    })),
    actor,
    now,
  )
  const connectors = view.connectors.filter(
    (connector) => selected.has(connector.fromId) && selected.has(connector.toId),
  )
  if (!connectors.length) {
    return { ...created, newIds: [...idMap.values()] }
  }
  const linked = addConnectors(
    created.state,
    connectors.map((connector) => ({
      id: createId(),
      fromId: idMap.get(connector.fromId)!,
      toId: idMap.get(connector.toId)!,
      route: connector.route,
      arrowStart: connector.arrowStart,
      arrowEnd: connector.arrowEnd,
      dashed: connector.dashed,
      color: connector.color,
      width: connector.width,
      label: connector.label,
      fromAnchor: connector.fromAnchor,
      toAnchor: connector.toAnchor,
    })),
    actor,
    now + 1,
  )
  return {
    state: linked.state,
    newIds: [...idMap.values()],
    op: {
      kind: 'patch',
      epoch: state.epoch,
      elements: created.op.elements,
      connectors: linked.op.connectors,
    },
  }
}

export function groupElements(
  state: DocState,
  ids: string[],
  groupId: string,
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } | null {
  const view = materialize(state).elements.filter((element) => ids.includes(element.id))
  if (view.length < 2) return null
  const pad = 28
  const minX = Math.min(...view.map((element) => element.x)) - pad
  const minY = Math.min(...view.map((element) => element.y)) - pad
  const maxX = Math.max(...view.map((element) => element.x + element.width)) + pad
  const maxY = Math.max(...view.map((element) => element.y + element.height)) + pad
  const z = Math.min(...view.map((element) => element.z)) - 1
  const clock = nextClock(state, actor, now)
  const elements: ElementState[] = [
    {
      id: groupId,
      createdBy: actor,
      type: reg('boundary', clock),
      x: reg(minX, clock),
      y: reg(minY, clock),
      width: reg(maxX - minX, clock),
      height: reg(maxY - minY, clock),
      label: reg('Group', clock),
      description: reg('', clock),
      fill: reg(null, clock),
      z: reg(z, clock),
      parentId: reg(null, clock),
    },
    ...view.map((element) => ({
      id: element.id,
      parentId: reg<string | null>(groupId, clock),
    })),
  ]
  return patchResult(state, { kind: 'patch', epoch: state.epoch, elements })
}

export function ungroupElements(
  state: DocState,
  ids: string[],
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } | null {
  const view = materialize(state)
  const parents = new Set<string>()
  for (const id of ids) {
    const element = view.elements.find((item) => item.id === id)
    if (!element) continue
    if (element.parentId) parents.add(element.parentId)
    if (view.elements.some((item) => item.parentId === element.id)) parents.add(element.id)
  }
  if (!parents.size) return null
  const patches = view.elements
    .filter((element) => element.parentId && parents.has(element.parentId))
    .map((element) => ({ id: element.id, parentId: reg<string | null>(null, { t: 0, a: actor }) }))
  if (!patches.length) return null
  return patchElements(state, patches, actor, now)
}

export function reorderElement(
  state: DocState,
  id: string,
  direction: 'forward' | 'backward',
  actor: string,
  now: number,
): { state: DocState; op: CanvasOp } | null {
  const elements = [...materialize(state).elements].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
  const index = elements.findIndex((element) => element.id === id)
  if (index < 0) return null
  const swapWith = direction === 'forward' ? elements[index + 1] : elements[index - 1]
  if (!swapWith) return null
  const current = elements[index]!
  const nextZ = direction === 'forward' ? swapWith.z + 1 : swapWith.z - 1
  if (nextZ === current.z) return null
  return patchElements(state, [{ id, z: reg(nextZ, { t: 0, a: actor }) }], actor, now)
}

export function contentBounds(view: ViewModel): { x: number; y: number; width: number; height: number } | null {
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = view.elements.map((element) => ({
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  }))
  for (const stroke of view.strokes) {
    for (const point of stroke.points) boxes.push({ x: point.x, y: point.y, width: 0, height: 0 })
  }
  if (!boxes.length) return null
  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  const maxY = Math.max(...boxes.map((box) => box.y + box.height))
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}
