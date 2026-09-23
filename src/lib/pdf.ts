import { EncryptedPDFError, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFPageLeaf, PDFRef, PDFSignature, PDFStream, PDFString, degrees } from 'pdf-lib'
import type { PDFObject } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Annotation, PageInfo } from './types'
import { ensureTextFont, fontCssFamily, resolveTextGeometry, textFontCss, underlineOffset, wrapTextLines } from './fonts'

export type { Annotation, PageInfo } from './types'

const FONT = fontCssFamily('legacy')
const SEAL_FONT = '"Yu Mincho", "Hiragino Mincho ProN", "MS Mincho", serif'
const rendering = new WeakMap<HTMLCanvasElement, { cancel(): void; promise: Promise<void> }>()
const renderRequests = new WeakMap<HTMLCanvasElement, symbol>()

export function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360
}

export class ProtectedPdfError extends Error {
  constructor(public readonly kind: 'password' | 'restricted', message: string) {
    super(message)
    this.name = 'ProtectedPdfError'
  }
}

export class EditableCopyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditableCopyError'
  }
}

async function startPdfjs(bytes: Uint8Array, password?: string) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const assetUrl = (directory: string) => new URL(`./pdfjs/${directory}/`, window.document.baseURI).href
  return pdfjs.getDocument({
    data: bytes.slice(), password, useSystemFonts: true,
    cMapUrl: assetUrl('cmaps'), cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'), wasmUrl: assetUrl('wasm'), iccUrl: assetUrl('iccs'),
  })
}

export async function loadPdf(bytes: Uint8Array): Promise<{ document: PDFDocumentProxy; pages: PageInfo[]; signed: boolean }> {
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error('100MBまでのPDFを開けます。ファイルを分割してお試しください。')
  // PDF.js transfers its input buffer to the worker. Keep the caller's original intact.
  const task = await startPdfjs(bytes)
  let document: PDFDocumentProxy
  try {
    document = await task.promise
  } catch (error) {
    await task.destroy()
    if (error instanceof Error && error.name === 'PasswordException')
      throw new ProtectedPdfError('password', 'このPDFを開くにはパスワードが必要です。')
    throw new Error('PDFを開けませんでした。ファイルが壊れていないか確認してください。')
  }
  const pages: PageInfo[] = []
  try {
    if (document.numPages > 200) throw new Error('200ページまでのPDFを開けます。ファイルを分割してお試しください。')
    for (let index = 0; index < document.numPages; index += 1) {
      const page = await document.getPage(index + 1)
      const viewport = page.getViewport({ scale: 1 })
      pages.push({
        id: crypto.randomUUID(), sourceIndex: index,
        width: viewport.width, height: viewport.height, rotation: 0,
        originalRotation: page.rotate, viewportTransform: [...viewport.transform],
      })
    }
    let signatureSource: PDFDocument
    try {
      signatureSource = await PDFDocument.load(bytes, { updateMetadata: false })
    } catch (error) {
      if (error instanceof EncryptedPDFError || (error instanceof Error && error.message.includes('Input document to `PDFDocument.load` is encrypted')))
        throw new ProtectedPdfError('restricted', 'このPDFには編集・保存の制限があります。')
      throw error
    }
    return { document, pages, signed: hasDigitalSignature(signatureSource) }
  } catch (error) {
    await document.loadingTask.destroy()
    throw error
  }
}

