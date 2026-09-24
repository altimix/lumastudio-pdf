import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { decodeProject, encodeProject, type PdfProject } from './project'
import type { FontFamilyId, ShapeKind } from './types'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPIYAAAAASUVORK5CYII='
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='
const encoder = new TextEncoder()

function example(): PdfProject {
  return {
    filename: '申込書_結合.pdf',
    original: encoder.encode('%PDF-1.7\n% codec fixture; the app validates actual PDF structure when opening.\n%%EOF\n'),
    pages: [
      { id: 'page-two', sourceIndex: 1, width: 600, height: 800, rotation: 90, originalRotation: 0, viewportTransform: [1, 0, 0, -1, 0, 800], sourceName: '追加.pdf', sourcePage: 1 },
      { id: 'page-one', sourceIndex: 0, width: 600, height: 800, rotation: 270, originalRotation: 0, viewportTransform: [1, 0, 0, -1, 0, 800] },
    ],
    annotations: [
      { id: 'name', pageId: 'page-one', type: 'text', x: 20, y: 30, width: 150, height: 30, text: '架空 太郎', color: '#25383c', fontSize: 14 },
      { id: 'seal', pageId: 'page-two', type: 'stamp', x: 450, y: 650, width: 60, height: 60, text: '架空', stampShape: 'circle', color: '#a32' },
      { id: 'image', pageId: 'page-two', type: 'image', x: 80, y: 80, width: 30, height: 30, dataUrl: PNG },
      { id: 'photo', pageId: 'page-one', type: 'image', x: 80, y: 80, width: 30, height: 30, dataUrl: JPEG },
      { id: 'check', pageId: 'page-one', type: 'check', x: 180, y: 180, width: 20, height: 20 },
    ],
  }
}

function rawExample(): Record<string, any> {
  return JSON.parse(new TextDecoder().decode(encodeProject(example())))
}

function decodeRaw(value: unknown) {
  return decodeProject(encoder.encode(JSON.stringify(value)))
}

