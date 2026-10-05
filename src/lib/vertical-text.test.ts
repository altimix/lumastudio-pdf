import { describe, expect, it, vi } from 'vitest'
import { drawVerticalText, verticalColumns, verticalTextSize } from './vertical-text'
import { fitTextGeometry } from './fonts'
import type { Annotation } from './types'

const base: Annotation = { id:'a', pageId:'p', type:'text', x:200, y:100, width:32, height:26, fontSize:20, text:'天地\n玄黄', writingMode:'vertical-rl' }
describe('vertical writing', () => {
  it('keeps combining marks, emoji sequences, blank columns and CRLF intact', () => {
    expect(verticalColumns('か\u3099\r\n\n👨‍👩‍👧‍👦\t𠮷')).toEqual([['が'], [], ['👨‍👩‍👧‍👦', '　', '𠮷']])
    expect(verticalTextSize('天地\n玄黄', 20)).toEqual({ width:60, height:46 })
  })
  it('expands toward the left while preserving the first column and clamps to the page', () => {
    expect(fitTextGeometry(base, 700, 500)).toMatchObject({ x:172, y:100, width:60, height:46 })
    const fitted = fitTextGeometry({ ...base, x:0, y:690, text:'天地\n'.repeat(100) }, 700, 500)
    expect(fitted.x).toBe(0)
    expect(fitted.width).toBe(500)
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(700)
  })
  it('draws top to bottom then left, rotates brackets and leaves Latin upright', () => {
    const context = { textAlign:'', textBaseline:'', save:vi.fn(), restore:vi.fn(), translate:vi.fn(), rotate:vi.fn(), fillText:vi.fn(), beginPath:vi.fn(), moveTo:vi.fn(), lineTo:vi.fn(), stroke:vi.fn() }
    drawVerticalText(context as unknown as CanvasRenderingContext2D, { ...base, width:60, text:'天「ー\nA。ゃ', underline:true })
    expect(context.fillText.mock.calls.map(args => args[0])).toEqual(['天','「','ー','A','。','ゃ'])
    expect(context.translate.mock.calls.slice(0,4)).toEqual([[44,12],[44,32],[44,52],[16,12]])
    expect(context.translate.mock.calls[4]).toEqual([26,22])
    expect(context.rotate).toHaveBeenCalledTimes(2)
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2)
    expect(context.moveTo.mock.calls).toEqual([[56,2],[28,2]])
    expect(context.lineTo.mock.calls).toEqual([[56,62],[28,62]])
  })
})
