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

const textLoads = new WeakMap<FontFaceSet, Map<string, Promise<void>>>()
const FALLBACK_SAMPLE = '日本語 ABC 123'
const requestedText = (annotation: Partial<Pick<Annotation, 'text'>>) => annotation.text || FALLBACK_SAMPLE

export function isTextFontReady(annotation: TextStyle & Partial<Pick<Annotation, 'text'>>): boolean {
  if (!annotation.fontFamily || annotation.fontFamily === 'legacy') return true
  if (typeof document === 'undefined' || !document.fonts) return false
  const family = FAMILY_NAMES[annotation.fontFamily]
  let found = false, loaded = false
  document.fonts.forEach((face) => {
    if (face.family.replace(/^["']|["']$/g, '') !== family) return
    found = true
    if (face.status === 'loaded') loaded = true
  })
  return found && loaded && document.fonts.check(textFontCss(annotation), requestedText(annotation))
}

/**
 * Fontsource divides Japanese fonts into many Unicode subsets. Ask the browser
 * for the subsets used by this text instead of decoding the entire family;
 * the same local faces are used again for PDF export.
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
  let found = false
  fonts.forEach((face) => {
    if (face.family.replace(/^["']|["']$/g, '') === family) found = true
  })
  if (!found) throw new Error('同梱フォントが見つかりません。アプリを再起動してください。')
  if (isTextFontReady(annotation)) return
  const faceCss = textFontCss(annotation)
  const text = requestedText(annotation)
  const key = `${faceCss}\u0000${text}`
  let loads = textLoads.get(fonts)
  if (!loads) {
    loads = new Map()
    textLoads.set(fonts, loads)
  }
  let pending = loads.get(key)
  if (!pending) {
    pending = (async () => {
      const faces = await fonts.load(faceCss, text)
      if (!faces.some((face) => face.family.replace(/^["']|["']$/g, '') === family) || !fonts.check(faceCss, text))
        throw new Error('同梱フォントを読み込めませんでした。アプリを再起動してから、もう一度お試しください。')
    })()
    loads.set(key, pending)
    void pending.then(
      () => { if (loads.get(key) === pending) loads.delete(key) },
      () => { if (loads.get(key) === pending) loads.delete(key) },
    )
  }
  try {
    await pending
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
