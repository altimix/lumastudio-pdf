import { describe, expect, it } from 'vitest'
import { createInkAnnotation, inkHitTest, MAX_INK_POINTS } from './ink'

const page = { id: 'page', width: 500, height: 700 }

describe('editable pen and marker paths', () => {
  it('keeps a line on the page and lets the eraser find its visible path', () => {
    const line = createInkAnnotation('line', page, 'pen', [{ x: 2, y: 25 }, { x: 160, y: 25 }], '#000000', 3)
    expect(line.x).toBe(0)
    expect(line.points).toHaveLength(2)
    expect(line.points!.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true)
    expect(inkHitTest(line, { x: 90, y: 26 })).toBe(true)
    expect(inkHitTest(line, { x: 90, y: 70 })).toBe(false)
    const moved = { ...line, x: line.x + 100 }
    expect(inkHitTest(moved, { x: 90, y: 26 })).toBe(false)
    expect(inkHitTest(moved, { x: 190, y: 26 })).toBe(true)
  })

  it('detects a highlighter dot but never erases ordinary PDF materials', () => {
    const marker = createInkAnnotation('dot', page, 'marker', [{ x: 300, y: 250 }], '#ffe14a', 18)
    expect(inkHitTest(marker, { x: 300, y: 250 })).toBe(true)
    expect(inkHitTest({ ...marker, type: 'text' }, { x: 300, y: 250 })).toBe(false)
    expect(inkHitTest(marker, { x: 350, y: 250 })).toBe(false)
  })

  it('limits a single stroke before it can bloat a saved project', () => {
    const points = Array.from({ length: MAX_INK_POINTS + 1 }, (_, index) => ({ x: index / 10, y: 20 }))
    expect(() => createInkAnnotation('too-long', page, 'pen', points, '#000000', 2)).toThrow(/点数/)
    expect(() => createInkAnnotation('invalid', page, 'pen', [{ x: NaN, y: 5 }], '#000000', 2)).toThrow(/座標/)
  })
})
