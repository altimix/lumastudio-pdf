export type AnnotationType = 'text' | 'stamp' | 'image' | 'check'

/** Geometry uses points from the top-left of the original displayed PDF page. */
export interface Annotation {
  id: string
  pageId: string
  type: AnnotationType
  x: number
  y: number
  width: number
  height: number
  text?: string
  fontSize?: number
  color?: string
  dataUrl?: string
  stampShape?: 'circle' | 'square'
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

export type Tool = 'select' | AnnotationType
