import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

test('日本語と下へ伸びる英字の下線が、同梱書体の文字に重ならない', async ({ page }) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { annotationToDataUrl } = await import('/src/lib/pdf.ts')
    const output = []
    for (const fontFamily of ['noto-sans-jp', 'noto-serif-jp', 'm-plus-1', 'biz-udgothic']) {
      for (const fontSize of [11, 36]) {
        const base = { id:'underline', pageId:'p', type:'text', x:0, y:0, width:450, height:100,
          text:'日本語の編集 Agjp', fontSize, fontFamily, fontWeight:700, fontStyle:'italic' }
        async function pixels(underline: boolean) {
          const image = new Image(); image.src = await annotationToDataUrl({ ...base, underline }); await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
          const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
          return { width:canvas.width, height:canvas.height, data:context.getImageData(0, 0, canvas.width, canvas.height).data }
        }
        const normal = await pixels(false), decorated = await pixels(true)
        let lastInk = -1, firstUnderline = -1
        for (let y = 0; y < normal.height; y++) {
          let added = 0
          for (let x = 0; x < normal.width; x++) {
            const index = (y * normal.width + x) * 4 + 3
            if (normal.data[index] > 20) lastInk = y
            if (decorated.data[index] - normal.data[index] > 20) added++
          }
          if (added > 30 && firstUnderline < 0) firstUnderline = y
        }
        output.push({ fontFamily, fontSize, lastInk, firstUnderline })
      }
    }
    return output
  })
  for (const result of results) expect(result.firstUnderline, JSON.stringify(result)).toBeGreaterThan(result.lastInk)
})

test('同梱4書体を外部通信なしで読み込み、字体・太字・斜体・下線を描き分ける', async ({ page, context }) => {
  const external: string[] = []
  const fonts: string[] = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) {
      if (/\.woff2?(?:\?|$)/.test(url.pathname)) fonts.push(url.href)
      await route.continue()
    } else {
      external.push(url.href)
      await route.abort()
    }
  })
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const fontModule = await import('/src/lib/fonts.ts')
    const { annotationToDataUrl } = await import('/src/lib/pdf.ts')
    const annotations = ['noto-sans-jp', 'noto-serif-jp', 'm-plus-1', 'biz-udgothic'].map((fontFamily) => ({
      id: fontFamily, pageId: 'one', type: 'text', x: 0, y: 0,
      width: 260, height: 65, text: '日本語の書類 123 ABC', fontSize: 24, fontFamily,
    }))
    const hashes: string[] = []
    const ready: boolean[] = []
    async function signature(annotation: typeof annotations[number]) {
      const png = await annotationToDataUrl(annotation)
      const bytes = new TextEncoder().encode(png)
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((item) => item.toString(16).padStart(2, '0')).join('')
    }
    for (const annotation of annotations) {
      hashes.push(await signature(annotation))
      ready.push(fontModule.isTextFontReady(annotation))
    }
    const base = annotations[0]
    const styled = []
    for (const style of [{ fontWeight: 700 }, { fontStyle: 'italic' }, { underline: true }]) {
      styled.push(await signature({ ...base, ...style }))
    }
    const faces = Array.from(document.fonts).filter((face) => /Noto Sans JP Variable|Noto Serif JP Variable|M PLUS 1 Variable|BIZ UDGothic/.test(face.family))
    return { hashes, ready, styled, faces: faces.length, unloaded: faces.filter((face) => face.status !== 'loaded').length }
  })
  expect(result.ready).toEqual([true, true, true, true])
  expect(new Set(result.hashes).size).toBe(4)
  expect(new Set([result.hashes[0], ...result.styled]).size).toBe(4)
  expect(result.faces).toBeGreaterThan(400)
  expect(result.unloaded).toBeGreaterThan(result.faces / 2)
  expect(result.unloaded).toBeLessThan(result.faces)
  expect(fonts.length).toBeGreaterThan(0)
  expect(fonts.length).toBeLessThan(result.faces / 2)
  expect(external).toEqual([])
})

test('四角・楕円・三角の塗りと枠線を実際の保存PDFに同じ色で残す', async ({ page, context }) => {
  await context.route('https://**', (route) => route.abort())
  const source = await PDFDocument.create()
  source.addPage([300, 300])
  const bytes = Array.from(await source.save())
  await page.goto('/')
  const pixels = await page.evaluate(async (original) => {
    const { exportPdf, loadPdf, renderPdfPage } = await import('/src/lib/pdf.ts')
    const base = { id: 'a', pageId: 'one', type: 'shape', width: 80, height: 60, x: 20, y: 20 }
    const annotations = [
      { ...base, shapeKind: 'rectangle', strokeColor: '#ff0000', strokeWidth: 4, fillColor: 'none' },
      { ...base, id: 'b', x: 120, shapeKind: 'ellipse', strokeColor: 'none', fillColor: '#00cc00' },
      { ...base, id: 'c', y: 120, shapeKind: 'triangle', strokeColor: '#0000ff', strokeWidth: 4, fillColor: '#ffff00' },
    ]
    const exported = await exportPdf(new Uint8Array(original), [{ id: 'one', sourceIndex: 0, width: 300, height: 300, rotation: 0 }], annotations)
    const loaded = await loadPdf(exported)
    const canvas = document.createElement('canvas')
    await renderPdfPage(loaded.document, 0, canvas, 1)
    const context = canvas.getContext('2d')!
    const sample = (x: number, y: number) => Array.from(context.getImageData(Math.floor(x * canvas.width / 300), Math.floor(y * canvas.height / 300), 1, 1).data)
    const result = { rectangleBorder: sample(21, 45), rectangleCenter: sample(60, 50), ellipseCenter: sample(160, 50), ellipseCorner: sample(121, 21), triangleFill: sample(60, 160), triangleOutside: sample(21, 121) }
    await loaded.document.loadingTask.destroy()
    return result
  }, bytes)
  expect(pixels.rectangleBorder).toEqual([255, 0, 0, 255])
  expect(pixels.rectangleCenter).toEqual([255, 255, 255, 255])
  expect(pixels.ellipseCenter).toEqual([0, 204, 0, 255])
  expect(pixels.ellipseCorner).toEqual([255, 255, 255, 255])
  expect(pixels.triangleFill).toEqual([255, 255, 0, 255])
  expect(pixels.triangleOutside).toEqual([255, 255, 255, 255])
})
