import type { Annotation } from './types'

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })
const rotated = new Set(Array.from('ーｰ―‐–—〜～…‥（）()［］[]｛｝{}〈〉《》「」『』【】〔〕〖〗〘〙〚〛'))
const punctuation = new Set(Array.from('、。､｡，．'))
const smallKana = new Set(Array.from('ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ'))

/** Explicit line breaks advance to the left; a grapheme remains one cell. */
export function verticalColumns(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').normalize('NFC').replace(/\t/g, '　')
    .split('\n').map(line => Array.from(segmenter.segment(line), part => part.segment))
}

export function verticalTextSize(text: string, fontSize: number) {
  const columns = verticalColumns(text)
  return { width: columns.length * fontSize * 1.4 + 4, height: Math.max(1, ...columns.map(column => column.length)) * fontSize + 6 }
}

/** Shared by preview and PDF output. Latin letters/digits remain upright. */
export function drawVerticalText(context: CanvasRenderingContext2D, annotation: Annotation) {
  const size = annotation.fontSize || 16
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  verticalColumns(annotation.text || '').forEach((column, index) => {
    const x = annotation.width - 2 - size * 0.7 - index * size * 1.4
    column.forEach((text, row) => {
      const offset = punctuation.has(text) ? 0.5 : smallKana.has(text) ? 0.12 : 0
      context.save()
      context.translate(x + offset * size, 2 + (row + 0.5 - offset) * size)
      if (rotated.has(text)) context.rotate(Math.PI / 2)
      context.fillText(text, 0, size * 0.38)
      context.restore()
    })
    if (annotation.underline && column.length) {
      context.lineWidth = Math.max(0.6, size / 16)
      context.beginPath()
      context.moveTo(x + size * 0.6, 2)
      context.lineTo(x + size * 0.6, 2 + column.length * size)
      context.stroke()
    }
  })
}
