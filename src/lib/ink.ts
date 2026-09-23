import type { Annotation, PageInfo } from './types'

export type InkPoint = { x: number; y: number }
export type InkKind = 'pen' | 'marker'
export const MAX_INK_POINTS = 2048

/** Keep the whole brush mark on the page and make the path scalable. */
export function createInkAnnotation(
  id: string,
  page: Pick<PageInfo, 'id' | 'width' | 'height'>,
  kind: InkKind,
  points: InkPoint[],
  color: string,
  strokeWidth: number,
): Annotation {
  if (!points.length || points.length > MAX_INK_POINTS || !Number.isFinite(strokeWidth) || strokeWidth < 1 || strokeWidth > 72) {
    throw new Error('線の点数または太さが不正です。')
  }
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('線の座標が不正です。')
  const clamped = points.map(point => ({
    x: Math.min(page.width, Math.max(0, point.x)),
    y: Math.min(page.height, Math.max(0, point.y)),
  }))
  const margin = strokeWidth / 2 + 2
  const x = Math.max(0, Math.min(...clamped.map(point => point.x)) - margin)
  const y = Math.max(0, Math.min(...clamped.map(point => point.y)) - margin)
  const right = Math.min(page.width, Math.max(...clamped.map(point => point.x)) + margin)
  const bottom = Math.min(page.height, Math.max(...clamped.map(point => point.y)) + margin)
  const width = Math.max(Number.MIN_VALUE, right - x)
  const height = Math.max(Number.MIN_VALUE, bottom - y)
  return {
    id, pageId: page.id, type: kind, x, y, width, height,
    color, strokeWidth, aspectLocked: false,
    points: clamped.map(point => ({ x: (point.x - x) / width, y: (point.y - y) / height })),
  }
}

function segmentDistance(point: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const factor = dx || dy ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(point.x - a.x - factor * dx, point.y - a.y - factor * dy)
}

/** Erase only annotations made by the pen or marker; the source PDF is untouched. */
export function inkHitTest(annotation: Annotation, point: InkPoint, eraserRadius = 8): boolean {
  if ((annotation.type !== 'pen' && annotation.type !== 'marker') || !annotation.points?.length) return false
  const radius = eraserRadius + (annotation.strokeWidth ?? 2) / 2
  if (point.x < annotation.x - radius || point.x > annotation.x + annotation.width + radius ||
    point.y < annotation.y - radius || point.y > annotation.y + annotation.height + radius) return false
  const path = annotation.points.map(p => ({ x: annotation.x + p.x * annotation.width, y: annotation.y + p.y * annotation.height }))
  if (path.length === 1) return Math.hypot(point.x - path[0].x, point.y - path[0].y) <= radius
  return path.slice(1).some((next, index) => segmentDistance(point, path[index], next) <= radius)
}
