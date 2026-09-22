import '@fontsource-variable/noto-sans-jp'
import '@fontsource-variable/noto-serif-jp'
import '@fontsource-variable/m-plus-1'
import '@fontsource/biz-udgothic/400.css'
import '@fontsource/biz-udgothic/700.css'
import type { Annotation, FontFamilyId } from './types'

export const DEFAULT_FONT_FAMILY: FontFamilyId = 'noto-sans-jp'
export const DEFAULT_FONT_SIZE = 11

export const FONT_OPTIONS: { id: FontFamilyId; label: string }[] = [
  { id: 'noto-sans-jp', label: 'Noto Sans JP（ゴシック）' },
  { id: 'noto-serif-jp', label: 'Noto Serif JP（明朝）' },
  { id: 'm-plus-1', label: 'M PLUS 1（やわらかなゴシック）' },
  { id: 'biz-udgothic', label: 'BIZ UDGothic（読みやすいゴシック）' },
  { id: 'legacy', label: '従来のシステムフォント（互換）' },
]

const FAMILY_NAMES: Record<Exclude<FontFamilyId, 'legacy'>, string> = {
  'noto-sans-jp': 'Noto Sans JP Variable',
  'noto-serif-jp': 'Noto Serif JP Variable',
  'm-plus-1': 'M PLUS 1 Variable',
  'biz-udgothic': 'BIZ UDGothic',
}
const LEGACY_FAMILY = '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif'
type TextStyle = Pick<Annotation, 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle'>
type TextLayout = TextStyle & Pick<Annotation, 'text' | 'width'>

/** Missing family belongs to older editable projects and retains its old face. */
export function fontCssFamily(id?: FontFamilyId): string {
  if (!id || id === 'legacy') return LEGACY_FAMILY
  return `"${FAMILY_NAMES[id]}", ${id === 'noto-serif-jp' ? 'serif' : 'sans-serif'}`
}

export function textFontCss(annotation: TextStyle, sizeOverride?: number): string {
  return `${annotation.fontStyle || 'normal'} ${annotation.fontWeight || 400} ${sizeOverride ?? annotation.fontSize ?? 16}px ${fontCssFamily(annotation.fontFamily)}`
}

const familyLoads = new WeakMap<FontFaceSet, Map<string, Promise<void>>>()
const loadedFamilies = new WeakMap<FontFaceSet, Set<string>>()

export function isTextFontReady(annotation: TextStyle): boolean {
  if (!annotation.fontFamily || annotation.fontFamily === 'legacy') return true
  if (typeof document === 'undefined' || !document.fonts) return false
  const family = FAMILY_NAMES[annotation.fontFamily]
  if (loadedFamilies.get(document.fonts)?.has(family)) return true
  // Another module instance (e.g. a development hot update) can have loaded
  // the same FontFaceSet already. Read the actual faces instead of its cache.
  let found = false, ready = true
  document.fonts.forEach((face) => {
    if (face.family.replace(/^["']|["']$/g, '') !== family) return
    found = true
    if (face.status !== 'loaded') ready = false
  })
  return found && ready
}

/**
 * All files come from the application's local bundle. Load every Unicode subset
 * of the chosen face, so characters typed later by an IME can be measured
 * synchronously without briefly falling back to a different system font.
 */
export async function ensureTextFont(annotation: TextStyle & Pick<Annotation, 'text'>): Promise<void> {
  const id = annotation.fontFamily
  if (typeof document === 'undefined' || !document.fonts) {
    if (id && id !== 'legacy') throw new Error('同梱フォントの読み込み機能を利用できません。デスクトップアプリで開いてください。')
    return
  }
  const fonts = document.fonts
  if (!id || id === 'legacy') {
    await fonts.ready
    return
  }
  const family = FAMILY_NAMES[id]
  let loads = familyLoads.get(fonts)
  if (!loads) {
    loads = new Map()
    familyLoads.set(fonts, loads)
  }
  let pending = loads.get(family)
  if (!pending) {
    pending = (async () => {
      const faces: FontFace[] = []
      fonts.forEach((face) => {
        if (face.family.replace(/^["']|["']$/g, '') === family) faces.push(face)
      })
      if (!faces.length) throw new Error('同梱フォントが見つかりません。アプリを再起動してください。')
      await Promise.all(faces.map((face) => face.load()))
      const ready = loadedFamilies.get(fonts) || new Set<string>()
      ready.add(family)
      loadedFamilies.set(fonts, ready)
    })()
    loads.set(family, pending)
    pending.catch(() => { if (loads.get(family) === pending) loads.delete(family) })
  }
  try {
    await pending
    // Verify the actual style/text too. Italic is synthesized by the browser for
    // these Japanese families, identically in the editor and the exported raster.
    await fonts.load(textFontCss(annotation), annotation.text || '日本語 ABC 123')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('同梱フォント')) throw error
    throw new Error('同梱フォントを読み込めませんでした。アプリを再起動してから、もう一度お試しください。')
  }
}

export function wrapTextLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = []
    let line = ''
    for (const character of Array.from(paragraph)) {
      if (line && context.measureText(line + character).width > width) {
        lines.push(line)
        line = character
      } else line += character
    }
    lines.push(line)
    return lines
  })
}

/** Canvas top baselines differ between CJK families; place the line below ink. */
export function underlineOffset(context: CanvasRenderingContext2D, text: string, fontSize: number): number {
  const metrics = context.measureText(text)
  const bottom = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : fontSize * 1.12
  return Math.max(fontSize, bottom) + Math.max(0.8, fontSize * 0.06) + Math.max(0.6, fontSize / 16) / 2
}

/** Call ensureTextFont before the first measurement for a selected family. */
export function measureTextHeight(annotation: TextLayout & Pick<Annotation, 'underline'>): number {
  const fontSize = annotation.fontSize ?? 16
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return Math.max(fontSize * 1.4 + 6, (annotation.text || '').split('\n').length * fontSize * 1.4 + 6)
  context.font = textFontCss(annotation)
  context.textBaseline = 'top'
  const lines = wrapTextLines(context, annotation.text || '', Math.max(1, annotation.width - 4))
  const height = Math.max(fontSize * 1.4 + 6, lines.length * fontSize * 1.4 + 6)
  if (!annotation.underline || !lines.at(-1)) return height
  return Math.max(height, 4 + (lines.length - 1) * fontSize * 1.4 + underlineOffset(context, lines.at(-1)!, fontSize) + Math.max(0.6, fontSize / 16) / 2)
}
