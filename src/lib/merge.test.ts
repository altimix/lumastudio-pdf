import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream, degrees } from 'pdf-lib'
import { appendPdfSources, exportPdf } from './pdf'

async function makePdf(sizes: [number, number][] = [[600, 800]]) {
  const document = await PDFDocument.create()
  for (const size of sizes) document.addPage(size)
  return document.save({ addDefaultPage: false })
}

function decodedStreams(document: PDFDocument): string {
  return document.context.enumerateIndirectObjects()
    .flatMap(([, object]) => object instanceof PDFRawStream ? [new TextDecoder().decode(decodePDFRawStream(object).decode())] : [])
    .join('\n')
}

describe('PDF merge', () => {
  it('retains original backing indexes and appends files and pages in the selected order', async () => {
    const source = await PDFDocument.create()
    source.setTitle('Original document')
    source.addPage([100, 200])
    source.addPage([300, 400]).setRotation(degrees(90))
    const first = await PDFDocument.create()
    const cropped = first.addPage([500, 700])
    cropped.setCropBox(40, 50, 400, 600)
    cropped.setRotation(degrees(270))
    cropped.drawText('VECTOR CONTENT', { x: 60, y: 70 })
    first.addPage([800, 400])
    const original = await source.save()
    const untouchedOriginal = original.slice()
    const result = await appendPdfSources(original, [
      { name: 'first.pdf', bytes: await first.save() },
      { name: 'second.pdf', bytes: await makePdf([[250, 350]]) },
    ])
    const output = await PDFDocument.load(result.bytes)
    expect(result.originalPageCount).toBe(2)
    expect(result.addedPages).toEqual([
      { sourceName: 'first.pdf', sourcePage: 1 },
      { sourceName: 'first.pdf', sourcePage: 2 },
      { sourceName: 'second.pdf', sourcePage: 1 },
    ])
    expect(output.getPages().map((page) => page.getSize())).toEqual([
      { width: 100, height: 200 }, { width: 300, height: 400 },
      { width: 500, height: 700 }, { width: 800, height: 400 }, { width: 250, height: 350 },
    ])
    expect(output.getPage(1).getRotation().angle).toBe(90)
    expect(output.getPage(2).getRotation().angle).toBe(270)
    expect(output.getPage(2).getCropBox()).toEqual({ x: 40, y: 50, width: 400, height: 600 })
    expect(decodedStreams(output)).toContain('564543544F5220434F4E54454E54')
    expect(original).toEqual(untouchedOriginal)
    expect(output.getTitle()).toBe('Original document')

    // A page hidden in the editor remains in backing storage and can be restored.
    // The final export uses only the current editor list, so hidden pages stay out.
    const exported = await exportPdf(result.bytes, [
      { id: 'existing-first', sourceIndex: 0, width: 100, height: 200, rotation: 0 },
      { id: 'appended-last', sourceIndex: 4, width: 250, height: 350, rotation: 0 },
    ], [])
    expect((await PDFDocument.load(exported)).getPages().map((page) => page.getWidth())).toEqual([100, 250])
  })

  it('creates a merged document without an existing document', async () => {
    const result = await appendPdfSources(null, [
      { name: 'a.pdf', bytes: await makePdf([[100, 200]]) },
      { name: 'b.pdf', bytes: await makePdf([[300, 400], [500, 600]]) },
    ])
    expect(result.originalPageCount).toBe(0)
    expect(result.addedPages).toHaveLength(3)
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(3)
  })

  it('retains form values as appearances and keeps non-field annotations', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([600, 800])
    const field = source.getForm().createTextField('account')
    field.setText('SAMPLE ACCOUNT')
    field.addToPage(page, { x: 40, y: 600, width: 220, height: 40 })
    page.node.addAnnot(source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 20, 40, 40], Contents: PDFString.of('Keep this note') })))
    const sourceBytes = await source.save()
    const result = await appendPdfSources(sourceBytes, [{ name: 'same-field-name.pdf', bytes: sourceBytes }])
    const output = await PDFDocument.load(result.bytes)
    expect(output.getForm().getFields()).toHaveLength(0)
    expect(decodedStreams(output).match(/53414D504C45204143434F554E54/g)).toHaveLength(2)
    expect(decodedStreams(output)).toContain('/FlatWidget')
    for (const outputPage of output.getPages()) {
      const annotations = outputPage.node.Annots()!
      expect(annotations.size()).toBe(1)
      expect(annotations.lookup(0, PDFDict).lookup(PDFName.of('Contents'), PDFString).decodeText()).toBe('Keep this note')
    }
    expect((await PDFDocument.load(sourceBytes)).getForm().getTextField('account').getText()).toBe('SAMPLE ACCOUNT')
  })

  it('rejects a later signed source without changing earlier inputs or the original', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage()
    page.node.set(PDFName.of('Annots'), source.context.obj([{ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', V: { ByteRange: [0, 100, 200, 30], Contents: PDFHexString.of('abcd') } }]))
    const original = await makePdf()
    const unsigned = await makePdf([[100, 200]])
    const signed = await source.save()
    const snapshots = [original.slice(), unsigned.slice(), signed.slice()]
    await expect(appendPdfSources(original, [{ name: 'unsigned.pdf', bytes: unsigned }, { name: 'signed.pdf', bytes: signed }]))
      .rejects.toThrow('「signed.pdf」を結合できません。電子署名済みPDF')
    expect([original, unsigned, signed]).toEqual(snapshots)
    await expect(appendPdfSources(signed, [{ name: 'unsigned.pdf', bytes: unsigned }]))
      .rejects.toThrow('「編集中のPDF」を結合できません。電子署名済みPDF')
  })

  it('rejects XFA and forms lacking preservable appearances with the source filename', async () => {
    const xfa = await PDFDocument.create()
    xfa.addPage()
    xfa.getForm().acroForm.dict.set(PDFName.of('XFA'), xfa.context.obj(['template', PDFString.of('xfa')]))
    await expect(appendPdfSources(null, [{ name: 'dynamic.pdf', bytes: await xfa.save() }]))
      .rejects.toThrow('「dynamic.pdf」を結合できません。XFAフォーム')
    const missing = await PDFDocument.create()
    const page = missing.addPage()
    const field = missing.getForm().createTextField('broken-appearance')
    field.addToPage(page, { x: 30, y: 30, width: 150, height: 30 })
    field.setText('DO NOT LOSE THIS')
    field.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'))
    await expect(appendPdfSources(null, [{ name: 'unflattenable.pdf', bytes: await missing.save({ updateFieldAppearances: false }) }]))
      .rejects.toThrow('「unflattenable.pdf」を結合できません。このフォームの入力内容を保持して保存できません')
  })

  it('gives an actionable filename for password-protected documents', async () => {
    const encrypted = await PDFDocument.create()
    encrypted.addPage()
    // Encryption marker is sufficient: the parser must reject before reading content.
    encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({ Filter: 'Standard' }))
    await expect(appendPdfSources(null, [{ name: 'locked.pdf', bytes: await encrypted.save() }]))
      .rejects.toThrow('「locked.pdf」はパスワード付きPDFです。ロックを解除')
  })

  it('rejects missing inputs, empty bytes, malformed files, and documents without pages', async () => {
    await expect(appendPdfSources(null, [])).rejects.toThrow('1つ以上選択')
    await expect(appendPdfSources(null, [{ name: 'empty.pdf', bytes: new Uint8Array() }])).rejects.toThrow('「empty.pdf」は空のファイル')
    await expect(appendPdfSources(null, [{ name: 'broken.pdf', bytes: new TextEncoder().encode('not a PDF') }])).rejects.toThrow('「broken.pdf」を開けませんでした')
    await expect(appendPdfSources(null, [{ name: 'zero-pages.pdf', bytes: await makePdf([]) }])).rejects.toThrow('「zero-pages.pdf」を結合できません。ページがありません')
  })

  it('enforces the combined backing page limit before returning a document', async () => {
    const original = await makePdf(Array.from({ length: 199 }, () => [100, 100] as [number, number]))
    const addition = await makePdf([[200, 200]])
    expect((await appendPdfSources(original, [{ name: 'last.pdf', bytes: addition }])).addedPages).toHaveLength(1)
    await expect(appendPdfSources(original, [{ name: 'last.pdf', bytes: addition }, { name: 'over.pdf', bytes: addition }]))
      .rejects.toThrow('「over.pdf」を結合できません。結合元の合計が200ページを超えます')
  })

  it('enforces the combined 50MB input limit before parsing sources', async () => {
    const original = new Uint8Array(25 * 1024 * 1024)
    const addition = new Uint8Array(25 * 1024 * 1024 + 1)
    await expect(appendPdfSources(original, [{ name: 'too-large.pdf', bytes: addition }]))
      .rejects.toThrow('「too-large.pdf」を含めると結合元の合計が50MBを超えます')
  })
})
