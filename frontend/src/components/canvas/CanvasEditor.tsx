import { useEffect, useRef, useState } from 'react'
import {
  addConnectors,
  addElements,
  addStrokes,
  deleteElements,
  deleteStrokes,
  duplicateElements,
  expandIds,
  groupElements,
  materialize,
  patchConnectors,
  patchElements,
  placeElement,
  reorderElement,
  ungroupElements,
  reg,
  type DocState,
  type Point,
  type ViewElement,
} from '../../canvas/model'
import {
  arrowPolygon,
  connectorFigure,
  distanceToPolyline,
  fitViewport,
  hitTest,
  marqueeHits,
  normalizeRect,
  resizeRect,
  screenToWorld,
  snapPoint,
  type HandleName,
  type Viewport,
} from '../../canvas/geometry'
import { paletteItem, PEN_COLORS, STICKY_COLORS } from '../../canvas/palette'
import { createId } from '../../lib/crypto'
import type { Presence } from '../../services/api'
import type { CommitResult } from '../../hooks/useRoom'
import { DiagramNode } from './shapes'

export type EditorTool =
  | 'select'
  | 'pan'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'text'
  | 'sticky'
  | 'connector'
  | 'laser'
  | 'place'

type Drag =
  | { kind: 'pan'; sx: number; sy: number; panX: number; panY: number }
  | { kind: 'move'; origin: Point; ids: string[]; start: Record<string, Point>; dx: number; dy: number }
  | { kind: 'resize'; id: string; handle: HandleName; start: ViewElement; rect: ViewElement }
  | { kind: 'marquee'; origin: Point; current: Point; additive: boolean }
  | { kind: 'draw'; tool: 'pen' | 'highlighter'; points: Point[] }
  | { kind: 'connect'; fromId: string; current: Point }
  | { kind: 'laser' }
  | { kind: 'erase' }

