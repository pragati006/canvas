import { useEffect, useState } from 'react'
import {
  addConnectors,
  deleteElements,
  materialize,
  patchConnectors,
  patchElements,
  placeElement,
  reorderElement,
  reg,
  type DocState,
} from '../../canvas/model'
import { paletteItem, STICKY_COLORS } from '../../canvas/palette'
import { createId } from '../../lib/crypto'
import type { CommitResult } from '../../hooks/useRoom'
import type { Role, Session } from '../../services/domain'

export function SidePanel({
  document,
  selection,
  session,
  role,
  actorId,
  readOnly,
  onSelection,
  onCommit,
  onPrompt,
  onClear,
  open = false,
}: {
  document: DocState
  selection: string[]
  session: Session
  role: Role
  actorId: string
  readOnly: boolean
  onSelection: (ids: string[]) => void
  onCommit: (build: (state: DocState) => CommitResult | null) => Promise<CommitResult | undefined>
  onPrompt: (prompt: string) => void
  onClear: () => void
  open?: boolean
}) {
  const view = materialize(document)
  const element = view.elements.find((item) => item.id === selection[0])
  const connector = view.connectors.find((item) => item.id === selection[0])
  const [prompt, setPrompt] = useState(session.prompt)
  useEffect(() => setPrompt(session.prompt), [session.prompt])

  return (
    <aside className={open ? 'side-panel open' : 'side-panel'} aria-label="Properties">
      {selection.length === 1 && element ? (
        <>
          <h2>{paletteItem(element.type).label}</h2>
          <label>
            Label
            <input
              value={element.label}
              disabled={readOnly}
              onChange={(event) => {
                const value = event.target.value
                void onCommit((state) =>
                  patchElements(state, [{ id: element.id, label: reg(value, { t: 0, a: actorId }) }], actorId, Date.now()),
                )
              }}
            />
          </label>
          <label>
            Description
            <textarea
              value={element.description}
              disabled={readOnly}
              onChange={(event) => {
                const value = event.target.value
                void onCommit((state) =>
                  patchElements(
                    state,
                    [{ id: element.id, description: reg(value, { t: 0, a: actorId }) }],
                    actorId,
                    Date.now(),
                  ),
                )
              }}
            />
          </label>
          <div className="prop-grid">
            <NumberField label="X" value={element.x} disabled={readOnly} onChange={(value) => void onCommit((state) => placeElement(state, element.id, { ...element, x: value }, actorId, Date.now()))} />
            <NumberField label="Y" value={element.y} disabled={readOnly} onChange={(value) => void onCommit((state) => placeElement(state, element.id, { ...element, y: value }, actorId, Date.now()))} />
            <NumberField label="Width" value={element.width} disabled={readOnly} onChange={(value) => void onCommit((state) => placeElement(state, element.id, { ...element, width: value }, actorId, Date.now()))} />
            <NumberField label="Height" value={element.height} disabled={readOnly} onChange={(value) => void onCommit((state) => placeElement(state, element.id, { ...element, height: value }, actorId, Date.now()))} />
          </div>
          {element.type === 'sticky' || element.type === 'rect' || element.type === 'text' ? (
            <div className="cluster" aria-label="Fill color">
              {(element.type === 'text' ? ['#f4efe6', '#8fd0c6', '#f0b429'] : STICKY_COLORS).map((color) => (
                <button
                  key={color}
                  type="button"
                  className="swatch"
                  style={{ background: color }}
                  aria-label={`Fill ${color}`}
                  disabled={readOnly}
                  onClick={() =>
                    void onCommit((state) =>
                      patchElements(state, [{ id: element.id, fill: reg(color, { t: 0, a: actorId }) }], actorId, Date.now()),
                    )
                  }
                />
              ))}
            </div>
          ) : null}
          <label>
            Connect to
            <select
              defaultValue=""
              disabled={readOnly}
              aria-label="Connect to"
              onChange={(event) => {
                const toId = event.target.value
                if (!toId) return
                void onCommit((state) =>
                  addConnectors(state, [{ id: createId(), fromId: element.id, toId, label: '' }], actorId, Date.now()),
                )
                event.target.value = ''
              }}
            >
              <option value="">Choose a component</option>
              {view.elements
                .filter((item) => item.id !== element.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label || paletteItem(item.type).label}
                  </option>
                ))}
            </select>
          </label>
          <div className="cluster">
            <button type="button" className="btn secondary small" disabled={readOnly} onClick={() => void onCommit((state) => reorderElement(state, element.id, 'forward', actorId, Date.now()))}>
              Forward
            </button>
            <button type="button" className="btn secondary small" disabled={readOnly} onClick={() => void onCommit((state) => reorderElement(state, element.id, 'backward', actorId, Date.now()))}>
              Backward
            </button>
            <button type="button" className="btn ghost small" disabled={readOnly} onClick={() => void onCommit((state) => deleteElements(state, [element.id], actorId, Date.now()))}>
              Delete
            </button>
          </div>
        </>
      ) : null}
      {selection.length === 1 && connector ? (
        <>
          <h2>Connector</h2>
          <label>
            Label
            <input
              value={connector.label}
              disabled={readOnly}
              onChange={(event) => {
                const value = event.target.value
                void onCommit((state) =>
                  patchConnectors(state, [{ id: connector.id, label: reg(value, { t: 0, a: actorId }) }], actorId, Date.now()),
                )
              }}
            />
          </label>
          <label>
            Route
            <select
              value={connector.route}
              disabled={readOnly}
              onChange={(event) =>
                void onCommit((state) =>
                  patchConnectors(
                    state,
                    [{ id: connector.id, route: reg(event.target.value as 'straight' | 'elbow' | 'curved', { t: 0, a: actorId }) }],
                    actorId,
                    Date.now(),
                  ),
                )
              }
            >
              <option value="straight">Straight</option>
              <option value="elbow">Elbow</option>
              <option value="curved">Curved</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={connector.arrowEnd}
              disabled={readOnly}
              onChange={(event) =>
                void onCommit((state) =>
                  patchConnectors(state, [{ id: connector.id, arrowEnd: reg(event.target.checked, { t: 0, a: actorId }) }], actorId, Date.now()),
                )
              }
            />
            Arrow at end
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={connector.dashed}
              disabled={readOnly}
              onChange={(event) =>
                void onCommit((state) =>
                  patchConnectors(state, [{ id: connector.id, dashed: reg(event.target.checked, { t: 0, a: actorId }) }], actorId, Date.now()),
                )
              }
            />
            Dashed line
          </label>
          <button
            type="button"
            className="btn ghost small"
            disabled={readOnly}
            onClick={() =>
              void onCommit((state) =>
                patchConnectors(state, [{ id: connector.id, tomb: reg(true, { t: 0, a: actorId }) }], actorId, Date.now()),
              )
            }
          >
            Delete connector
          </button>
        </>
      ) : null}
      {selection.length === 0 ? (
        <>
          <h2>Prompt</h2>
          {role === 'owner' && session.state !== 'ended' && session.state !== 'archived' ? (
            <label>
              Problem statement
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onBlur={() => onPrompt(prompt)} />
            </label>
          ) : (
            <p>{session.prompt || 'No problem statement was added.'}</p>
          )}
          <h3>Diagram objects</h3>
          <div className="object-list">
            {view.elements.length === 0 ? <p className="muted">Nothing on the canvas yet.</p> : null}
            {view.elements.map((item) => (
              <button key={item.id} type="button" onClick={() => onSelection([item.id])}>
                {item.label || paletteItem(item.type).label}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {selection.length > 1 ? <p>{selection.length} objects selected. Drag to move them together.</p> : null}
      {role === 'owner' && !readOnly ? (
        <div className="destructive">
          <button type="button" className="btn ghost" onClick={onClear}>
            Clear canvas
          </button>
        </div>
      ) : null}
    </aside>
  )
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={Math.round(value)}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}
