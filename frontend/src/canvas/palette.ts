import type { ComponentType } from './model'

export type PaletteCategory = 'General' | 'Data' | 'Messaging' | 'Network' | 'Compute' | 'AI'

export interface PaletteItem {
  type: ComponentType
  label: string
  category: PaletteCategory
  width: number
  height: number
  minWidth: number
  minHeight: number
  blurb: string
}

export const PALETTE: PaletteItem[] = [
  { type: 'service', label: 'Service', category: 'General', width: 168, height: 76, minWidth: 96, minHeight: 56, blurb: 'Process or service' },
  { type: 'rounded', label: 'Process', category: 'General', width: 168, height: 76, minWidth: 96, minHeight: 56, blurb: 'Rounded process' },
  { type: 'text', label: 'Text', category: 'General', width: 160, height: 44, minWidth: 48, minHeight: 28, blurb: 'Standalone label' },
  { type: 'sticky', label: 'Sticky note', category: 'General', width: 180, height: 160, minWidth: 100, minHeight: 80, blurb: 'Note' },
  { type: 'boundary', label: 'Boundary', category: 'General', width: 320, height: 220, minWidth: 140, minHeight: 100, blurb: 'Group or trust boundary' },
  { type: 'icon', label: 'Icon', category: 'General', width: 96, height: 96, minWidth: 64, minHeight: 64, blurb: 'Generic marker' },
  { type: 'rect', label: 'Rectangle', category: 'General', width: 160, height: 96, minWidth: 48, minHeight: 36, blurb: 'Untyped rectangle' },
  { type: 'ellipse', label: 'Ellipse', category: 'General', width: 160, height: 96, minWidth: 48, minHeight: 36, blurb: 'Untyped ellipse' },
  { type: 'sql', label: 'SQL database', category: 'Data', width: 132, height: 112, minWidth: 88, minHeight: 80, blurb: 'Relational database' },
  { type: 'nosql', label: 'NoSQL', category: 'Data', width: 132, height: 112, minWidth: 88, minHeight: 80, blurb: 'Document or key-value store' },
  { type: 'cache', label: 'Cache', category: 'Data', width: 124, height: 104, minWidth: 80, minHeight: 72, blurb: 'In-memory cache' },
  { type: 'object-storage', label: 'Object storage', category: 'Data', width: 156, height: 96, minWidth: 100, minHeight: 64, blurb: 'File or object storage' },
  { type: 'warehouse', label: 'Warehouse', category: 'Data', width: 160, height: 108, minWidth: 100, minHeight: 76, blurb: 'Data warehouse' },
  { type: 'queue', label: 'Queue', category: 'Messaging', width: 150, height: 76, minWidth: 96, minHeight: 52, blurb: 'Message queue' },
  { type: 'stream', label: 'Event stream', category: 'Messaging', width: 168, height: 76, minWidth: 110, minHeight: 52, blurb: 'Log or topic' },
  { type: 'pubsub', label: 'Pub/sub', category: 'Messaging', width: 150, height: 84, minWidth: 96, minHeight: 56, blurb: 'Broker' },
  { type: 'client', label: 'Client', category: 'Network', width: 124, height: 88, minWidth: 80, minHeight: 64, blurb: 'User or client app' },
  { type: 'browser', label: 'Browser', category: 'Network', width: 136, height: 88, minWidth: 88, minHeight: 64, blurb: 'Browser or mobile client' },
  { type: 'gateway', label: 'API gateway', category: 'Network', width: 176, height: 76, minWidth: 120, minHeight: 56, blurb: 'Edge API' },
  { type: 'load-balancer', label: 'Load balancer', category: 'Network', width: 176, height: 76, minWidth: 120, minHeight: 56, blurb: 'Traffic distributor' },
  { type: 'cdn', label: 'CDN', category: 'Network', width: 132, height: 88, minWidth: 88, minHeight: 64, blurb: 'Content delivery' },
  { type: 'external-api', label: 'External API', category: 'Network', width: 164, height: 76, minWidth: 110, minHeight: 56, blurb: 'Third-party API' },
  { type: 'server', label: 'Server', category: 'Compute', width: 140, height: 88, minWidth: 96, minHeight: 64, blurb: 'Server' },
  { type: 'worker', label: 'Worker', category: 'Compute', width: 140, height: 88, minWidth: 96, minHeight: 64, blurb: 'Background worker' },
  { type: 'function', label: 'Function', category: 'Compute', width: 150, height: 72, minWidth: 96, minHeight: 52, blurb: 'Serverless function' },
  { type: 'container', label: 'Cluster', category: 'Compute', width: 164, height: 96, minWidth: 110, minHeight: 68, blurb: 'Container cluster' },
  { type: 'llm', label: 'LLM', category: 'AI', width: 140, height: 88, minWidth: 96, minHeight: 64, blurb: 'Language model' },
  { type: 'embedding', label: 'Embeddings', category: 'AI', width: 156, height: 88, minWidth: 110, minHeight: 64, blurb: 'Embedding model' },
  { type: 'vector-db', label: 'Vector DB', category: 'AI', width: 140, height: 112, minWidth: 96, minHeight: 80, blurb: 'Vector database' },
  { type: 'agent', label: 'Agent', category: 'AI', width: 140, height: 88, minWidth: 96, minHeight: 64, blurb: 'Agent or tool' },
]

const byType = new Map(PALETTE.map((item) => [item.type, item]))

export function paletteItem(type: ComponentType): PaletteItem {
  return byType.get(type) ?? PALETTE[0]!
}

export function categoryColor(category: PaletteCategory): string {
  switch (category) {
    case 'General':
      return '#f4efe6'
    case 'Data':
      return '#d7efe4'
    case 'Messaging':
      return '#f6e6cb'
    case 'Network':
      return '#d9e6f8'
    case 'Compute':
      return '#e7def6'
    case 'AI':
      return '#f8dbe6'
  }
}

export const STICKY_COLORS = ['#f6e7a1', '#f6d4d0', '#d7f0d4', '#d5e4fb', '#e7dff8']
export const PEN_COLORS = ['#f4efe6', '#8fd0c6', '#f0b429', '#f08a76', '#8eb6f5', '#1c1915']

export function shapeFill(type: ComponentType, fill: string | null): string {
  if (type === 'text') return 'transparent'
  if (type === 'boundary') return 'transparent'
  if (fill) return fill
  if (type === 'sticky') return STICKY_COLORS[0]!
  return categoryColor(paletteItem(type).category)
}