/** Render visible pages into a new unsigned PDF; never mutate or save the protected original. */
export async function createEditableCopy(
  bytes: Uint8Array, password?: string, onProgress?: (completed: number, total: number) => void,
): Promise<Uint8Array> {
  if (bytes.byteLength > 50 * 1024 * 1024) throw new EditableCopyError('編集用コピーを作れる原本は50MBまでです。')
  const task = await startPdfjs(bytes, password)
  try {
    let source: PDFDocumentProxy
    try {
      source = await task.promise
    } catch (error) {
      if (error instanceof Error && error.name === 'PasswordException')
        throw new ProtectedPdfError('password', password ? 'パスワードが違います。確認して再入力してください。' : 'PDFを開くパスワードを入力してください。')
      throw new EditableCopyError('保護されたPDFを開けませんでした。ファイルを確認してください。')
    }
    if (source.numPages < 1 || source.numPages > 200) throw new EditableCopyError('編集用コピーは200ページまで作成できます。')
    if (source.isPureXfa) throw new EditableCopyError('XFA専用フォームは正しく画像化できません。元のアプリからPDFとして印刷して開いてください。')
    const output = await PDFDocument.create()
    let imageDataLength = 0
    for (let index = 0; index < source.numPages; index += 1) {
      const sourcePage = await source.getPage(index + 1)
      const size = sourcePage.getViewport({ scale: 1 })
      if (!(size.width > 0 && size.height > 0) || size.width * size.height > 16_000_000)
        throw new EditableCopyError('ページの大きさが変換上限を超えています。')
      const scale = Math.min(2.5, Math.sqrt(12_000_000 / (size.width * size.height)))
      const viewport = sourcePage.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new EditableCopyError('PDFの描画領域を作成できませんでした。')
      await sourcePage.render({ canvas, canvasContext: context, viewport }).promise
      const imageData = canvas.toDataURL('image/jpeg', 0.9)
      imageDataLength += imageData.length
      if (imageDataLength > 68 * 1024 * 1024) throw new EditableCopyError('編集用コピーが50MBを超えるため、ページを分けてお試しください。')
      const image = await output.embedJpg(imageData)
      output.addPage([size.width, size.height]).drawImage(image, { x: 0, y: 0, width: size.width, height: size.height })
      canvas.width = canvas.height = 0
      sourcePage.cleanup()
      onProgress?.(index + 1, source.numPages)
    }
    output.setTitle('LumaStudio PDF 編集用コピー')
    const result = await output.save()
    if (result.byteLength > 50 * 1024 * 1024) throw new EditableCopyError('編集用コピーが50MBを超えるため、ページを分けてお試しください。')
    return result
  } finally {
    await task.destroy()
  }
}

/** The canvas stays at the original page orientation; the UI rotates its wrapper. */
export async function renderPdfPage(document: PDFDocumentProxy, index: number, canvas: HTMLCanvasElement, scale = 1): Promise<void> {
  const request = Symbol('render')
  renderRequests.set(canvas, request)
  const previous = rendering.get(canvas)
  if (previous) {
    previous.cancel()
    await previous.promise.catch(() => undefined)
  }
  const page = await document.getPage(index + 1)
  if (renderRequests.get(canvas) !== request) return
  const original = page.getViewport({ scale: 1 })
  const pixelRatio = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2)
  const requested = Math.max(0.05, scale) * pixelRatio
  const safeScale = Math.min(requested, Math.sqrt(16_000_000 / (original.width * original.height)))
  const viewport = page.getViewport({ scale: safeScale })
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('PDF描画用のキャンバスを作成できませんでした。')
  const task = page.render({ canvas, canvasContext: context, viewport })
  rendering.set(canvas, task)
  try {
    await task.promise
  } catch (error) {
    if (!(error instanceof Error && error.name === 'RenderingCancelledException')) throw error
  } finally {
    if (rendering.get(canvas) === task) rendering.delete(canvas)
  }
}

/** Invert the PDF.js viewport transform (PDF bottom-left -> screen top-left). */
export function viewportToPdf(transform: readonly number[], x: number, y: number): { x: number; y: number } {
  if (transform.length !== 6) throw new Error('ページの座標情報が不正です。')
  const [a, b, c, d, e, f] = transform
  const determinant = a * d - b * c
  if (!Number.isFinite(determinant) || determinant === 0) throw new Error('ページの座標を変換できません。')
  return {
    x: (d * (x - e) - c * (y - f)) / determinant,
    y: (-b * (x - e) + a * (y - f)) / determinant,
  }
}

export function annotationPlacement(annotation: Pick<Annotation, 'x' | 'y' | 'width' | 'height'>, transform: readonly number[]) {
  const bottomLeft = viewportToPdf(transform, annotation.x, annotation.y + annotation.height)
  const bottomRight = viewportToPdf(transform, annotation.x + annotation.width, annotation.y + annotation.height)
  const topLeft = viewportToPdf(transform, annotation.x, annotation.y)
  return {
    x: bottomLeft.x, y: bottomLeft.y,
    width: Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.y - bottomLeft.y),
    height: Math.hypot(topLeft.x - bottomLeft.x, topLeft.y - bottomLeft.y),
    rotation: normalizeRotation(Math.round(Math.atan2(bottomRight.y - bottomLeft.y, bottomRight.x - bottomLeft.x) * 180 / Math.PI)),
  }
}

