import { addConnectors, addElements, emptyDoc, type DocState } from './model'

export type TemplateId = 'blank' | 'three-tier' | 'event-pipeline'

export const TEMPLATES: Array<{ id: TemplateId; name: string; detail: string }> = [
  { id: 'blank', name: 'Blank canvas', detail: 'Start from an empty board.' },
  { id: 'three-tier', name: 'Three-tier web', detail: 'Browser, gateway, service, database, and cache.' },
  { id: 'event-pipeline', name: 'Event pipeline', detail: 'API, queue, workers, and a warehouse.' },
]

export function buildTemplate(id: TemplateId): DocState {
  if (id === 'blank') return emptyDoc()
  const actor = 'template'
  if (id === 'three-tier') {
    const withNodes = addElements(
      emptyDoc(),
      [
        node('browser', 'browser', 'Browser', 80, 180),
        node('gateway', 'gateway', 'API gateway', 320, 180),
        node('service', 'service', 'App service', 580, 180),
        node('sql', 'sql', 'SQL', 860, 80),
        node('cache', 'cache', 'Cache', 860, 280),
      ],
      actor,
      1,
    )
    return addConnectors(
      withNodes.state,
      [
        link('c1', 'browser', 'gateway', 'HTTPS'),
        link('c2', 'gateway', 'service', 'HTTP'),
        link('c3', 'service', 'sql', 'SQL'),
        link('c4', 'service', 'cache', 'cache'),
      ],
      actor,
      2,
    ).state
  }
  const withNodes = addElements(
    emptyDoc(),
    [
      node('client', 'client', 'Client', 60, 200),
      node('gateway', 'gateway', 'API gateway', 280, 200),
      node('service', 'service', 'Ingest', 520, 200),
      node('queue', 'queue', 'Orders queue', 760, 200),
      node('worker', 'worker', 'Workers', 1000, 80),
      node('warehouse', 'warehouse', 'Warehouse', 1000, 320),
    ],
    actor,
    1,
  )
  return addConnectors(
    withNodes.state,
    [
      link('c1', 'client', 'gateway', 'HTTPS'),
      link('c2', 'gateway', 'service', 'HTTP'),
      link('c3', 'service', 'queue', 'events'),
      link('c4', 'queue', 'worker', 'consume'),
      link('c5', 'worker', 'warehouse', 'batch'),
    ],
    actor,
    2,
  ).state
}

function node(id: string, type: Parameters<typeof addElements>[1][number]['type'], label: string, x: number, y: number) {
  const width = type === 'sql' || type === 'cache' || type === 'warehouse' ? 132 : 168
  const height = type === 'sql' || type === 'cache' || type === 'warehouse' ? 112 : 76
  return { id, type, label, x, y, width, height }
}

function link(id: string, fromId: string, toId: string, label: string) {
  return { id, fromId, toId, label, route: 'elbow' as const, arrowEnd: true }
}