export function CanvasEditor({
  document,
  readOnly,
  tool,
  placeType,
  strokeColor,
  onStrokeColor,
  strokeWidth,
  route,
  dashed,
  arrowEnd,
  selection,
  onSelection,
  onCommit,
  onTool,
  actorId,
  actorName,
  actorColor,
  presences,
  cursorsVisible,
  onPresence,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  document: DocState
  readOnly: boolean
  tool: EditorTool
  placeType: string
  strokeColor: string
  onStrokeColor: (color: string) => void
  strokeWidth: number
  route: 'straight' | 'elbow' | 'curved'
  dashed: boolean
  arrowEnd: boolean
  selection: string[]
  onSelection: (ids: string[]) => void
  onCommit: (build: (state: DocState) => CommitResult | null) => Promise<CommitResult | undefined>
  onTool: (tool: EditorTool) => void
  actorId: string
  actorName: string
  actorColor: string
  presences: Presence[]
  cursorsVisible: boolean
  onPresence: (update: { cursor?: Point | null; selection?: string[]; laser?: Point | null }) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ panX: 80, panY: 72, zoom: 1 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const [snap, setSnap] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  const viewportRef = useRef(viewport)
  const docRef = useRef(document)
  const selectionRef = useRef(selection)
  const spaceRef = useRef(false)
  viewportRef.current = viewport
  docRef.current = document
  selectionRef.current = selection

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = svg.getBoundingClientRect()
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      setViewport((current) => {
        if (event.ctrlKey || event.metaKey) {
          const world = screenToWorld(screen, current)
          const zoom = clamp(current.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.2, 2.5)
          return { zoom, panX: screen.x - world.x * zoom, panY: screen.y - world.y * zoom }
        }
        return { ...current, panX: current.panX - event.deltaX, panY: current.panY - event.deltaY }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) onRedo()
        else onUndo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault()
        onRedo()
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        spaceRef.current = true
      }
      if (readOnly) return
      if ((event.ctrlKey || event.metaKey) && key === 'd') {
        event.preventDefault()
        void onCommit((state) => duplicateElements(state, selectionRef.current, actorId, Date.now(), createId)).then((result) => {
          if (result?.newIds?.length) onSelection(result.newIds)
        })
      }
      if ((event.ctrlKey || event.metaKey) && key === 'g') {
        event.preventDefault()
        if (event.shiftKey) void onCommit((state) => ungroupElements(state, selectionRef.current, actorId, Date.now()))
        else void onCommit((state) => groupElements(state, selectionRef.current, createId(), actorId, Date.now()))
      }
      if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault()
        onSelection(materialize(docRef.current).elements.map((element) => element.id))
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        void removeIds(selectionRef.current)
      }
      if (event.key === 'Escape') onSelection([])
      if (event.key === 'Enter' && selectionRef.current.length === 1) beginEdit(selectionRef.current[0]!)
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        event.preventDefault()
        const step = event.shiftKey ? 16 : 4
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
        void nudge(dx, dy)
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const next = shortcutTool(event.key)
        if (next) onTool(next)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') spaceRef.current = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [actorId, onCommit, onRedo, onSelection, onTool, onUndo, readOnly])

  const view = materialize(document)
  const displayed = view.elements.map((element) => displayElement(element, drag))
  const elementMap = new Map(displayed.map((element) => [element.id, element]))

  function localPoint(event: { clientX: number; clientY: number }): Point {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  async function removeIds(ids: string[]) {
    const current = materialize(docRef.current)
    const elementIds = ids.filter((id) => current.elements.some((element) => element.id === id))
    const connectorIds = ids.filter((id) => current.connectors.some((connector) => connector.id === id))
    const strokeIds = ids.filter((id) => current.strokes.some((stroke) => stroke.id === id))
    if (elementIds.length) await onCommit((state) => deleteElements(state, elementIds, actorId, Date.now()))
    if (connectorIds.length) {
      await onCommit((state) =>
        patchConnectors(
          state,
          connectorIds.map((id) => ({ id, tomb: reg(true, { t: 0, a: actorId }) })),
          actorId,
          Date.now(),
        ),
      )
    }
    if (strokeIds.length) await onCommit((state) => deleteStrokes(state, strokeIds, actorId, Date.now()))
    onSelection([])
  }

  async function nudge(dx: number, dy: number) {
    const ids = expandIds(docRef.current, selectionRef.current)
    await onCommit((state) => {
      const patches = materialize(state)
        .elements.filter((element) => ids.includes(element.id))
        .map((element) => ({
          id: element.id,
          x: reg(element.x + dx, { t: 0, a: actorId }),
          y: reg(element.y + dy, { t: 0, a: actorId }),
        }))
      return patches.length ? patchElements(state, patches, actorId, Date.now()) : null
    })
  }

  function beginEdit(id: string) {
    const element = materialize(docRef.current).elements.find((item) => item.id === id)
    if (!element) return
    setEditingId(id)
    setLabelDraft(element.label)
  }

  async function commitLabel() {
    const id = editingId
    setEditingId(null)
    if (!id) return
    await onCommit((state) =>
      patchElements(state, [{ id, label: reg(labelDraft, { t: 0, a: actorId }) }], actorId, Date.now()),
    )
  }

  function placeAt(world: Point) {
    const type = tool === 'text' ? 'text' : tool === 'sticky' ? 'sticky' : placeType
    const item = paletteItem(type as ViewElement['type'])
    const id = createId()
    void onCommit((state) =>
      addElements(
        state,
        [
          {
            id,
            type: item.type,
            x: world.x - item.width / 2,
            y: world.y - item.height / 2,
            width: item.width,
            height: item.height,
            label: item.type === 'text' ? 'Label' : item.label,
            fill: item.type === 'sticky' ? STICKY_COLORS[0]! : item.type === 'text' ? '#f4efe6' : null,
          },
        ],
        actorId,
        Date.now(),
      ),
    )
    onSelection([id])
    if (tool !== 'place') onTool('select')
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (editingId) return
    svgRef.current?.setPointerCapture(event.pointerId)
    const world = screenToWorld(localPoint(event), viewportRef.current)
    const currentView = materialize(docRef.current)
    if (event.button === 1 || tool === 'pan' || spaceRef.current) {
      setDrag({ kind: 'pan', sx: event.clientX, sy: event.clientY, panX: viewportRef.current.panX, panY: viewportRef.current.panY })
      return
    }
    if (readOnly) return
    if (tool === 'pen' || tool === 'highlighter') {
      setDrag({ kind: 'draw', tool, points: [world] })
      return
    }
    if (tool === 'eraser') {
      void erase(world)
      setDrag({ kind: 'erase' })
      return
    }
    if (tool === 'laser') {
      onPresence({ laser: world })
      setDrag({ kind: 'laser' })
      return
    }
    if (tool === 'text' || tool === 'sticky' || tool === 'place') {
      placeAt(world)
      return
    }
    if (tool === 'connector') {
      const hit = hitTest(currentView, world, { zoom: viewportRef.current.zoom })
      if (hit.kind === 'element') setDrag({ kind: 'connect', fromId: hit.id, current: world })
      return
    }
    const hit = hitTest(currentView, world, {
      zoom: viewportRef.current.zoom,
      selectedId: selection.length === 1 ? selection[0] : null,
    })
    if (hit.kind === 'handle') {
      const element = currentView.elements.find((item) => item.id === hit.id)
      if (element) setDrag({ kind: 'resize', id: hit.id, handle: hit.handle, start: element, rect: element })
      return
    }
    if (hit.kind === 'element' || hit.kind === 'connector' || hit.kind === 'stroke') {
      const next = event.shiftKey
        ? selection.includes(hit.id)
          ? selection.filter((id) => id !== hit.id)
          : [...selection, hit.id]
        : selection.includes(hit.id)
          ? selection
          : [hit.id]
      onSelection(next)
      onPresence({ selection: next })
      if (hit.kind === 'element' && !event.shiftKey) {
        const ids = expandIds(docRef.current, next)
        const start: Record<string, Point> = {}
        for (const element of currentView.elements) {
          if (ids.includes(element.id)) start[element.id] = { x: element.x, y: element.y }
        }
        setDrag({ kind: 'move', origin: world, ids, start, dx: 0, dy: 0 })
      }
      return
    }
    if (!event.shiftKey) onSelection([])
    setDrag({ kind: 'marquee', origin: world, current: world, additive: event.shiftKey })
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const world = screenToWorld(localPoint(event), viewportRef.current)
    onPresence({ cursor: world, selection: selectionRef.current })
    if (!drag) return
    if (drag.kind === 'pan') {
      setViewport((current) => ({
        ...current,
        panX: drag.panX + event.clientX - drag.sx,
        panY: drag.panY + event.clientY - drag.sy,
      }))
      return
    }
    if (drag.kind === 'move') {
      let dx = world.x - drag.origin.x
      let dy = world.y - drag.origin.y
      const anchorId = drag.ids[0]
      const anchor = anchorId ? drag.start[anchorId] : undefined
      const element = anchorId ? materialize(docRef.current).elements.find((item) => item.id === anchorId) : undefined
      if (anchor && element && snap) {
        const snapped = snapPoint(
          { x: anchor.x + dx, y: anchor.y + dy },
          element,
          view.elements.filter((item) => !drag.ids.includes(item.id)),
          { grid: 16, threshold: 6 / viewport.zoom, enabled: true },
        )
        dx = snapped.point.x - anchor.x
        dy = snapped.point.y - anchor.y
      }
      setDrag({ ...drag, dx, dy })
      return
    }
    if (drag.kind === 'resize') {
      const limits = paletteItem(drag.start.type)
      const point = snap
        ? { x: Math.round(world.x / 16) * 16, y: Math.round(world.y / 16) * 16 }
        : world
      const rect = resizeRect(drag.start, drag.handle, point, limits.minWidth, limits.minHeight)
      setDrag({ ...drag, rect: { ...drag.start, ...rect } })
      return
    }
    if (drag.kind === 'draw') setDrag({ ...drag, points: [...drag.points, world] })
    if (drag.kind === 'marquee' || drag.kind === 'connect') setDrag({ ...drag, current: world })
    if (drag.kind === 'laser') onPresence({ laser: world })
    if (drag.kind === 'erase') void erase(world)
  }

  async function onPointerUp() {
    const finished = drag
    setDrag(null)
    if (!finished || readOnly) return
    if (finished.kind === 'move' && (Math.abs(finished.dx) > 1 || Math.abs(finished.dy) > 1)) {
      await onCommit((state) => {
        const patches = Object.entries(finished.start).map(([id, point]) => ({
          id,
          x: reg(point.x + finished.dx, { t: 0, a: actorId }),
          y: reg(point.y + finished.dy, { t: 0, a: actorId }),
        }))
        return patchElements(state, patches, actorId, Date.now())
      })
    }
    if (finished.kind === 'resize') {
      await onCommit((state) => placeElement(state, finished.id, finished.rect, actorId, Date.now()))
    }
    if (finished.kind === 'draw' && finished.points.length > 1) {
      await onCommit((state) =>
        addStrokes(
          state,
          [
            {
              id: createId(),
              tool: finished.tool,
              color: strokeColor,
              width: finished.tool === 'highlighter' ? Math.max(strokeWidth, 12) : strokeWidth,
              opacity: finished.tool === 'highlighter' ? 0.35 : 1,
              points: simplify(finished.points),
            },
          ],
          actorId,
          Date.now(),
        ),
      )
    }
    if (finished.kind === 'connect') {
      const hit = hitTest(materialize(docRef.current), finished.current, { zoom: viewportRef.current.zoom })
      if (hit.kind === 'element' && hit.id !== finished.fromId) {
        await onCommit((state) =>
          addConnectors(
            state,
            [
              {
                id: createId(),
                fromId: finished.fromId,
                toId: hit.id,
                route,
                dashed,
                arrowEnd,
                color: '#d5dbe3',
              },
            ],
            actorId,
            Date.now(),
          ),
        )
      }
    }
    if (finished.kind === 'marquee') {
      const rect = normalizeRect({
        x: finished.origin.x,
        y: finished.origin.y,
        width: finished.current.x - finished.origin.x,
        height: finished.current.y - finished.origin.y,
      })
      const hits = marqueeHits(materialize(docRef.current).elements, rect)
      onSelection(finished.additive ? [...new Set([...selectionRef.current, ...hits])] : hits)
    }
    if (finished.kind === 'laser') onPresence({ laser: null })
  }

  async function erase(world: Point) {
    const strokes = materialize(docRef.current).strokes.filter(
      (stroke) => distanceToPolyline(world, stroke.points) <= 12 + stroke.width / 2,
    )
    if (strokes.length) await onCommit((state) => deleteStrokes(state, strokes.map((stroke) => stroke.id), actorId, Date.now()))
  }

  function zoomBy(factor: number) {
    setViewport((current) => ({ ...current, zoom: clamp(current.zoom * factor, 0.2, 2.5) }))
  }

  function fit() {
    const svg = svgRef.current
    if (!svg) return
    const bounds = displayed.reduce<{ x: number; y: number; width: number; height: number } | null>((box, element) => {
      if (!box) return element
      const minX = Math.min(box.x, element.x)
      const minY = Math.min(box.y, element.y)
      const maxX = Math.max(box.x + box.width, element.x + element.width)
      const maxY = Math.max(box.y + box.height, element.y + element.height)
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }, null)
    setViewport(fitViewport(bounds, { width: svg.clientWidth, height: svg.clientHeight }))
  }

  const editing = editingId ? elementMap.get(editingId) : undefined
  const editingScreen = editing
    ? {
        x: editing.x * viewport.zoom + viewport.panX,
        y: editing.y * viewport.zoom + viewport.panY,
        width: Math.max(80, editing.width * viewport.zoom),
      }
    : null

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className={`canvas-svg ${tool === 'pan' ? 'pan' : ''} ${tool === 'pen' || tool === 'highlighter' ? 'draw' : ''}`}
        data-testid="design-canvas"
        role="application"
        aria-label="System design canvas"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => void onPointerUp()}
        onDoubleClick={(event) => {
          const world = screenToWorld(localPoint(event), viewport)
          const hit = hitTest(view, world, { zoom: viewport.zoom })
          if (hit.kind === 'element') beginEdit(hit.id)
        }}
      >
        <defs>
          <pattern id="dot-grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="0.7" cy="0.7" r="0.7" fill="rgba(244,239,230,0.28)" />
          </pattern>
        </defs>
        <g transform={`translate(${viewport.panX} ${viewport.panY}) scale(${viewport.zoom})`}>
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#dot-grid)" />
          {view.strokes.map((stroke) => (
            <polyline
              key={stroke.id}
              points={stroke.points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeOpacity={stroke.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {drag?.kind === 'draw' ? (
            <polyline
              points={drag.points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={strokeColor}
              strokeWidth={drag.tool === 'highlighter' ? Math.max(strokeWidth, 12) : strokeWidth}
              strokeOpacity={drag.tool === 'highlighter' ? 0.35 : 1}
              strokeLinecap="round"
            />
          ) : null}
          {view.connectors.map((connector) => {
            const figure = connectorFigure(connector, elementMap)
            if (!figure) return null
            const selected = selection.includes(connector.id)
            return (
              <g key={connector.id}>
                <path
                  d={figure.path}
                  fill="none"
                  stroke={selected ? actorColor : connector.color}
                  strokeWidth={connector.width}
                  strokeDasharray={connector.dashed ? '8 6' : undefined}
                />
                {connector.arrowEnd ? (
                  <polygon points={arrowPolygon(figure.points.at(-1)!, figure.points.at(-2)!, 12)} fill={connector.color} />
                ) : null}
                {connector.arrowStart ? (
                  <polygon points={arrowPolygon(figure.points[0]!, figure.points[1]!, 12)} fill={connector.color} />
                ) : null}
                {connector.label ? (
                  <text x={figure.labelAt.x + 6} y={figure.labelAt.y - 6} fill="#f4efe6" fontSize={12}>
                    {connector.label}
                  </text>
                ) : null}
              </g>
            )
          })}
          {displayed.map((element) => (
            <DiagramNode
              key={element.id}
              element={element}
              selected={selection.includes(element.id)}
              color={actorColor}
            />
          ))}
          {cursorsVisible
            ? presences
                .filter((presence) => presence.participantId !== actorId)
                .map((presence) =>
                  presence.selection.map((id) => {
                    const element = elementMap.get(id)
                    if (!element) return null
                    return (
                      <g key={`${presence.participantId}-${id}`}>
                        <rect
                          x={element.x - 3}
                          y={element.y - 3}
                          width={element.width + 6}
                          height={element.height + 6}
                          fill="none"
                          stroke={presence.color}
                          strokeDasharray="4 3"
                        />
                        <text x={element.x} y={element.y - 8} fill={presence.color} fontSize={11}>
                          {presence.displayName}
                        </text>
                      </g>
                    )
                  }),
                )
            : null}
          {selection.length === 1 && elementMap.get(selection[0]!) ? (
            <Handles element={elementMap.get(selection[0]!)!} color={actorColor} zoom={viewport.zoom} name={actorName} />
          ) : null}
          {drag?.kind === 'marquee' ? (
            <rect
              x={Math.min(drag.origin.x, drag.current.x)}
              y={Math.min(drag.origin.y, drag.current.y)}
              width={Math.abs(drag.current.x - drag.origin.x)}
              height={Math.abs(drag.current.y - drag.origin.y)}
              fill="rgba(143,208,198,0.15)"
              stroke="#8fd0c6"
            />
          ) : null}
          {cursorsVisible
            ? presences
                .filter((presence) => presence.participantId !== actorId && presence.cursor)
                .map((presence) => (
                  <g key={presence.participantId} transform={`translate(${presence.cursor!.x} ${presence.cursor!.y})`}>
                    <path d="M0 0 L0 16 L4.5 12 L9 20 L11.5 19 L7 11 L13 10 Z" fill={presence.color} />
                    <text x="16" y="14" fill={presence.color} fontSize={12}>
                      {presence.displayName}
                    </text>
                  </g>
                ))
            : null}
          {cursorsVisible
            ? presences
                .filter((presence) => presence.laser)
                .map((presence) => (
                  <circle key={`${presence.participantId}-laser`} cx={presence.laser!.x} cy={presence.laser!.y} r={8} fill={presence.color} opacity={0.85} />
                ))
            : null}
        </g>
      </svg>
      <div className="sr-only" aria-live="polite">
        {selection.length ? `${selection.length} selected` : 'Nothing selected'}
      </div>
      {editing && editingScreen ? (
        <input
          className="canvas-label-input"
          style={{ left: editingScreen.x, top: editingScreen.y, width: editingScreen.width }}
          value={labelDraft}
          aria-label="Component label"
          autoFocus
          onChange={(event) => setLabelDraft(event.target.value)}
          onBlur={() => void commitLabel()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commitLabel()
            event.stopPropagation()
          }}
        />
      ) : null}
      {(tool === 'pen' || tool === 'highlighter') && !readOnly ? (
        <div className="tool-options" aria-label="Stroke color">
          {PEN_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="swatch"
              style={{ background: color }}
              aria-label={`Stroke ${color}`}
              aria-pressed={strokeColor === color}
              onClick={() => onStrokeColor(color)}
            />
          ))}
        </div>
      ) : null}
      <div className="zoombar" aria-label="Zoom and history">
        <button type="button" onClick={() => zoomBy(1 / 1.1)} aria-label="Zoom out">−</button>
        <span>{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.1)} aria-label="Zoom in">+</button>
        <button type="button" onClick={fit} aria-label="Zoom to fit">Fit</button>
        <button type="button" onClick={() => setViewport({ panX: 80, panY: 72, zoom: 1 })} aria-label="Reset view">Reset</button>
        <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo">Undo</button>
        <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Redo">Redo</button>
        <button type="button" aria-pressed={snap} onClick={() => setSnap((value) => !value)}>
          Snap
        </button>
      </div>
    </div>
  )
}

function Handles({ element, color, zoom, name }: { element: ViewElement; color: string; zoom: number; name: string }) {
  const size = 8 / zoom
  const points = [
    [element.x, element.y],
    [element.x + element.width, element.y],
    [element.x, element.y + element.height],
    [element.x + element.width, element.y + element.height],
  ]
  return (
    <g>
      <rect x={element.x} y={element.y} width={element.width} height={element.height} fill="none" stroke={color} strokeWidth={1.5 / zoom} />
      <text x={element.x} y={element.y - 8 / zoom} fill={color} fontSize={11 / zoom}>
        {name}
      </text>
      {points.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x! - size / 2} y={y! - size / 2} width={size} height={size} fill={color} />
      ))}
    </g>
  )
}

function displayElement(element: ViewElement, drag: Drag | null): ViewElement {
  if (drag?.kind === 'move' && drag.start[element.id]) {
    return { ...element, x: drag.start[element.id]!.x + drag.dx, y: drag.start[element.id]!.y + drag.dy }
  }
  if (drag?.kind === 'resize' && drag.id === element.id) return drag.rect
  return element
}

function simplify(points: Point[]) {
  const next: Point[] = []
  for (const point of points) {
    const last = next.at(-1)
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 1.5) next.push(point)
  }
  return next.slice(0, 2000)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

function shortcutTool(key: string): EditorTool | null {
  const map: Record<string, EditorTool> = {
    v: 'select',
    h: 'pan',
    p: 'pen',
    g: 'highlighter',
    e: 'eraser',
    t: 'text',
    n: 'sticky',
    c: 'connector',
    l: 'laser',
  }
  return map[key.toLowerCase()] ?? null
}

export const reorder = reorderElement
