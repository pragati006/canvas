import type { AnchorSide, Point, ViewConnector, ViewElement, ViewModel, ViewStroke } from './model'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Viewport {
  panX: number
  panY: number
  zoom: number
}

export interface Guide {
  orientation: 'vertical' | 'horizontal'
  position: number
}

export type HandleName = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export type Hit =
  | { kind: 'handle'; id: string; handle: HandleName }
  | { kind: 'element'; id: string }
  | { kind: 'connector'; id: string }
  | { kind: 'stroke'; id: string }
  | { kind: 'none' }

const HANDLES: HandleName[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom,
  }
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY,
  }
}

export function fitViewport(
  bounds: Rect | null,
  screen: { width: number; height: number },
): Viewport {
  if (!bounds) return { panX: 80, panY: 72, zoom: 1 }
  const pad = 96
  const zoom = clamp(
    Math.min((screen.width - pad) / bounds.width, (screen.height - pad) / bounds.height),
    0.2,
    2,
  )
  return {
    zoom,
    panX: (screen.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    panY: (screen.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  }
}

export function anchorPoint(rect: Rect, side: AnchorSide): Point {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  if (side === 'top') return { x: cx, y: rect.y }
  if (side === 'right') return { x: rect.x + rect.width, y: cy }
  if (side === 'bottom') return { x: cx, y: rect.y + rect.height }
  if (side === 'left') return { x: rect.x, y: cy }
  return { x: cx, y: cy }
}

export function chooseAnchors(from: Rect, to: Rect): [AnchorSide, AnchorSide] {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

export function routePoints(from: Point, to: Point, fromSide: AnchorSide, route: ViewConnector['route']): Point[] {
  if (route === 'straight') return [from, to]
  const horizontal = fromSide === 'left' || fromSide === 'right'
  if (route === 'elbow') {
    if (horizontal) {
      const midX = (from.x + to.x) / 2
      return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]
    }
    const midY = (from.y + to.y) / 2
    return [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to]
  }
  const bend = horizontal ? { x: (from.x + to.x) / 2, y: from.y } : { x: from.x, y: (from.y + to.y) / 2 }
  const bend2 = horizontal ? { x: (from.x + to.x) / 2, y: to.y } : { x: to.x, y: (from.y + to.y) / 2 }
  return [from, bend, bend2, to]
}

export function pointsToPath(points: Point[], curved: boolean): string {
  if (!points.length) return ''
  if (!curved || points.length < 4) {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  }
  return `M ${points[0]!.x} ${points[0]!.y} C ${points[1]!.x} ${points[1]!.y}, ${points[2]!.x} ${points[2]!.y}, ${points[3]!.x} ${points[3]!.y}`
}

export function connectorFigure(
  connector: ViewConnector,
  elements: Map<string, ViewElement>,
): { points: Point[]; path: string; labelAt: Point } | null {
  const from = elements.get(connector.fromId)
  const to = elements.get(connector.toId)
  if (!from || !to) return null
  const [autoFrom, autoTo] = chooseAnchors(from, to)
  const fromSide = connector.fromAnchor === 'auto' ? autoFrom : connector.fromAnchor
  const toSide = connector.toAnchor === 'auto' ? autoTo : connector.toAnchor
  const start = anchorPoint(from, fromSide)
  const end = anchorPoint(to, toSide)
  const points = routePoints(start, end, fromSide, connector.route)
  const labelAt = points[Math.floor(points.length / 2)] ?? start
  return { points, path: pointsToPath(points, connector.route === 'curved'), labelAt }
}

export function arrowPolygon(tip: Point, from: Point, size: number): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const left = {
    x: tip.x - size * Math.cos(angle) + (size * 0.55) * Math.sin(angle),
    y: tip.y - size * Math.sin(angle) - (size * 0.55) * Math.cos(angle),
  }
  const right = {
    x: tip.x - size * Math.cos(angle) - (size * 0.55) * Math.sin(angle),
    y: tip.y - size * Math.sin(angle) + (size * 0.55) * Math.cos(angle),
  }
  return `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1)
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

export function distanceToPolyline(point: Point, points: Point[]): number {
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length - 1; index += 1) {
    best = Math.min(best, distanceToSegment(point, points[index]!, points[index + 1]!))
  }
  return best
}

export function handlePoint(rect: Rect, handle: HandleName): Point {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  switch (handle) {
    case 'nw':
      return { x: rect.x, y: rect.y }
    case 'n':
      return { x: cx, y: rect.y }
    case 'ne':
      return { x: right, y: rect.y }
    case 'e':
      return { x: right, y: cy }
    case 'se':
      return { x: right, y: bottom }
    case 's':
      return { x: cx, y: bottom }
    case 'sw':
      return { x: rect.x, y: bottom }
    case 'w':
      return { x: rect.x, y: cy }
  }
}

export function resizeRect(
  start: Rect,
  handle: HandleName,
  point: Point,
  minWidth: number,
  minHeight: number,
): Rect {
  let x = start.x
  let y = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (handle.includes('w')) x = Math.min(point.x, right - minWidth)
  if (handle.includes('e')) right = Math.max(point.x, x + minWidth)
  if (handle.includes('n')) y = Math.min(point.y, bottom - minHeight)
  if (handle.includes('s')) bottom = Math.max(point.y, y + minHeight)
  return { x, y, width: right - x, height: bottom - y }
}

export function hitTest(
  view: ViewModel,
  point: Point,
  options: { selectedId?: string | null; zoom: number; handleSize?: number },
): Hit {
  const threshold = (options.handleSize ?? 8) / options.zoom
  if (options.selectedId) {
    const selected = view.elements.find((element) => element.id === options.selectedId)
    if (selected) {
      for (const handle of HANDLES) {
        const at = handlePoint(selected, handle)
        if (Math.hypot(point.x - at.x, point.y - at.y) <= threshold) {
          return { kind: 'handle', id: selected.id, handle }
        }
      }
    }
  }
  const elements = [...view.elements].sort((a, b) => b.z - a.z || (a.id < b.id ? 1 : -1))
  for (const element of elements) {
    if (
      point.x >= element.x &&
      point.x <= element.x + element.width &&
      point.y >= element.y &&
      point.y <= element.y + element.height
    ) {
      return { kind: 'element', id: element.id }
    }
  }
  const map = new Map(view.elements.map((element) => [element.id, element]))
  for (const connector of view.connectors) {
    const figure = connectorFigure(connector, map)
    if (figure && distanceToPolyline(point, figure.points) <= 8 / options.zoom) {
      return { kind: 'connector', id: connector.id }
    }
  }
  for (const stroke of view.strokes) {
    if (distanceToPolyline(point, stroke.points) <= (stroke.width + 6) / options.zoom) {
      return { kind: 'stroke', id: stroke.id }
    }
  }
  return { kind: 'none' }
}

export function strokesUnderPoint(strokes: ViewStroke[], point: Point, radius: number): string[] {
  return strokes
    .filter((stroke) => distanceToPolyline(point, stroke.points) <= radius + stroke.width / 2)
    .map((stroke) => stroke.id)
}

export function snapPoint(
  proposed: Point,
  rect: Rect,
  others: Rect[],
  options: { grid: number; threshold: number; enabled: boolean },
): { point: Point; guides: Guide[] } {
  let x = proposed.x
  let y = proposed.y
  const guides: Guide[] = []
  if (!options.enabled) return { point: proposed, guides }
  const gridX = Math.round(proposed.x / options.grid) * options.grid
  const gridY = Math.round(proposed.y / options.grid) * options.grid
  let bestX = Math.abs(gridX - proposed.x)
  let bestY = Math.abs(gridY - proposed.y)
  x = gridX
  y = gridY
  const xEdges = (value: number) => [value, value + rect.width / 2, value + rect.width]
  const yEdges = (value: number) => [value, value + rect.height / 2, value + rect.height]
  for (const other of others) {
    const otherX = [other.x, other.x + other.width / 2, other.x + other.width]
    const otherY = [other.y, other.y + other.height / 2, other.y + other.height]
    xEdges(proposed.x).forEach((edge, index) => {
      for (const target of otherX) {
        const dist = Math.abs(edge - target)
        if (dist <= options.threshold && dist <= bestX) {
          x = proposed.x + (target - edge)
          bestX = dist
          guides.push({ orientation: 'vertical', position: target })
          void index
        }
      }
    })
    yEdges(proposed.y).forEach((edge) => {
      for (const target of otherY) {
        const dist = Math.abs(edge - target)
        if (dist <= options.threshold && dist <= bestY) {
          y = proposed.y + (target - edge)
          bestY = dist
          guides.push({ orientation: 'horizontal', position: target })
        }
      }
    })
  }
  return { point: { x, y }, guides }
}

export function marqueeHits(elements: ViewElement[], rect: Rect): string[] {
  const left = rect.width < 0 ? rect.x + rect.width : rect.x
  const top = rect.height < 0 ? rect.y + rect.height : rect.y
  const right = left + Math.abs(rect.width)
  const bottom = top + Math.abs(rect.height)
  return elements
    .filter((element) => {
      const elRight = element.x + element.width
      const elBottom = element.y + element.height
      return element.x < right && elRight > left && element.y < bottom && elBottom > top
    })
    .map((element) => element.id)
}

export function normalizeRect(rect: Rect): Rect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}
