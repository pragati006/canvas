import { describe, expect, it } from 'vitest'
import { anchorPoint, chooseAnchors, hitTest, snapPoint } from './geometry'
import { materialize, addElements, emptyDoc } from './model'

describe('canvas geometry', () => {
  it('picks facing anchors and hits the topmost element', () => {
    const doc = addElements(
      emptyDoc(),
      [
        { id: 'back', type: 'rect', x: 0, y: 0, width: 120, height: 80, label: 'Back', z: 1 },
        { id: 'front', type: 'rect', x: 20, y: 20, width: 80, height: 40, label: 'Front', z: 4 },
      ],
      'ada',
      3,
    ).state
    const view = materialize(doc)
    expect(hitTest(view, { x: 30, y: 30 }, { zoom: 1 }).kind === 'element' && hitTest(view, { x: 30, y: 30 }, { zoom: 1 })).toMatchObject({
      kind: 'element',
      id: 'front',
    })
    const [from, to] = chooseAnchors(view.elements[0]!, { x: 400, y: 0, width: 80, height: 40 })
    expect(from).toBe('right')
    expect(to).toBe('left')
    expect(anchorPoint({ x: 0, y: 0, width: 100, height: 40 }, 'bottom')).toEqual({ x: 50, y: 40 })
  })

  it('snaps to the grid and to a nearby edge', () => {
    const grid = snapPoint(
      { x: 17, y: 17 },
      { x: 0, y: 0, width: 40, height: 20 },
      [],
      { grid: 16, threshold: 6, enabled: true },
    )
    expect(grid.point).toEqual({ x: 16, y: 16 })
    const aligned = snapPoint(
      { x: 100, y: 40 },
      { x: 0, y: 0, width: 80, height: 40 },
      [{ x: 103, y: 200, width: 80, height: 40 }],
      { grid: 16, threshold: 6, enabled: true },
    )
    expect(aligned.point.x).toBe(103)
    expect(aligned.guides.some((guide) => guide.orientation === 'vertical')).toBe(true)
  })
})