function makeCanvas(width: number, height: number, resolution = 3): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  const scale = Math.min(resolution, Math.sqrt(16_000_000 / (width * height)))
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('画像を作成できませんでした。')
  context.scale(canvas.width / width, canvas.height / height)
  return { canvas, context }
}

/** Uses the same raster for preview and export, keeping Japanese glyphs identical. */
export async function annotationToDataUrl(annotation: Annotation): Promise<string> {
  if (annotation.type === 'image' && annotation.dataUrl) return annotation.dataUrl
  const { width, height } = annotation
  if (!(width > 0 && height > 0)) throw new Error('追加する要素のサイズが不正です。')
  if (annotation.type === 'text') await ensureTextFont(annotation)
  else if (document.fonts) await document.fonts.ready
  const { canvas, context } = makeCanvas(width, height)
  const color = annotation.color || (annotation.type === 'stamp' ? '#b82e2b' : '#000000')
  context.fillStyle = color
  context.strokeStyle = color
  if (annotation.type === 'shape') {
    const lineShape = annotation.shapeKind === 'line' || annotation.shapeKind === 'double-line'
    const strokeColor = lineShape && annotation.strokeColor === 'none' ? '#000000' : annotation.strokeColor ?? '#000000'
    const fillColor = lineShape ? 'none' : annotation.fillColor ?? 'none'
    const requestedStroke = lineShape ? Math.max(0.5, annotation.strokeWidth ?? 1.5) : annotation.strokeWidth ?? 1.5
    const strokeWidth = strokeColor === 'none' ? 0 : Math.min(Math.max(0, requestedStroke), 20, width, height)
    const inset = strokeWidth / 2
    context.beginPath()
    if (lineShape) {
      const offset = annotation.shapeKind === 'double-line'
        ? Math.min(height / 4, Math.max(strokeWidth, height * 0.14)) : 0
      context.moveTo(inset, height / 2 - offset)
      context.lineTo(width - inset, height / 2 - offset)
      if (annotation.shapeKind === 'double-line') {
        context.moveTo(inset, height / 2 + offset)
        context.lineTo(width - inset, height / 2 + offset)
      }
    } else if (annotation.shapeKind === 'ellipse') {
      context.ellipse(width / 2, height / 2, Math.max(0, width / 2 - inset), Math.max(0, height / 2 - inset), 0, 0, Math.PI * 2)
    } else if (annotation.shapeKind === 'triangle') {
      context.moveTo(width / 2, inset)
      context.lineTo(width - inset, height - inset)
      context.lineTo(inset, height - inset)
      context.closePath()
    } else {
      context.rect(inset, inset, Math.max(0, width - inset * 2), Math.max(0, height - inset * 2))
    }
    if (fillColor !== 'none') {
      context.fillStyle = fillColor
      context.fill()
    }
    if (strokeWidth > 0) {
      context.strokeStyle = strokeColor
      context.lineWidth = strokeWidth
      // Rounded joins keep a triangle's apex within its resize box, even when
      // the outline is wider than the shape's short side.
      context.lineJoin = 'round'
      context.stroke()
    }
  } else if (annotation.type === 'stamp') {
    const size = Math.min(width, height)
    const inset = Math.max(2, size * 0.045)
    context.lineWidth = Math.max(1.4, size * 0.035)
    if (annotation.stampShape === 'square') {
      context.strokeRect(inset, inset, width - inset * 2, height - inset * 2)
    } else {
      context.beginPath()
      context.ellipse(width / 2, height / 2, width / 2 - inset, height / 2 - inset, 0, 0, Math.PI * 2)
      context.stroke()
    }
    const text = (annotation.text || '印').trim()
    const characters = Array.from(text).slice(0, 8)
    const vertical = characters.length <= 3 && !/[a-zA-Z0-9]/.test(text)
    const columns = vertical ? 1 : characters.length > 4 ? 3 : 2
    const rows = vertical ? characters.length : Math.ceil(characters.length / columns)
    const fontSize = Math.min(width * 0.62 / columns, height * 0.76 / rows)
    context.font = `600 ${fontSize}px ${SEAL_FONT}`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    if (vertical) {
      characters.forEach((character, index) => context.fillText(character, width / 2, height / 2 + (index - (rows - 1) / 2) * fontSize * 1.02))
    } else {
      characters.forEach((character, index) => {
        const column = Math.floor(index / rows)
        const row = index % rows
        context.fillText(character, width / 2 + ((columns - 1) / 2 - column) * fontSize, height / 2 + (row - (rows - 1) / 2) * fontSize * 1.02)
      })
    }
  } else if (annotation.type === 'check') {
    context.lineWidth = Math.max(1.5, Math.min(width, height) * 0.11)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(width * 0.17, height * 0.51)
    context.lineTo(width * 0.42, height * 0.76)
    context.lineTo(width * 0.86, height * 0.2)
    context.stroke()
  } else {
    const fontSize = annotation.fontSize || 16
    context.font = textFontCss(annotation)
    context.textBaseline = 'top'
    wrapTextLines(context, annotation.text || '', Math.max(1, width - 4)).forEach((line, index) => {
      const y = 2 + index * fontSize * 1.4
      context.fillText(line, 2, y)
      if (annotation.underline && line) {
        context.lineWidth = Math.max(0.6, fontSize / 16)
        const underlineY = y + underlineOffset(context, line, fontSize)
        context.beginPath()
        context.moveTo(2, underlineY)
        context.lineTo(Math.min(width - 2, 2 + context.measureText(line).width), underlineY)
        context.stroke()
      }
    })
  }
  return canvas.toDataURL('image/png')
}