describe('editable PDF project', () => {
  it('writes version 3 so older apps cannot discard marker tips or line directions, and still reads versions 1 and 2', () => {
    const raw = rawExample()
    expect(raw.version).toBe(3)
    for (const version of [1, 2]) {
      raw.version = version
      expect(decodeRaw(raw)).toEqual(example())
    }
  })
  it('round-trips original PDF bytes, page order and rotation, annotation IDs, text, seals and images', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([600, 800])
    pdf.addPage([600, 800])
    const project = example()
    project.original = await pdf.save()
    const original = project.original.slice()
    const bytes = encodeProject(project)
    const restored = decodeProject(bytes)
    expect(restored).toEqual(project)
    expect(restored.pages.map(page => [page.sourceIndex, page.rotation])).toEqual([[1, 90], [0, 270]])
    expect(restored.annotations.map(annotation => annotation.id)).toEqual(['name', 'seal', 'image', 'photo', 'check'])
    expect((await PDFDocument.load(restored.original)).getPageCount()).toBe(2)
    expect(project.original).toEqual(original)
    expect(restored.pages).not.toBe(project.pages)
    expect(restored.annotations).not.toBe(project.annotations)
  })

  it('retains imported seal identity while rejecting that marker on ordinary text', () => {
    const project = example()
    project.annotations[2].stampSource = true
    expect(decodeProject(encodeProject(project)).annotations[2].stampSource).toBe(true)
    const raw = rawExample()
    raw.annotations[0].stampSource = true
    expect(() => decodeRaw(raw)).toThrow('画像印鑑の種類が不正')
  })

  it('encodes large buffers in chunks without corrupting base64 boundaries or typed-array subviews', () => {
    const backing = new Uint8Array(120_003)
    const original = backing.subarray(13, 110_014)
    original.set(encoder.encode('%PDF-1.7\n'))
    for (let index = 9; index < original.length; index++) original[index] = index % 256
    const project = { ...example(), original }
    expect(decodeProject(encodeProject(project)).original).toEqual(original)
  })

  it.each<FontFamilyId>(['legacy', 'noto-sans-jp', 'noto-serif-jp', 'm-plus-1', 'biz-udgothic'])('round-trips %s with bold, italic and underline', fontFamily => {
    const project = example()
    Object.assign(project.annotations[0], { fontFamily, fontWeight: 700, fontStyle: 'italic', underline: true })
    expect(decodeProject(encodeProject(project))).toEqual(project)
  })

  it('preserves absent typography metadata in older work files', () => {
    const restored = decodeProject(encodeProject(example()))
    expect(restored.annotations[0]).not.toHaveProperty('fontFamily')
    expect(restored.annotations[0]).not.toHaveProperty('fontWeight')
    expect(restored.annotations[0]).not.toHaveProperty('fontStyle')
    expect(restored.annotations[0]).not.toHaveProperty('underline')
  })

  it.each<ShapeKind>(['rectangle', 'ellipse', 'triangle', 'line', 'double-line'])('round-trips editable %s geometry, transparent fill and stroke', shapeKind => {
    const project = example()
    project.annotations.push({ id: 'shape', pageId: 'page-one', type: 'shape', shapeKind, x: 40, y: 110, width: 130, height: 40, aspectLocked: true, fillColor: 'none', strokeColor: '#f00', strokeWidth: 1.5 })
    expect(decodeProject(encodeProject(project))).toEqual(project)
    Object.assign(project.annotations.at(-1)!, { strokeColor: 'none', fillColor: '#00aabb', strokeWidth: 0 })
    expect(decodeProject(encodeProject(project))).toEqual(project)
  })

  it('round-trips pen and marker paths and rejects points outside the page box', () => {
    const project = example()
    project.annotations.push({ id: 'pen', pageId: 'page-one', type: 'pen', x: 40, y: 50, width: 150, height: 30, color: '#123456', strokeWidth: 2, points: [{ x: 0.05, y: 0.2 }, { x: 0.9, y: 0.8 }] })
    project.annotations.push({ id: 'marker', pageId: 'page-two', type: 'marker', x: 100, y: 200, width: 200, height: 25, color: '#ffe14a', strokeWidth: 18, markerCap: 'square', points: [{ x: 0.05, y: 0.5 }, { x: 0.95, y: 0.5 }] })
    expect(decodeProject(encodeProject(project))).toEqual(project)
    const invalid = JSON.parse(new TextDecoder().decode(encodeProject(project)))
    invalid.annotations.at(-1).points[0].x = 1.1
    expect(() => decodeRaw(invalid)).toThrow('手書き線の横位置')
    invalid.annotations.at(-1).points[0].x = 0.1
    invalid.annotations[0].points = [{ x: 0.5, y: 0.5 }]
    expect(() => decodeRaw(invalid)).toThrow('手書き線以外')
  })

  it('keeps the direction of dragged lines and old highlighter work files compatible', () => {
    const project = example()
    project.annotations.push({ id: 'line', pageId: 'page-one', type: 'shape', shapeKind: 'line', lineDirection: 'up', x: 40, y: 110, width: 130, height: 40 })
    project.annotations.push({ id: 'old-marker', pageId: 'page-one', type: 'marker', x: 100, y: 200, width: 200, height: 25, color: '#ffe14a', strokeWidth: 18, points: [{ x: 0.05, y: 0.5 }, { x: 0.95, y: 0.5 }] })
    const restored = decodeProject(encodeProject(project))
    expect(restored.annotations.at(-2)?.lineDirection).toBe('up')
    expect(restored.annotations.at(-1)).not.toHaveProperty('markerCap')
  })

  it('only saves allowed document fields and drops unrelated metadata on decode', () => {
    const project = example()
    const extras = {
      ...project,
      profile: { name: 'PRIVATE PROFILE', account: 'PRIVATE ACCOUNT' },
      stampLibrary: ['PRIVATE LIBRARY'],
      apiKey: 'PRIVATE API KEY',
    }
    Object.assign(extras.pages[0], { profile: 'PRIVATE PAGE METADATA' })
    Object.assign(extras.annotations[0], { apiKey: 'PRIVATE ANNOTATION METADATA' })
    const bytes = encodeProject(extras)
    const serialized = new TextDecoder().decode(bytes)
    expect(serialized).not.toContain('PRIVATE')
    const raw = JSON.parse(serialized)
    Object.assign(raw, { apiKey: 'PRIVATE API KEY', profile: { account: 'PRIVATE ACCOUNT' }, '__proto__': { poisoned: true } })
    raw.pages[0].path = 'PRIVATE SOURCE PATH'
    raw.annotations[0].settings = 'PRIVATE SETTINGS'
    const restored = decodeRaw(raw)
    expect(Object.keys(restored).sort()).toEqual(['annotations', 'filename', 'original', 'pages'])
    expect(new TextDecoder().decode(encodeProject(restored))).not.toContain('PRIVATE')
  })

  it.each([
    ['wrong app', (raw: any) => { raw.app = 'another editor' }, /LumaStudio/],
    ['future version', (raw: any) => { raw.version = 4 }, /バージョン/],
    ['missing version', (raw: any) => { delete raw.version }, /バージョン/],
    ['empty page list', (raw: any) => { raw.pages = [] }, /ページ数/],
    ['too many pages', (raw: any) => { raw.pages = Array(201).fill(raw.pages[0]) }, /ページ数/],
    ['duplicate page ids', (raw: any) => { raw.pages[1].id = raw.pages[0].id }, /ページIDが重複/],
    ['negative source index', (raw: any) => { raw.pages[0].sourceIndex = -1 }, /ページ番号/],
    ['out-of-range source index', (raw: any) => { raw.pages[0].sourceIndex = 200 }, /ページ番号/],
    ['fractional source index', (raw: any) => { raw.pages[0].sourceIndex = 1.5 }, /整数/],
    ['invalid page rotation', (raw: any) => { raw.pages[0].rotation = 45 }, /回転/],
    ['invalid original rotation', (raw: any) => { raw.pages[0].originalRotation = -90 }, /回転/],
    ['zero width', (raw: any) => { raw.pages[0].width = 0 }, /幅/],
    ['huge height', (raw: any) => { raw.pages[0].height = 14401 }, /高さ/],
    ['missing transform', (raw: any) => { delete raw.pages[0].viewportTransform }, /座標変換/],
    ['short transform', (raw: any) => { raw.pages[0].viewportTransform = [1, 0] }, /座標変換/],
    ['singular transform', (raw: any) => { raw.pages[0].viewportTransform = [1, 2, 2, 4, 0, 0] }, /座標変換/],
    ['overflowing determinant', (raw: any) => { raw.pages[0].viewportTransform = [1e308, 0, 0, 1e308, 0, 0] }, /座標変換/],
    ['unknown page reference', (raw: any) => { raw.annotations[0].pageId = 'missing' }, /記入先のページ/],
    ['duplicate annotation ids', (raw: any) => { raw.annotations[1].id = raw.annotations[0].id }, /記入のIDが重複/],
    ['unsupported annotation type', (raw: any) => { raw.annotations[0].type = 'script' }, /種類/],
    ['negative x', (raw: any) => { raw.annotations[0].x = -1 }, /横位置/],
    ['annotation outside page', (raw: any) => { raw.annotations[0].x = 590 }, /範囲/],
    ['negative annotation width', (raw: any) => { raw.annotations[0].width = -1 }, /幅/],
    ['too much text', (raw: any) => { raw.annotations[0].text = '文'.repeat(3001) }, /3000文字/],
    ['font too small', (raw: any) => { raw.annotations[0].fontSize = 5 }, /文字サイズ/],
    ['font too large', (raw: any) => { raw.annotations[0].fontSize = 97 }, /文字サイズ/],
    ['unknown font', (raw: any) => { raw.annotations[0].fontFamily = 'remote-font' }, /フォント/],
    ['font CSS injection', (raw: any) => { raw.annotations[0].fontFamily = 'url(https://example.test/font)' }, /フォント/],
    ['string font weight', (raw: any) => { raw.annotations[0].fontWeight = '700' }, /太さ/],
    ['unsupported font weight', (raw: any) => { raw.annotations[0].fontWeight = 900 }, /太さ/],
    ['unsupported font style', (raw: any) => { raw.annotations[0].fontStyle = 'oblique 45deg' }, /スタイル/],
    ['nonboolean underline', (raw: any) => { raw.annotations[0].underline = 'false' }, /下線/],
    ['nonboolean aspect lock', (raw: any) => { raw.annotations[0].aspectLocked = 'false' }, /縦横比ロック/],
    ['missing shape kind', (raw: any) => { raw.annotations[0].type = 'shape' }, /図形の種類/],
    ['unsupported shape kind', (raw: any) => { Object.assign(raw.annotations[0], { type: 'shape', shapeKind: 'svg' }) }, /図形の種類/],
    ['invalid line direction', (raw: any) => { Object.assign(raw.annotations[0], { type: 'shape', shapeKind: 'line', lineDirection: 'backwards' }) }, /線の方向/],
    ['invalid highlighter tip', (raw: any) => { raw.annotations[0].markerCap = 'round' }, /蛍光ペンの端/],
    ['fill CSS injection', (raw: any) => { raw.annotations[0].fillColor = 'url(https://example.test/fill)' }, /塗りつぶしの色/],
    ['stroke CSS injection', (raw: any) => { raw.annotations[0].strokeColor = 'var(--external)' }, /枠線の色/],
    ['negative stroke width', (raw: any) => { raw.annotations[0].strokeWidth = -1 }, /枠線の太さ/],
    ['huge stroke width', (raw: any) => { raw.annotations[0].strokeWidth = 21 }, /枠線の太さ/],
    ['CSS color injection', (raw: any) => { raw.annotations[0].color = 'url(https://example.test/a)' }, /色/],
    ['unknown stamp shape', (raw: any) => { raw.annotations[1].stampShape = 'triangle' }, /印鑑の形/],
    ['missing image', (raw: any) => { delete raw.annotations[2].dataUrl }, /画像/],
    ['remote image', (raw: any) => { raw.annotations[2].dataUrl = 'https://example.test/a.png' }, /PNGまたはJPEG/],
    ['SVG image', (raw: any) => { raw.annotations[2].dataUrl = 'data:image/svg+xml;base64,PHN2Zy8+' }, /PNGまたはJPEG/],
    ['fake PNG', (raw: any) => { raw.annotations[2].dataUrl = `data:image/png;base64,${btoa('<script>bad</script>')}` }, /PNG画像のヘッダー/],
    ['fake JPEG', (raw: any) => { raw.annotations[3].dataUrl = `data:image/jpeg;base64,${btoa('<script>bad</script>')}` }, /JPEG画像のヘッダー/],
    ['invalid base64 characters', (raw: any) => { raw.original = '!!!!' }, /Base64/],
    ['invalid base64 padding', (raw: any) => { raw.original = 'QQ=A' }, /Base64/],
    ['noncanonical base64 padding bits', (raw: any) => { raw.original = 'QR==' }, /Base64/],
    ['wrong PDF header', (raw: any) => { raw.original = btoa('<html>not a PDF</html>') }, /PDFのヘッダー/],
    ['empty PDF', (raw: any) => { raw.original = '' }, /空か/],
    ['too many annotations', (raw: any) => { raw.annotations = Array(2001).fill(raw.annotations[0]) }, /2000個/],
  ])('rejects %s', (_, mutate, message) => {
    const raw = rawExample()
    mutate(raw)
    expect(() => decodeRaw(raw)).toThrow(message)
  })

  it('rejects nonfinite values on encode before JSON could convert them to null', () => {
    const project = example()
    project.pages[0].width = Infinity
    expect(() => encodeProject(project)).toThrow(/幅/)
    project.pages[0].width = 600
    project.annotations[0].y = NaN
    expect(() => encodeProject(project)).toThrow(/縦位置/)
  })

  it('rejects oversized projects and original PDF inputs before decoding or allocating base64', () => {
    expect(() => decodeProject(new Uint8Array(100 * 1024 * 1024 + 1))).toThrow(/100MB/)
    const project = example()
    project.original = new Uint8Array(50 * 1024 * 1024 + 1)
    project.original.set(encoder.encode('%PDF-1.7\n'))
    expect(() => encodeProject(project)).toThrow(/50MB/)
  })

  it('rejects an oversized encoded source before allocating its decoded bytes', () => {
    const raw = rawExample()
    raw.original = 'A'.repeat(Math.ceil(50 * 1024 * 1024 / 3) * 4 + 4)
    expect(() => decodeRaw(raw)).toThrow(/50MB/)
  })

  it('rejects images over 2 MB', () => {
    const raw = rawExample()
    raw.annotations[2].dataUrl = `data:image/png;base64,${'A'.repeat(Math.ceil(2 * 1024 * 1024 / 3) * 4 + 4)}`
    expect(() => decodeRaw(raw)).toThrow(/2MB/)
  })

  it.each([
    new Uint8Array(),
    encoder.encode('{'),
    encoder.encode('null'),
    encoder.encode('[]'),
    new Uint8Array([123, 34, 255, 34, 58, 49, 125]),
  ])('rejects empty, malformed and invalid UTF-8 documents', bytes => {
    expect(() => decodeProject(bytes)).toThrow(/作業ファイル/)
  })
})
