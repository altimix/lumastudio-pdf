import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, ensureTextFont, fontCssFamily,
  isTextFontReady, measureTextHeight, textFontCss, wrapTextLines,
} from './fonts'

afterEach(() => vi.unstubAllGlobals())

describe('bundled text fonts', () => {
  it('keeps legacy projects unchanged while providing the requested new defaults', () => {
    expect(DEFAULT_FONT_FAMILY).toBe('noto-sans-jp')
    expect(DEFAULT_FONT_SIZE).toBe(11)
    expect(fontCssFamily()).toBe(fontCssFamily('legacy'))
    expect(textFontCss({})).toBe('normal 400 16px "Yu Gothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif')
    expect(textFontCss({ fontFamily: 'noto-serif-jp', fontSize: 11, fontWeight: 700, fontStyle: 'italic' })).toBe('italic 700 11px "Noto Serif JP Variable", serif')
  })

  it('shares a pending request for the exact text and loads new glyphs on demand', async () => {
    let completeSubset!: () => void
    const first = { family: '"Noto Sans JP Variable"', status: 'unloaded' }
    const uncommon = { family: 'Noto Sans JP Variable', status: 'unloaded' }
    const other = { family: 'Noto Serif JP Variable', status: 'unloaded' }
    const ready = new Set<string>()
    const fonts = {
      forEach: (visit: (face: typeof first) => void) => [first, uncommon, other].forEach(visit),
      check: vi.fn((_css: string, text: string) => ready.has(text)),
      load: vi.fn(async (_css: string, text: string) => {
        if (text.includes('髙')) await new Promise<void>((resolve) => { completeSubset = resolve })
        first.status = 'loaded'
        ready.add(text)
        return [first]
      }), ready: Promise.resolve(),
    }
    vi.stubGlobal('document', { fonts })
    const text = { fontFamily: DEFAULT_FONT_FAMILY, fontSize: 11, fontWeight: 700 as const, text: '髙橋 請求書 ABC' }
    const firstLoad = ensureTextFont(text)
    const concurrent = ensureTextFont(text)
    expect(isTextFontReady(text)).toBe(false)
    expect(fonts.load).toHaveBeenCalledTimes(1)
    completeSubset()
    await Promise.all([firstLoad, concurrent])
    expect(isTextFontReady(text)).toBe(true)
    expect(fonts.load).toHaveBeenCalledWith(textFontCss(text), text.text)
    await ensureTextFont({ ...text, text: '𠮷田' })
    expect(fonts.load).toHaveBeenCalledTimes(2)
    expect(other.status).toBe('unloaded')
  })

  it('retries a failed local font load and never silently substitutes another face', async () => {
    const face = { family: 'M PLUS 1 Variable', status: 'unloaded' }
    const load = vi.fn().mockRejectedValueOnce(new Error('missing asset')).mockImplementationOnce(async () => { face.status = 'loaded'; return [face] })
    const fonts = { forEach: (visit: (face: unknown) => void) => visit(face), load, check: () => face.status === 'loaded' }
    vi.stubGlobal('document', { fonts })
    const text = { fontFamily: 'm-plus-1' as const, text: '住所' }
    await expect(ensureTextFont(text)).rejects.toThrow('同梱フォントを読み込めません')
    expect(isTextFontReady(text)).toBe(false)
    await ensureTextFont(text)
    expect(load).toHaveBeenCalledTimes(2)
    expect(isTextFontReady(text)).toBe(true)
  })

  it('leaves unrelated CJK subsets unloaded after requesting Japanese text', async () => {
    const faces = Array.from({ length: 40 }, () => ({ family: 'Noto Sans JP Variable', status: 'unloaded' }))
    const loadedText = new Set<string>()
    const fonts = {
      forEach: (visit: (face: unknown) => void) => faces.forEach(visit),
      check: (_css: string, text: string) => loadedText.has(text),
      load: vi.fn(async (_css: string, text: string) => {
        faces[0].status = 'loaded'
        loadedText.add(text)
        return [faces[0]]
      }),
    }
    vi.stubGlobal('document', { fonts })
    await ensureTextFont({ fontFamily: 'noto-sans-jp', text: '住所' })
    expect(fonts.load).toHaveBeenCalledTimes(1)
    expect(fonts.load).toHaveBeenCalledWith(textFontCss({ fontFamily: 'noto-sans-jp' }), '住所')
    expect(faces.filter(face => face.status === 'loaded')).toHaveLength(1)
    expect(isTextFontReady({ fontFamily: 'noto-sans-jp', text: '住所' })).toBe(true)
    expect(isTextFontReady({ fontFamily: 'noto-sans-jp', text: '請求書' })).toBe(false)
  })

  it('fails clearly if the stylesheet or loading API is unavailable', async () => {
    vi.stubGlobal('document', { fonts: { forEach() {} } })
    await expect(ensureTextFont({ fontFamily: 'noto-sans-jp' })).rejects.toThrow('同梱フォントが見つかりません')
    vi.stubGlobal('document', {})
    await expect(ensureTextFont({ fontFamily: 'noto-sans-jp' })).rejects.toThrow('同梱フォントの読み込み機能を利用できません')
    await ensureTextFont({})
    expect(isTextFontReady({})).toBe(true)
  })

  it('measures wrapping with the selected weight/style and preserves explicit blank lines', () => {
    const context = { font: '', measureText: (text: string) => ({ width: Array.from(text).length * (context.font.includes('700') ? 11 : 10) }) }
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
    const plain = { text: 'あいうえ\n\nABC', width: 44, fontSize: 11, fontFamily: DEFAULT_FONT_FAMILY }
    expect(measureTextHeight(plain)).toBeCloseTo(3 * 11 * 1.4 + 6)
    expect(measureTextHeight({ ...plain, fontWeight: 700, fontStyle: 'italic' })).toBeCloseTo(4 * 11 * 1.4 + 6)
    expect(context.font).toContain('italic 700 11px "Noto Sans JP Variable"')
    expect(wrapTextLines(context as unknown as CanvasRenderingContext2D, '𠮷田', 11)).toEqual(['𠮷', '田'])
  })

  it('ships the original license and copyright notices for every bundled family', () => {
    for (const [pkg, name] of [
      ['@fontsource-variable/noto-sans-jp', 'NotoSansJP'],
      ['@fontsource-variable/noto-serif-jp', 'NotoSerifJP'],
      ['@fontsource-variable/m-plus-1', 'MPLUS1'],
      ['@fontsource/biz-udgothic', 'BIZUDGothic'],
    ]) {
      const packaged = readFileSync(`public/font-licenses/${name}-OFL.txt`, 'utf8')
      expect(packaged).toBe(readFileSync(`node_modules/${pkg}/LICENSE`, 'utf8'))
      expect(packaged).toContain('SIL OPEN FONT LICENSE')
    }
  })
})