function fallbackTransform(page: ReturnType<PDFDocument['getPage']>): number[] {
  const box = page.getCropBox()
  const unitEntry = page.node.get(PDFName.of('UserUnit'))
  const unit = unitEntry && 'asNumber' in unitEntry ? (unitEntry as { asNumber(): number }).asNumber() : 1
  const rotation = normalizeRotation(page.getRotation().angle)
  const { x, y, width, height } = box
  if (rotation === 90) return [0, unit, unit, 0, -y * unit, -x * unit]
  if (rotation === 180) return [-unit, 0, 0, unit, (x + width) * unit, -y * unit]
  if (rotation === 270) return [0, -unit, -unit, 0, (y + height) * unit, (x + width) * unit]
  return [unit, 0, 0, -unit, -x * unit, (y + height) * unit]
}

/** Detect existing cryptographic signature data before any destructive rewriting. */
export function hasDigitalSignature(source: PDFDocument): boolean {
  const nonEmpty = (value: PDFObject | undefined) => {
    const resolved = value ? source.context.lookup(value) : undefined
    if (!resolved || resolved === PDFNull) return false
    if (resolved instanceof PDFString || resolved instanceof PDFHexString) return resolved.asBytes().length > 0
    if (resolved instanceof PDFDict) return resolved.keys().length > 0
    if (resolved instanceof PDFArray) return resolved.size() > 0
    return true
  }
  // Reading fields also handles inherited /FT and /V values.
  if (source.getForm().getFields().some((field) => field instanceof PDFSignature && nonEmpty(field.acroField.V()))) return true
  // Some producers leave signature dictionaries outside the canonical field tree.
  // Walk direct dictionaries too, and break indirect-reference cycles by identity.
  const pending: PDFObject[] = source.context.enumerateIndirectObjects().map(([, value]) => value)
  const visited = new Set<PDFObject>()
  while (pending.length) {
    const object = source.context.lookup(pending.pop()!)
    if (!object || visited.has(object)) continue
    visited.add(object)
    if (object instanceof PDFDict) {
      if (object.has(PDFName.of('ByteRange'))) return true
      if (object.get(PDFName.of('FT')) === PDFName.of('Sig') && nonEmpty(object.get(PDFName.of('V')))) return true
      pending.push(...object.values())
    } else if (object instanceof PDFArray) pending.push(...object.asArray())
  }
  return false
}

