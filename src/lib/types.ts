export type AnnotationType = 'text' | 'stamp' | 'image' | 'check' | 'shape' | 'pen' | 'marker'
export type FontFamilyId = 'legacy' | 'noto-sans-jp' | 'noto-serif-jp' | 'm-plus-1' | 'biz-udgothic'
export type ShapeKind = 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'double-line'
export type MarkerCap = 'round' | 'square'
export type LineDirection = 'horizontal' | 'vertical' | 'down' | 'up'

/** Geometry uses points from the top-left of the original displayed PDF page. */
export interface Annotation {
  id: string
  pageId: string
  type: AnnotationType
  x: number
  y: number
  width: number
  height: number
  /** Missing in older work files: shapes were free; other materials were proportional on drag. */
  aspectLocked?: boolean
  text?: string
  fontSize?: number
  fontFamily?: FontFamilyId
  fontWeight?: 400 | 700
  fontStyle?: 'normal' | 'italic'
  underline?: boolean
  color?: string
  dataUrl?: string
  stampShape?: 'circle' | 'square'
  /** Imported seal image, distinct from a general image on the page. */
  stampSource?: true
  shapeKind?: ShapeKind
  /** Omitted in older work files, whose lines were horizontal. */
  lineDirection?: LineDirection
  strokeColor?: string
  fillColor?: string
  strokeWidth?: number
  /** Omitted in older work files, whose highlighter tips were round. */
  markerCap?: MarkerCap
  /** Pen and marker path coordinates, normalized within this annotation's box. */
  points?: { x: number; y: number }[]
}

export interface PageInfo {
  id: string
  sourceName?: string
  sourcePage?: number
  /** Zero-based index in the source PDF. */
  sourceIndex: number
  width: number
  height: number
  /** Extra clockwise rotation applied to the entire page, including additions. */
  rotation: number
  originalRotation?: number
  /** PDF.js scale=1 transformation, including crop, rotation, and UserUnit. */
  viewportTransform?: number[]
}

export type Tool = 'select' | 'hand' | 'eraser' | AnnotationType
