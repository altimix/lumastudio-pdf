import type { LineDirection, PageInfo, ShapeKind } from './types'

export type ShapePlacement = {
  x: number
  y: number
  width: number
  height: number
  lineDirection?: LineDirection
}
type Point = { x: number; y: number }
export type LineSegment = { x1: number; y1: number; x2: number; y2: number }

/** Use original page coordinates so placement also works after page rotation. */
export function shapePlacementFromDrag(
  start: Point,
  end: Point,
  page: Pick<PageInfo, 'width' | 'height'>,
  kind: ShapeKind,
): ShapePlacement {
  const first = {
    x: Math.max(0, Math.min(page.width, start.x)),
    y: Math.max(0, Math.min(page.height, start.y)),
  }
  const last = {
    x: Math.max(0, Math.min(page.width, end.x)),
    y: Math.max(0, Math.min(page.height, end.y)),
  }
  const minimumWidth = Math.min(8, page.width)
  const minimumHeight = Math.min(8, page.height)
  const dx = last.x - first.x
  const dy = last.y - first.y
  const lineShape = kind === 'line' || kind === 'double-line'
  const lineDirection: LineDirection = Math.abs(dx) < 4 ? 'vertical'
    : Math.abs(dy) < 4 ? 'horizontal'
      : dx * dy > 0 ? 'down' : 'up'
  const x = lineShape && lineDirection === 'vertical'
    ? Math.max(0, Math.min(page.width - minimumWidth, (first.x + last.x) / 2 - minimumWidth / 2))
    : Math.min(page.width - minimumWidth, Math.min(first.x, last.x))
  const y = lineShape && lineDirection === 'horizontal'
    ? Math.max(0, Math.min(page.height - minimumHeight, (first.y + last.y) / 2 - minimumHeight / 2))
    : Math.min(page.height - minimumHeight, Math.min(first.y, last.y))
  const width = Math.min(page.width - x, Math.max(minimumWidth, Math.abs(dx)))
  const height = Math.min(page.height - y, Math.max(minimumHeight, Math.abs(dy)))
  if (!lineShape) return { x, y, width, height }
  return { x, y, width, height, lineDirection }
}

/** Match the editor preview and the raster image used in the exported PDF. */
export function shapeLineSegments(
  kind: 'line' | 'double-line',
  width: number,
  height: number,
  strokeWidth: number,
  direction: LineDirection = 'horizontal',
): LineSegment[] {
  const inset = strokeWidth / 2
  if (direction === 'horizontal') {
    const offset = kind === 'double-line' ? Math.min(height / 4, Math.max(strokeWidth, height * 0.14)) : 0
    const segment = (y: number) => ({ x1: inset, y1: y, x2: width - inset, y2: y })
    return kind === 'double-line'
      ? [segment(height / 2 - offset), segment(height / 2 + offset)]
      : [segment(height / 2)]
  }
  const offset = kind === 'double-line'
    ? Math.min(Math.min(width, height) / 4, Math.max(strokeWidth, Math.min(width, height) * 0.14)) : 0
  const margin = Math.min(Math.min(width, height) / 2, inset + offset)
  const from = direction === 'vertical' ? { x: width / 2, y: margin }
    : direction === 'down' ? { x: margin, y: margin } : { x: margin, y: height - margin }
  const to = direction === 'vertical' ? { x: width / 2, y: height - margin }
    : direction === 'down' ? { x: width - margin, y: height - margin } : { x: width - margin, y: margin }
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const normal = length ? { x: -(to.y - from.y) * offset / length, y: (to.x - from.x) * offset / length }
    : { x: offset, y: 0 }
  const segment = (sign: number) => ({
    x1: from.x + normal.x * sign,
    y1: from.y + normal.y * sign,
    x2: to.x + normal.x * sign,
    y2: to.y + normal.y * sign,
  })
  return kind === 'double-line' ? [segment(1), segment(-1)] : [segment(0)]
}
