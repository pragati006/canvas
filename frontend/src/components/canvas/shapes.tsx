import { categoryColor, paletteItem, shapeFill } from '../../canvas/palette'
import type { ViewElement } from '../../canvas/model'

export function DiagramNode({
  element,
  selected,
  color,
}: {
  element: ViewElement
  selected: boolean
  color?: string
}) {
  const fill = shapeFill(element.type, element.fill)
  const stroke = selected ? color ?? '#f4efe6' : 'rgba(28,25,21,0.35)'
  const text = element.type === 'text' ? element.fill || '#f4efe6' : '#1c1915'
  const radius = element.type === 'function' ? element.height / 2 : element.type === 'rounded' || element.type === 'service' ? 16 : 10
  return (
    <g transform={`translate(${element.x} ${element.y})`}>
      <title>{element.label || paletteItem(element.type).label}</title>
      {element.type === 'ellipse' ? (
        <ellipse cx={element.width / 2} cy={element.height / 2} rx={element.width / 2} ry={element.height / 2} fill={fill} stroke={stroke} strokeWidth={1.5} />
      ) : element.type === 'text' ? (
        <rect width={element.width} height={element.height} fill="transparent" />
      ) : element.type === 'boundary' ? (
        <rect width={element.width} height={element.height} rx={18} fill="rgba(244,239,230,0.04)" stroke={stroke} strokeDasharray="7 5" strokeWidth={1.5} />
      ) : isCylinder(element.type) ? (
        <Cylinder width={element.width} height={element.height} fill={fill} stroke={stroke} />
      ) : (
        <rect width={element.width} height={element.height} rx={radius} fill={fill} stroke={stroke} strokeWidth={1.5} />
      )}
      {element.type !== 'text' && element.type !== 'boundary' && !isCylinder(element.type) ? (
        <Glyph type={element.type} />
      ) : null}
      <text
        x={element.type === 'text' ? 0 : 36}
        y={element.type === 'boundary' ? 22 : element.height / 2 + 4}
        fill={text}
        fontSize={element.type === 'text' ? 18 : 14}
        fontFamily="Outfit, Segoe UI, sans-serif"
      >
        {trim(element.label || paletteItem(element.type).label, element.type === 'text' ? 32 : 18)}
      </text>
    </g>
  )
}

function isCylinder(type: ViewElement['type']) {
  return type === 'sql' || type === 'nosql' || type === 'cache' || type === 'warehouse' || type === 'vector-db'
}

function Cylinder({ width, height, fill, stroke }: { width: number; height: number; fill: string; stroke: string }) {
  const ry = Math.min(14, height * 0.16)
  return (
    <g>
      <path
        d={`M 0 ${ry} V ${height - ry} A ${width / 2} ${ry} 0 0 0 ${width} ${height - ry} V ${ry}`}
        fill={fill}
        stroke={stroke}
      />
      <ellipse cx={width / 2} cy={ry} rx={width / 2} ry={ry} fill={fill} stroke={stroke} />
    </g>
  )
}

function Glyph({ type }: { type: ViewElement['type'] }) {
  const tint = categoryColor(paletteItem(type).category)
  return (
    <g transform="translate(10 0)" aria-hidden="true">
      <rect x="0" y="18" width="18" height="18" rx="5" fill={tint} stroke="rgba(28,25,21,0.25)" />
      <path d="M4 27h10M4 23h7" stroke="#1c1915" strokeWidth="1.4" />
    </g>
  )
}

function trim(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
