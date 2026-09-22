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

  it('waits for every Japanese subset in the selected family, then checks the exact styled text', async () => {
    let completeSubset!: () => void
    const first = { family: '"Noto Sans JP Variable"', load: vi.fn(async () => undefined) }
    const uncommon = { family: 'Noto Sans JP Variable', load: vi.fn(() => new Promise<void>((resolve) => { completeSubset = resolve })) }
    const other = { family: 'Noto Serif JP Variable', load: vi.fn(async () => undefined) }
    const fonts = {
      forEach: (visit: (face: { family: string; load: () => Promise<unknown> }) => void) => [first, uncommon, other].forEach(visit),
      load: vi.fn(async () => []), ready: Promise.resolve(),
    }
    vi.stubGlobal('document', { fonts })
    const text = { fontFamily: DEFAULT_FONT_FAMILY, fontSize: 11, fontWeight: 700 as const, text: '髙橋 請求書 ABC' }
    const firstLoad = ensureTextFont(text)
    const concurrent = ensureTextFont({ ...text, text: '住所' })
    expect(isTextFontReady(text)).toBe(false)
    expect(first.load).toHaveBeenCalledTimes(1)
    expect(uncommon.load).toHaveBeenCalledTimes(1)
    expect(other.load).not.toHaveBeenCalled()
    completeSubset()
    await Promise.all([firstLoad, concurrent])
    expect(isTextFontReady(text)).toBe(true)
    expect(fonts.load).toHaveBeenCalledWith(textFontCss(text), text.text)
    await ensureTextFont({ ...text, text: '𠮷田' })
    expect(uncommon.load).toHaveBeenCalledTimes(1)
  })

  it('retries a failed local font load and never silently substitutes another face', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('missing asset')).mockResolvedValueOnce(undefined)
    const fonts = { forEach: (visit: (face: unknown) => void) => visit({ family: 'M PLUS 1 Variable', load }), load: vi.fn(async () => []) }
    vi.stubGlobal('document', { fonts })
    const text = { fontFamily: 'm-plus-1' as const, text: '住所' }
    await expect(ensureTextFont(text)).rejects.toThrow('同梱フォントを読み込めません')
    expect(isTextFontReady(text)).toBe(false)
    await ensureTextFont(text)
    expect(load).toHaveBeenCalledTimes(2)
    expect(isTextFontReady(text)).toBe(true)
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
