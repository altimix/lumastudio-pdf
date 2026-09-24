import { describe, expect, it } from 'vitest'
import { createInkAnnotation, inkHitTest, inkStrokeIntersectsSegment, MAX_INK_POINTS } from './ink'

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
    expect(marker.markerCap).toBe('square')
    expect(inkHitTest(marker, { x: 300, y: 250 })).toBe(true)
    expect(inkHitTest({ ...marker, type: 'text' }, { x: 300, y: 250 })).toBe(false)
    expect(inkHitTest(marker, { x: 350, y: 250 })).toBe(false)
  })

  it('keeps thin and edge strokes stable when the editor applies its 8pt minimum', () => {
    for (const points of [
      [{ x: 50, y: 100 }, { x: 250, y: 100 }],
      [{ x: 100, y: 50 }, { x: 100, y: 250 }],
      [{ x: 0, y: 0 }],
    ]) {
      const stroke = createInkAnnotation('thin', page, 'pen', points, '#000000', 2)
      expect(stroke.width).toBeGreaterThanOrEqual(8)
      expect(stroke.height).toBeGreaterThanOrEqual(8)
      expect(stroke.x + stroke.width).toBeLessThanOrEqual(page.width)
      expect(stroke.y + stroke.height).toBeLessThanOrEqual(page.height)
      points.forEach((point, index) => {
        expect(stroke.x + stroke.points![index].x * stroke.width).toBeCloseTo(point.x)
        expect(stroke.y + stroke.points![index].y * stroke.height).toBeCloseTo(point.y)
      })
    }
  })

  it('erases a stroke crossed between two distant pointer events', () => {
    const line = createInkAnnotation('line', page, 'pen', [{ x: 50, y: 100 }, { x: 250, y: 100 }], '#000000', 2)
    expect(inkHitTest(line, { x: 150, y: 50 })).toBe(false)
    expect(inkHitTest(line, { x: 150, y: 150 })).toBe(false)
    expect(inkStrokeIntersectsSegment(line, { x: 150, y: 50 }, { x: 150, y: 150 })).toBe(true)
    expect(inkStrokeIntersectsSegment(line, { x: 300, y: 50 }, { x: 300, y: 150 })).toBe(false)
  })

  it('limits a single stroke before it can bloat a saved project', () => {
    const points = Array.from({ length: MAX_INK_POINTS + 1 }, (_, index) => ({ x: index / 10, y: 20 }))
    expect(() => createInkAnnotation('too-long', page, 'pen', points, '#000000', 2)).toThrow(/点数/)
    expect(() => createInkAnnotation('invalid', page, 'pen', [{ x: NaN, y: 5 }], '#000000', 2)).toThrow(/座標/)
  })
})