/** Preserve existing form appearances whenever pages leave their original document. */
function preparePagesForCopy(source: PDFDocument): void {
  // PDFDocument.getForm() silently deletes XFA in pdf-lib 1.17. Check the raw
  // dictionary before signature detection or any other getForm() call.
  if (source.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.has(PDFName.of('XFA'))) {
    throw new Error('XFAフォームの保存にはまだ対応していません。元のアプリからPDFとして印刷して開いてください。')
  }
  if (hasDigitalSignature(source)) throw new Error('電子署名済みPDFは署名を保持して再保存できません。署名前の原本を使用してください。')
  // This app returns a fixed, ready-to-send PDF. Paint existing field appearances
  // into page content before copying so their values survive without AcroForm.
  const form = source.getForm()
  if (form.hasXFA()) throw new Error('XFAフォームの保存にはまだ対応していません。元のアプリからPDFとして印刷して開いてください。')
  if (form.getFields().length > 0) {
    try {
      // pdf-lib 1.17 can leave dangling widget references in page Annots after
      // flatten. Remember non-field annotations first and restore only those.
      const widgets = new Set(form.getFields().flatMap((field) => field.acroField.getWidgets().map((widget) => widget.dict)))
      const remainingAnnotations = source.getPages().map((page) => ({
        page,
        entries: page.node.Annots()?.asArray().filter((reference) => {
          const dictionary = source.context.lookupMaybe(reference, PDFDict)
          return !dictionary || !widgets.has(dictionary)
        }),
      }))
      form.flatten({ updateFieldAppearances: false })
      for (const { page, entries } of remainingAnnotations) {
        if (entries) page.node.set(PDFName.of('Annots'), source.context.obj(entries))
      }
    } catch {
      throw new Error('このフォームの入力内容を保持して保存できません。元のアプリからPDFとして印刷して開いてください。')
    }
  }
}

/**
 * pdf-lib's copyPages follows Link destinations and annotation /P references as
 * ordinary objects. This creates orphan page copies, including deleted pages.
 * Pre-map every retained page before copying so navigation points to the actual
 * output page tree and omitted pages can never pull their content into a save.
 */
