import type { Annotation, PageInfo } from './types'

/** A portable editing document. Account settings and reusable stamp libraries are not included. */
export interface PdfProject {
  filename: string
  original: Uint8Array
  pages: PageInfo[]
  annotations: Annotation[]
}

const MAX_PROJECT_BYTES = 100 * 1024 * 1024
const MAX_PDF_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const ROTATIONS = new Set([0, 90, 180, 270])

function fail(message: string): never {
  throw new Error(`作業ファイルを読み書きできません。${message}`)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label}の形式が不正です。`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0) || value.length > maximum || value.includes('\0')) {
    fail(`${label}が不正です。${maximum}文字以内で指定してください。`)
  }
  return value
}

function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label}の数値が不正です。`)
  return value
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  const result = finite(value, label, minimum, maximum)
  if (!Number.isInteger(result)) fail(`${label}は整数で指定してください。`)
  return result
}

function rotation(value: unknown, label: string): number {
  if (typeof value !== 'number' || !ROTATIONS.has(value)) fail(`${label}は0・90・180・270度で指定してください。`)
  return value
}

function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  // Chunks are a multiple of three, so only the final chunk may contain padding.
  for (let offset = 0; offset < bytes.length; offset += 24_576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))))
  }
  return parts.join('')
}

function decodeBase64(value: unknown, maximum: number, label: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(maximum / 3) * 4) fail(`${label}が空か、容量の上限を超えています。`)
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) fail(`${label}のBase64形式が不正です。`)
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const length = value.length / 4 * 3 - padding
  if (length > maximum) fail(`${label}の容量が上限を超えています。`)
  // Reject noncanonical encodings with nonzero unused bits.
  if (padding && (BASE64_ALPHABET.indexOf(value[value.length - padding - 1]) & (padding === 2 ? 15 : 3)) !== 0) {
    fail(`${label}のBase64形式が不正です。`)
  }
  let binary: string
  try { binary = atob(value) } catch { fail(`${label}のBase64形式が不正です。`) }
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function validatePdf(bytes: unknown): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_PDF_BYTES) fail('元のPDFは50MB以下である必要があります。')
  const header = String.fromCharCode(...bytes.subarray(0, 9))
  if (!/^%PDF-(?:1\.[0-9]|2\.0)(?:[\r\n\t ]|$)/u.test(header)) fail('元のPDFのヘッダーが不正です。')
  return bytes
}

function validateImage(value: unknown): string {
  if (typeof value !== 'string') fail('画像の形式が不正です。')
  const comma = value.indexOf(',')
  const prefix = value.slice(0, comma)
  if (prefix !== 'data:image/png;base64' && prefix !== 'data:image/jpeg;base64') fail('画像はPNGまたはJPEGの埋め込み画像だけに対応しています。')
  const bytes = decodeBase64(value.slice(comma + 1), MAX_IMAGE_BYTES, '画像（2MBまで）')
  if (prefix === 'data:image/png;base64') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte) || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') {
      fail('PNG画像のヘッダーが不正です。')
    }
    const dimensions = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (dimensions.getUint32(16) === 0 || dimensions.getUint32(20) === 0) fail('PNG画像の大きさが不正です。')
  } else if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) {
    fail('JPEG画像のヘッダーが不正です。')
  }
  return value
}

