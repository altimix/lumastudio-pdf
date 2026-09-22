import { afterEach, describe, expect, it, vi } from 'vitest'
import { annotationToDataUrl } from './pdf'
import type { Annotation } from './types'

afterEach(() => vi.unstubAllGlobals())

function drawingContext() {
  const context = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', textBaseline: '',
    scale: vi.fn(), rect: vi.fn(), ellipse: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), fillText: vi.fn(),
    measureText: (text: string) => ({ width: Array.from(text).length * 10 }),
  }
  const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: () => 'data:image/png;base64,test' }
  const fonts = { ready: Promise.resolve(), forEach: (visit: (face: unknown) => void) => visit({ family: 'Noto Sans JP Variable', load: vi.fn(async () => undefined) }), load: vi.fn(async () => []) }
  vi.stubGlobal('document', { createElement: () => canvas, fonts })
  return { context, canvas, fonts }
}

const base: Annotation = { id: 'a', pageId: 'p', type: 'shape', x: 0, y: 0, width: 80, height: 40 }

describe('material rendering for preview and PDF export', () => {
  it('uses real selected font styling and underlines each nonempty wrapped line', async () => {
    const { context, fonts } = drawingContext()
    await annotationToDataUrl({ ...base, type: 'text', width: 44, height: 100, text: '請求書本文\n\nABC', fontFamily: 'noto-sans-jp', fontSize: 11, fontWeight: 700, fontStyle: 'italic', underline: true, color: '#123456' })
    expect(context.font).toBe('italic 700 11px "Noto Sans JP Variable", sans-serif')
    expect(fonts.load).toHaveBeenCalledWith(context.font, '請求書本文\n\nABC')
    expect(context.fillText.mock.calls.map((args) => args[0])).toEqual(['請求書本', '文', '', 'ABC'])
    expect(context.stroke).toHaveBeenCalledTimes(3)
    expect(context.strokeStyle).toBe('#123456')
  })

  it('draws a rectangle with transparent fill and a wholly inset outline by default', async () => {
    const { context } = drawingContext()
    await annotationToDataUrl(base)
    expect(context.rect).toHaveBeenCalledWith(0.75, 0.75, 78.5, 38.5)
    expect(context.strokeStyle).toBe('#000000')
    expect(context.lineWidth).toBe(1.5)
    expect(context.fill).not.toHaveBeenCalled()
    expect(context.stroke).toHaveBeenCalledOnce()
  })

  it('places an underline below actual CJK ink instead of through its descenders', async () => {
    const { context } = drawingContext()
    context.measureText = (text: string) => ({ width: text.length * 10, actualBoundingBoxDescent: 17 })
    await annotationToDataUrl({ ...base, type: 'text', text: '文字', fontSize: 11, underline: true })
    expect(context.moveTo.mock.calls[0][1]).toBeGreaterThan(2 + 17)
  })

  it('fills an ellipse without a border when the outline is set to none', async () => {
    const { context } = drawingContext()
    await annotationToDataUrl({ ...base, shapeKind: 'ellipse', strokeColor: 'none', fillColor: '#ffcc00' })
    expect(context.ellipse).toHaveBeenCalledWith(40, 20, 40, 20, 0, 0, Math.PI * 2)
    expect(context.fillStyle).toBe('#ffcc00')
    expect(context.fill).toHaveBeenCalledOnce()
    expect(context.stroke).not.toHaveBeenCalled()
  })

  it('keeps a thick triangle outline inside a tiny shape instead of using an overflowing miter', async () => {
    const { context } = drawingContext()
    await annotationToDataUrl({ ...base, shapeKind: 'triangle', width: 8, height: 12, strokeWidth: 20, strokeColor: '#008800', fillColor: '#ffffff' })
    expect(context.lineWidth).toBe(8)
    expect(context.lineJoin).toBe('round')
    expect(context.moveTo).toHaveBeenCalledWith(4, 4)
    expect(context.lineTo.mock.calls).toEqual([[4, 8], [4, 8]])
    expect(context.fill).toHaveBeenCalledOnce()
    expect(context.stroke).toHaveBeenCalledOnce()
  })

  it('does not replace a zero outline width with its default', async () => {
    const { context } = drawingContext()
    await annotationToDataUrl({ ...base, strokeWidth: 0, fillColor: '#ffffff' })
    expect(context.rect).toHaveBeenCalledWith(0, 0, 80, 40)
    expect(context.stroke).not.toHaveBeenCalled()
    expect(context.fill).toHaveBeenCalledOnce()
  })
})