async function copySelectedPages(output: PDFDocument, source: PDFDocument, indices: number[]) {
  await source.flush()
  const sourcePages = source.getPages()
  const selected = new Set(indices)
  const pageIndexes = new Map<PDFObject, number>()
  sourcePages.forEach((page, index) => { pageIndexes.set(page.ref, index); pageIndexes.set(page.node, index) })
  const named = new Map<string, PDFObject>()
  const oldDestinations = source.context.lookup(source.catalog.get(PDFName.of('Dests')))
  if (oldDestinations instanceof PDFDict) {
    for (const [name, value] of oldDestinations.entries()) named.set(name.decodeText(), value)
  }
  const names = source.context.lookup(source.catalog.get(PDFName.of('Names')))
  const pending: PDFObject[] = names instanceof PDFDict && names.get(PDFName.of('Dests')) ? [names.get(PDFName.of('Dests'))!] : []
  const visitedNames = new Set<PDFObject>()
  while (pending.length) {
    const node = source.context.lookup(pending.pop()!)
    if (!(node instanceof PDFDict) || visitedNames.has(node)) continue
    visitedNames.add(node)
    const pairs = source.context.lookup(node.get(PDFName.of('Names')))
    if (pairs instanceof PDFArray) {
      for (let index = 0; index + 1 < pairs.size(); index += 2) {
        const key = source.context.lookup(pairs.get(index))
        if (key instanceof PDFString || key instanceof PDFHexString) named.set(key.decodeText(), pairs.get(index + 1))
      }
    }
    const children = source.context.lookup(node.get(PDFName.of('Kids')))
    if (children instanceof PDFArray) pending.push(...children.asArray())
  }
  const destinationModes = new Set(['XYZ', 'Fit', 'FitH', 'FitV', 'FitR', 'FitB', 'FitBH', 'FitBV'])
  const destination = (value: PDFObject | undefined, visited = new Set<PDFObject>()): PDFArray | undefined => {
    const resolved = source.context.lookup(value)
    if (!resolved || visited.has(resolved)) return
    visited.add(resolved)
    if (resolved instanceof PDFName || resolved instanceof PDFString || resolved instanceof PDFHexString) {
      return destination(named.get(resolved.decodeText()), visited)
    }
    if (resolved instanceof PDFDict) return destination(resolved.get(PDFName.of('D')), visited)
    if (!(resolved instanceof PDFArray) || resolved.size() < 2) return
    const pageIndex = pageIndexes.get(source.context.lookup(resolved.get(0))!)
    const mode = source.context.lookup(resolved.get(1))
    if (pageIndex === undefined || !selected.has(pageIndex) || !(mode instanceof PDFName) || !destinationModes.has(mode.decodeText())) return
    return resolved
  }
  const copied = indices.map((index) => {
    if (!sourcePages[index]) throw new Error('保存するページが元のPDFにありません。')
    return output.addPage()
  })
  const mapped = new Map<PDFObject, PDFObject>()
  sourcePages.forEach((page) => { mapped.set(page.ref, PDFNull); mapped.set(page.node, PDFNull) })
  indices.forEach((index, position) => {
    // A repeated source page, when supplied by a project, uses its first copy as
    // the unambiguous destination of original in-document navigation.
    if (mapped.get(sourcePages[index].ref) === PDFNull) {
      mapped.set(sourcePages[index].ref, copied[position].ref)
      mapped.set(sourcePages[index].node, copied[position].ref)
    }
  })
  const invalidGoTo = (value: PDFObject) => {
    const resolved = source.context.lookup(value)
    return resolved instanceof PDFDict && resolved.get(PDFName.of('S')) === PDFName.of('GoTo') && !destination(resolved.get(PDFName.of('D')))
  }
  const copy = (value: PDFObject): PDFObject => {
    const prior = mapped.get(value)
    if (prior) return prior
    if (invalidGoTo(value)) return PDFNull
    if (value instanceof PDFRef) {
      const original = source.context.lookup(value)
      if (!original) return PDFNull
      // Do not copy orphan page dictionaries outside the source page tree.
      if (original instanceof PDFDict && original.get(PDFName.of('Type')) === PDFName.of('Page')) return PDFNull
      const ref = output.context.nextRef()
      mapped.set(value, ref)
      output.context.assign(ref, copy(original))
      return ref
    }
    if (value instanceof PDFDict) {
      if (value.get(PDFName.of('Type')) === PDFName.of('Page')) return PDFNull
      const clone = value.clone(output.context)
      mapped.set(value, clone)
      copyEntries(value, clone)
      return clone
    }
    if (value instanceof PDFArray) {
      const clone = value.clone(output.context)
      mapped.set(value, clone)
      for (let index = value.size() - 1; index >= 0; index -= 1) {
        if (invalidGoTo(value.get(index))) clone.remove(index)
        else clone.set(index, copy(value.get(index)))
      }
      return clone
    }
    if (value instanceof PDFStream) {
      const clone = value.clone(output.context)
      mapped.set(value, clone)
      copyEntries(value.dict, clone.dict)
      return clone
    }
    return value.clone(output.context)
  }
  const copyEntries = (original: PDFDict, target: PDFDict, isPage = false) => {
    for (const [key, value] of original.entries()) {
      if (isPage && key === PDFName.of('Parent')) continue
      if (key === PDFName.of('Dest') || (key === PDFName.of('D') && original.get(PDFName.of('S')) === PDFName.of('GoTo'))) {
        const resolved = destination(value)
        if (resolved) target.set(key, copy(resolved))
        else target.delete(key)
      } else if (invalidGoTo(value)) target.delete(key)
      else target.set(key, copy(value))
    }
  }
  indices.forEach((index, position) => {
    const sourcePage = sourcePages[index].node
    const target = copied[position].node
    for (const key of target.keys()) if (key !== PDFName.of('Parent')) target.delete(key)
    copyEntries(sourcePage, target, true)
    // Resources, boxes, and rotation can be inherited from the source /Pages.
    for (const entry of PDFPageLeaf.InheritableEntries) {
      const key = PDFName.of(entry)
      const value = sourcePage.getInheritableAttribute(key)
      if (!sourcePage.has(key) && value) target.set(key, copy(value))
    }
  })
  return copied
}

/**
 * Append whole sources without applying the editor's page order or annotations.
 * Existing source indexes therefore remain valid, including currently hidden pages.
 * All work happens on newly loaded documents; failure leaves every input untouched.
 */