/** Returns new, allow-listed objects; never spreads untrusted metadata into application state. */
function validateProject(value: unknown): PdfProject {
  const raw = object(value, '作業ファイル')
  const filename = string(raw.filename, 'PDFのファイル名', 512)
  const original = validatePdf(raw.original)
  if (!Array.isArray(raw.pages) || raw.pages.length < 1 || raw.pages.length > 200) fail('ページ数は1～200ページにしてください。')
  if (!Array.isArray(raw.annotations) || raw.annotations.length > 2000) fail('記入・印鑑・画像は合計2000個まで保存できます。')
  const pageIds = new Set<string>()
  const pages = raw.pages.map((entry, index): PageInfo => {
    const page = object(entry, `${index + 1}ページ目`)
    const id = string(page.id, 'ページID', 128)
    if (pageIds.has(id)) fail('ページIDが重複しています。')
    pageIds.add(id)
    const width = finite(page.width, 'ページの幅', Number.MIN_VALUE, 14_400)
    const height = finite(page.height, 'ページの高さ', Number.MIN_VALUE, 14_400)
    if (!Array.isArray(page.viewportTransform) || page.viewportTransform.length !== 6) fail('ページの座標変換には6個の数値が必要です。')
    const viewportTransform = page.viewportTransform.map((number: unknown) => finite(number, 'ページの座標変換', -Number.MAX_VALUE, Number.MAX_VALUE))
    const determinant = viewportTransform[0] * viewportTransform[3] - viewportTransform[1] * viewportTransform[2]
    if (!Number.isFinite(determinant) || determinant === 0) fail('ページの座標変換が不正です。')
    const result: PageInfo = {
      id,
      sourceIndex: integer(page.sourceIndex, '元のPDFのページ番号', 0, 199),
      width, height,
      rotation: rotation(page.rotation, 'ページの回転'),
      viewportTransform,
    }
    if (page.sourceName !== undefined) result.sourceName = string(page.sourceName, '結合元のファイル名', 512)
    if (page.sourcePage !== undefined) result.sourcePage = integer(page.sourcePage, '結合元のページ番号', 1, 200)
    if (page.originalRotation !== undefined) result.originalRotation = rotation(page.originalRotation, '元のページの回転')
    return result
  })
  const pagesById = new Map(pages.map(page => [page.id, page]))
  const annotationIds = new Set<string>()
  let contentSize = Math.ceil(original.byteLength / 3) * 4
  const annotations = raw.annotations.map((entry, index): Annotation => {
    const annotation = object(entry, `${index + 1}個目の記入`)
    const id = string(annotation.id, '記入のID', 128)
    if (annotationIds.has(id)) fail('記入のIDが重複しています。')
    annotationIds.add(id)
    const pageId = string(annotation.pageId, '記入先のページID', 128)
    const page = pagesById.get(pageId)
    if (!page) fail('記入先のページがありません。')
    const type = annotation.type
    if (type !== 'text' && type !== 'stamp' && type !== 'image' && type !== 'check') fail('記入の種類が不正です。')
    const x = finite(annotation.x, '記入の横位置', 0, page.width)
    const y = finite(annotation.y, '記入の縦位置', 0, page.height)
    const width = finite(annotation.width, '記入の幅', Number.MIN_VALUE, page.width)
    const height = finite(annotation.height, '記入の高さ', Number.MIN_VALUE, page.height)
    if (x + width > page.width + 0.000001 || y + height > page.height + 0.000001) fail('記入がページの範囲を超えています。')
    const result: Annotation = { id, pageId, type, x, y, width, height }
    if (annotation.text !== undefined) result.text = string(annotation.text, '記入する文字', 3000, true)
    if (annotation.fontSize !== undefined) result.fontSize = finite(annotation.fontSize, '文字サイズ', 6, 96)
    if (annotation.color !== undefined) {
      if (typeof annotation.color !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(annotation.color)) fail('記入の色は16進数の色指定にしてください。')
      result.color = annotation.color
    }
    if (annotation.stampShape !== undefined) {
      if (annotation.stampShape !== 'circle' && annotation.stampShape !== 'square') fail('印鑑の形が不正です。')
      result.stampShape = annotation.stampShape
    }
    if (type === 'image' || annotation.dataUrl !== undefined) {
      result.dataUrl = validateImage(annotation.dataUrl)
      contentSize += result.dataUrl.length
    }
    contentSize += (result.text?.length ?? 0) * 3
    if (contentSize > MAX_PROJECT_BYTES) fail('作業ファイルは100MBまで保存できます。画像を減らしてください。')
    return result
  })
  return { filename, original, pages, annotations }
}

export function encodeProject(project: PdfProject): Uint8Array {
  const clean = validateProject(project)
  const serialized = JSON.stringify({
    app: 'LumaStudio PDF', version: 1,
    filename: clean.filename,
    original: encodeBase64(clean.original),
    pages: clean.pages,
    annotations: clean.annotations,
  })
  const bytes = new TextEncoder().encode(serialized)
  if (bytes.byteLength > MAX_PROJECT_BYTES) fail('作業ファイルは100MBまで保存できます。画像を減らしてください。')
  return bytes
}

export function decodeProject(bytes: Uint8Array): PdfProject {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_PROJECT_BYTES) fail('作業ファイルは空でなく、100MB以下である必要があります。')
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { fail('作業ファイルの文字形式またはJSON形式が不正です。') }
  const raw = object(parsed, '作業ファイル')
  if (raw.app !== 'LumaStudio PDF') fail('LumaStudio PDFの作業ファイルを選択してください。')
  if (raw.version !== 1) fail('この作業ファイルのバージョンには対応していません。')
  return validateProject({
    filename: raw.filename,
    original: decodeBase64(raw.original, MAX_PDF_BYTES, '元のPDF（50MBまで）'),
    pages: raw.pages,
    annotations: raw.annotations,
  })
}
