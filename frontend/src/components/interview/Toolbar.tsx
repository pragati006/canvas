import type { EditorTool } from '../canvas/CanvasEditor'
import { PALETTE, type PaletteCategory } from '../../canvas/palette'
import type { ComponentType } from '../../canvas/model'

const TOOLS: Array<{ id: EditorTool; label: string; shortcut: string; icon: string }> = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: '↖' },
  { id: 'pan', label: 'Pan', shortcut: 'H', icon: '✋' },
  { id: 'pen', label: 'Pen', shortcut: 'P', icon: '✎' },
  { id: 'highlighter', label: 'Highlighter', shortcut: 'G', icon: '▬' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E', icon: '⌫' },
  { id: 'text', label: 'Text', shortcut: 'T', icon: 'T' },
  { id: 'sticky', label: 'Sticky note', shortcut: 'N', icon: '▣' },
  { id: 'connector', label: 'Connector', shortcut: 'C', icon: '↗' },
  { id: 'laser', label: 'Laser pointer', shortcut: 'L', icon: '◎' },
]

export function Toolbar({
  tool,
  placeType,
  disabled,
  paletteOpen,
  onTool,
  onTogglePalette,
  onPlace,
}: {
  tool: EditorTool
  placeType: ComponentType
  disabled: boolean
  paletteOpen: boolean
  onTool: (tool: EditorTool) => void
  onTogglePalette: () => void
  onPlace: (type: ComponentType) => void
}) {
  const categories = [...new Set(PALETTE.map((item) => item.category))]
  return (
    <div className="toolbar" role="toolbar" aria-label="Canvas tools">
      {TOOLS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="tool-btn"
          title={`${item.label} (${item.shortcut})`}
          aria-label={item.label}
          aria-pressed={tool === item.id}
          disabled={disabled && item.id !== 'pan' && item.id !== 'select'}
          onClick={() => onTool(item.id)}
        >
          <span aria-hidden="true">{item.icon}</span>
        </button>
      ))}
      <button
        type="button"
        className="tool-btn"
        title="Components"
        aria-label="Component library"
        aria-pressed={paletteOpen || tool === 'place'}
        disabled={disabled}
        onClick={onTogglePalette}
      >
        <span aria-hidden="true">＋</span>
      </button>
      {paletteOpen ? (
        <div className="palette" role="dialog" aria-label="Component library">
          <h2>Components</h2>
          <input
            aria-label="Filter components"
            placeholder="Filter"
            onChange={(event) => {
              const query = event.target.value.toLowerCase()
              document.querySelectorAll<HTMLElement>('[data-component]').forEach((node) => {
                node.hidden = !node.dataset.component?.includes(query)
              })
            }}
          />
          {categories.map((category) => (
            <PaletteGroup
              key={category}
              category={category}
              placeType={placeType}
              onPlace={onPlace}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PaletteGroup({
  category,
  placeType,
  onPlace,
}: {
  category: PaletteCategory
  placeType: ComponentType
  onPlace: (type: ComponentType) => void
}) {
  const items = PALETTE.filter((item) => item.category === category)
  return (
    <div className="palette-group">
      <p>{category}</p>
      {items.map((item) => (
        <button
          key={item.type}
          type="button"
          className="component"
          data-component={`${item.label} ${item.blurb}`.toLowerCase()}
          aria-pressed={placeType === item.type}
          onClick={() => onPlace(item.type)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