export async function appendPdfSources(
  original: Uint8Array | null,
  additions: { name: string; bytes: Uint8Array }[],
): Promise<{ bytes: Uint8Array; originalPageCount: number; addedPages: { sourceName: string; sourcePage: number }[] }> {
  if (additions.length === 0) throw new Error('結合するPDFを1つ以上選択してください。')
  const maxBytes = 50 * 1024 * 1024
  const sources = [
    ...(original !== null ? [{ name: '編集中のPDF', bytes: original, original: true }] : []),
    ...additions.map((addition) => ({ ...addition, original: false })),
  ]
  let totalBytes = 0
  for (const source of sources) {
    if (source.bytes.byteLength === 0) throw new Error(`「${source.name}」は空のファイルです。内容のあるPDFを選択してください。`)
    totalBytes += source.bytes.byteLength
    if (totalBytes > maxBytes) throw new Error(`「${source.name}」を含めると結合元の合計が50MBを超えます。ファイル数を減らしてお試しください。`)
  }
  const loaded: { name: string; document: PDFDocument }[] = []
  const addedPages: { sourceName: string; sourcePage: number }[] = []
  let originalPageCount = 0
  let totalPages = 0
  for (const source of sources) {
    let document: PDFDocument
    try {
      document = await PDFDocument.load(source.bytes.slice(), { updateMetadata: false, throwOnInvalidObject: true })
    } catch (error) {
      // The package's ES5 Error subclasses do not always preserve instanceof.
      if (error instanceof EncryptedPDFError || (error instanceof Error && error.message.includes('Input document to `PDFDocument.load` is encrypted'))) {
        throw new Error(`「${source.name}」はパスワード付きPDFです。ロックを解除したPDFを選択してください。`)
      }
      throw new Error(`「${source.name}」を開けませんでした。ファイルが壊れていないか、PDF形式か確認してください。`)
    }
    try {
      const pageCount = document.getPageCount()
      if (pageCount === 0) throw new Error('ページがありません。内容のあるPDFを選択してください。')
      totalPages += pageCount
      if (totalPages > 200) throw new Error('結合元の合計が200ページを超えます。ファイル数を減らすか、必要なページだけを別名保存してから結合してください。')
      preparePagesForCopy(document)
      if (source.original) originalPageCount = pageCount
      else {
        for (let index = 0; index < pageCount; index += 1) addedPages.push({ sourceName: source.name, sourcePage: index + 1 })
      }
      loaded.push({ name: source.name, document })
    } catch (error) {
      const reason = error instanceof Error && /[ぁ-んァ-ヶ一-龠]/u.test(error.message)
        ? error.message
        : 'PDFの構造を確認できませんでした。元のアプリからPDFとして印刷して開いてください。'
      throw new Error(`「${source.name}」を結合できません。${reason}`)
    }
  }
  const output = await PDFDocument.create()
  for (const source of loaded) {
    try {
      await copySelectedPages(output, source.document, source.document.getPageIndices())
    } catch {
      throw new Error(`「${source.name}」のページを結合できませんでした。元のアプリからPDFとして印刷して開いてください。`)
    }
  }
  output.setTitle(loaded[0].document.getTitle() || 'LumaStudio PDF')
  output.setCreator('LumaStudio PDF')
  output.setProducer('LumaStudio PDF')
  let bytes: Uint8Array
  try {
    bytes = await output.save()
  } catch {
    throw new Error('結合したPDFを作成できませんでした。ファイル数を減らすか、元のアプリからPDFとして印刷してお試しください。')
  }
  if (bytes.byteLength > maxBytes) throw new Error('結合後のPDFが50MBを超えます。ファイル数を減らしてお試しください。')
  return { bytes, originalPageCount, addedPages }
}

