import { describe, expect, it } from 'vitest'
import { shapeLineSegments, shapePlacementFromDrag, shapeStrokeWidth } from './shape-placement'

const page = { width: 500, height: 700 }

describe('shape placement by dragging on the page', () => {
  it('uses the dragged box in either direction and keeps it inside the page', () => {
    expect(shapePlacementFromDrag({ x: 220, y: 260 }, { x: 80, y: 120 }, page, 'rectangle'))
      .toEqual({ x: 80, y: 120, width: 140, height: 140 })
    expect(shapePlacementFromDrag({ x: 498, y: 699 }, { x: 700, y: 800 }, page, 'ellipse'))
      .toEqual({ x: 492, y: 692, width: 8, height: 8 })
  })

  it('preserves the line direction when the pointer reverses or crosses an axis', () => {
    expect(shapePlacementFromDrag({ x: 80, y: 120 }, { x: 240, y: 260 }, page, 'line').lineDirection).toBe('down')
    expect(shapePlacementFromDrag({ x: 240, y: 120 }, { x: 80, y: 260 }, page, 'double-line').lineDirection).toBe('up')
    expect(shapePlacementFromDrag({ x: 80, y: 120 }, { x: 80, y: 260 }, page, 'line').lineDirection).toBe('vertical')
    expect(shapePlacementFromDrag({ x: 80, y: 120 }, { x: 240, y: 120 }, page, 'line').lineDirection).toBe('horizontal')
    expect(shapePlacementFromDrag({ x: 80, y: 120 }, { x: 83, y: 121 }, page, 'line').lineDirection).toBe('horizontal')
    expect(shapePlacementFromDrag({ x: 80, y: 120 }, { x: 81, y: 123 }, page, 'line').lineDirection).toBe('vertical')
  })

  it('draws diagonal and parallel lines while retaining the legacy horizontal geometry', () => {
    expect(shapeLineSegments('line', 80, 40, 1.5)).toEqual([{ x1: 0.75, y1: 20, x2: 79.25, y2: 20 }])
    expect(shapeLineSegments('line', 80, 40, 2, 'down')).toEqual([{ x1: 1, y1: 1, x2: 79, y2: 39 }])
    const doubled = shapeLineSegments('double-line', 80, 40, 2, 'up')
    expect(doubled).toHaveLength(2)
    expect(doubled[0].y1).toBeGreaterThan(doubled[0].y2)
    expect(doubled[0].x1).toBeGreaterThan(doubled[1].x1)
  })

  it('keeps a thick double line separated and within a narrow placement box', () => {
    const width = 8, height = 100
    const stroke = shapeStrokeWidth('double-line', width, height, 8)
    expect(stroke).toBeCloseTo(8 / 3)
    expect(shapeStrokeWidth('line', width, height, 8)).toBe(4)
    for (const direction of ['horizontal', 'vertical', 'down', 'up'] as const) {
      const segments = shapeLineSegments('double-line', width, height, stroke, direction)
      expect(segments).toHaveLength(2)
      for (const segment of segments) {
        for (const x of [segment.x1, segment.x2]) {
          expect(x).toBeGreaterThanOrEqual(stroke / 2 - 0.001)
          expect(x).toBeLessThanOrEqual(width - stroke / 2 + 0.001)
        }
        for (const y of [segment.y1, segment.y2]) {
          expect(y).toBeGreaterThanOrEqual(stroke / 2 - 0.001)
          expect(y).toBeLessThanOrEqual(height - stroke / 2 + 0.001)
        }
      }
    }
  })

  it('leaves nonzero interiors and line lengths when a tiny shape requests a thick outline', () => {
    for (const kind of ['rectangle', 'ellipse', 'triangle', 'line'] as const) {
      const stroke = shapeStrokeWidth(kind, 8, 8, 8)
      expect(stroke).toBe(4)
      expect(8 - stroke).toBeGreaterThan(0)
    }
    const [line] = shapeLineSegments('line', 8, 8, shapeStrokeWidth('line', 8, 8, 8))
    expect(line.x2 - line.x1).toBeGreaterThan(0)
  })
})