/** Original vector content is retained. Only newly placed elements become images. */
export async function exportPdf(originalBytes: Uint8Array, pages: PageInfo[], annotations: Annotation[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('保存するページがありません。')
  const source = await PDFDocument.load(originalBytes, { updateMetadata: false })
  preparePagesForCopy(source)
  const output = await PDFDocument.create()
  const copied = await copySelectedPages(output, source, pages.map((page) => page.sourceIndex))
  for (let index = 0; index < pages.length; index += 1) {
    const info = pages[index]
    const page = copied[index]
    const transform = info.viewportTransform || fallbackTransform(page)
    const originalRotation = page.getRotation().angle
    for (const item of annotations.filter((annotation) => annotation.pageId === info.id)) {
      // A user can commit new glyphs before the background font load finishes.
      // Resolve their true height before placing the raster on the output PDF.
      const annotation = await resolveTextGeometry(item, info.height)
      const dataUrl = await annotationToDataUrl(annotation)
      const image = /^data:image\/jpe?g[;,]/i.test(dataUrl) ? await output.embedJpg(dataUrl) : await output.embedPng(dataUrl)
      const placement = annotationPlacement(annotation, transform)
      page.drawImage(image, { x: placement.x, y: placement.y, width: placement.width, height: placement.height, rotate: degrees(placement.rotation) })
    }
    page.setRotation(degrees(normalizeRotation(originalRotation + info.rotation)))
  }
  output.setTitle(source.getTitle() || 'LumaStudio PDF')
  output.setCreator('LumaStudio PDF')
  output.setProducer('LumaStudio PDF')
  return output.save()
}

/** A fictional, deliberately blank practice form. No personal information. */
export async function createSamplePdf(): Promise<Uint8Array> {
  if (document.fonts) await document.fonts.ready
  const width = 595.28
  const height = 841.89
  const { canvas, context } = makeCanvas(width, height, 2)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  const text = (value: string, x: number, y: number, size = 11, color = '#303d3a', bold = false) => {
    context.font = `${bold ? 600 : 400} ${size}px ${FONT}`
    context.fillStyle = color
    context.textBaseline = 'top'
    context.fillText(value, x, y)
  }
  const line = (x: number, y: number, x2: number, y2: number, color = '#d8dfdc') => {
    context.strokeStyle = color
    context.lineWidth = 0.75
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x2, y2)
    context.stroke()
  }
  text('SAMPLE DOCUMENT', 48, 42, 9, '#738b80', true)
  text('振込先口座届', 48, 81, 26, '#253f35', true)
  text('お支払い先の情報をご記入のうえ、ご返送ください。', 48, 126, 10, '#64766e')
  text('提出日：　　　　年　　　月　　　日', 323, 176, 10)
  line(48, 207, 547, 207, '#789a88')
  text('01', 48, 231, 10, '#688474', true)
  text('ご請求者情報', 76, 228, 13, '#253f35', true)
  const row = (label: string, y: number, rowHeight = 48) => {
    context.fillStyle = '#f3f6f3'
    context.fillRect(48, y, 117, rowHeight)
    text(label, 62, y + 17, 10)
    line(48, y, 547, y)
    line(48, y + rowHeight, 547, y + rowHeight)
    line(48, y, 48, y + rowHeight)
    line(165, y, 165, y + rowHeight)
    line(547, y, 547, y + rowHeight)
  }
  row('会社名・お名前', 260)
  row('ご住所', 308)
  row('電話番号', 356)
  text('02', 48, 435, 10, '#688474', true)
  text('振込先口座', 76, 432, 13, '#253f35', true)
  row('金融機関・支店', 464)
  row('口座種別', 512)
  text('□  普通　　　□  当座', 187, 528, 12)
  row('口座番号', 560)
  row('口座名義（カナ）', 608)
  text('上記の内容に相違ありません。', 48, 691, 11)
  text('氏名', 264, 718, 10)
  line(294, 746, 466, 746)
  context.strokeStyle = '#d3dcd5'
  context.lineWidth = 0.7
  context.beginPath()
  context.arc(513, 722, 25, 0, Math.PI * 2)
  context.stroke()
  text('印', 508, 717, 10, '#bac7bf')
  line(48, 783, 547, 783)
  text('LumaStudio PDF  /  操作を試すためのサンプルです。', 48, 795, 8, '#9aa7a0')
  text('1 / 1', 522, 795, 8, '#9aa7a0')
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([width, height])
  const image = await pdf.embedPng(canvas.toDataURL('image/png'))
  page.drawImage(image, { x: 0, y: 0, width, height })
  pdf.setTitle('振込先口座届 - サンプル')
  pdf.setCreator('LumaStudio PDF')
  return pdf.save()
}
