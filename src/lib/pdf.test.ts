import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream, degrees } from 'pdf-lib'
import { annotationPlacement, exportPdf, hasDigitalSignature, normalizeRotation, viewportToPdf } from './pdf'
import type { PageInfo } from './types'

describe('PDF coordinates', () => {
  it('converts top-left screen placement into PDF bottom-left placement', () => {
    expect(annotationPlacement({ x: 40, y: 60, width: 80, height: 30 }, [1, 0, 0, -1, 0, 800])).toEqual({ x: 40, y: 710, width: 80, height: 30, rotation: 0 })
  })

  it('accounts for crop offset, 90 degree source rotation, and UserUnit', () => {
    expect(annotationPlacement({ x: 40, y: 60, width: 80, height: 30 }, [0, 2, 2, 0, -40, -20])).toEqual({ x: 55, y: 40, width: 40, height: 15, rotation: 90 })
  })

  it('handles 180 and 270 degree source rotations', () => {
    expect(annotationPlacement({ x: 10, y: 20, width: 30, height: 40 }, [-1, 0, 0, 1, 600, 0])).toEqual({ x: 590, y: 60, width: 30, height: 40, rotation: 180 })
    expect(annotationPlacement({ x: 10, y: 20, width: 30, height: 40 }, [0, -1, -1, 0, 800, 600])).toEqual({ x: 540, y: 790, width: 30, height: 40, rotation: 270 })
  })

  it('refuses non-invertible transforms', () => {
    expect(() => viewportToPdf([0, 0, 0, 0, 0, 0], 10, 10)).toThrow()
    expect(normalizeRotation(-90)).toBe(270)
    expect(normalizeRotation(450)).toBe(90)
  })
})

describe('PDF export', () => {
  it('preserves requested page order, drops deleted pages, and adds rotation', async () => {
    const source = await PDFDocument.create()
    source.addPage([100, 200])
    source.addPage([300, 400])
    source.addPage([500, 600]).setRotation(degrees(90))
    const original = await source.save()
    const pages: PageInfo[] = [
      { id: 'last', sourceIndex: 2, width: 600, height: 500, rotation: 90 },
      { id: 'first', sourceIndex: 0, width: 100, height: 200, rotation: 270 },
    ]
    const bytes = await exportPdf(original, pages, [])
    const output = await PDFDocument.load(bytes)
    expect(output.getPageCount()).toBe(2)
    expect(output.getPage(0).getSize()).toEqual({ width: 500, height: 600 })
    expect(output.getPage(0).getRotation().angle).toBe(180)
    expect(output.getPage(1).getSize()).toEqual({ width: 100, height: 200 })
    expect(output.getPage(1).getRotation().angle).toBe(270)
    expect((await PDFDocument.load(original)).getPageCount()).toBe(3)
  })

  it('retains CropBox coordinates in copied pages', async () => {
    const source = await PDFDocument.create()
    source.addPage([600, 800]).setCropBox(40, 50, 400, 600)
    const bytes = await exportPdf(await source.save(), [{ id: 'one', sourceIndex: 0, width: 400, height: 600, rotation: 0 }], [])
    const output = await PDFDocument.load(bytes)
    expect(output.getPage(0).getCropBox()).toEqual({ x: 40, y: 50, width: 400, height: 600 })
  })

  it('paints original form values into page content before copying', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([600, 800])
    const field = source.getForm().createTextField('existing-account-name')
    field.setText('SAMPLE ACCOUNT')
    field.addToPage(page, { x: 40, y: 600, width: 200, height: 40 })
    const bytes = await exportPdf(await source.save(), [{ id: 'one', sourceIndex: 0, width: 600, height: 800, rotation: 0 }], [])
    const output = await PDFDocument.load(bytes)
    expect(output.getForm().getFields()).toHaveLength(0)
    const streams = output.getPage(0).node.Contents() as PDFArray
    const content = Array.from({ length: streams.size() }, (_, index) => new TextDecoder().decode(decodePDFRawStream(streams.lookup(index, PDFRawStream)).decode())).join('\n')
    expect(content).toContain('/FlatWidget')
    expect(content).toContain(' Do')
    expect(output.getPage(0).node.Annots()?.size() ?? 0).toBe(0)
  })

  it('embeds an addition with transformed position and orientation on a rotated crop', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([600, 800])
    page.setCropBox(10, 20, 400, 600)
    page.setRotation(degrees(90))
    const bytes = await exportPdf(await source.save(), [{ id: 'one', sourceIndex: 0, width: 600, height: 400, rotation: 0 }], [{
      id: 'image', pageId: 'one', type: 'image', x: 40, y: 60, width: 80, height: 30,
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPIYAAAAASUVORK5CYII=',
    }])
    const output = await PDFDocument.load(bytes)
    const streams = output.getPage(0).node.Contents() as PDFArray
    const content = Array.from({ length: streams.size() }, (_, index) => new TextDecoder().decode(decodePDFRawStream(streams.lookup(index, PDFRawStream)).decode())).join('\n')
    expect(content).toContain('1 0 0 1 100 60 cm')
    expect(content).toContain('80 0 0 30 0 0 cm')
    expect(content).toContain(' Do')
    expect(output.getPage(0).getRotation().angle).toBe(90)
  })

  it('refuses an empty document', async () => {
    await expect(exportPdf(new Uint8Array(), [], [])).rejects.toThrow('保存するページがありません')
  })

  it('refuses to rewrite a PDF containing a populated cryptographic signature field', async () => {
    const source = await PDFDocument.create()
    source.addPage([600, 800])
    const signature = source.context.register(source.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 120, 256, 42], Contents: PDFHexString.of('01020304') }))
    const field = source.context.register(source.context.obj({ FT: 'Sig', T: PDFString.of('Signer'), V: signature }))
    source.catalog.set(PDFName.of('AcroForm'), source.context.obj({ Fields: [field] }))
    const bytes = await source.save()
    expect(hasDigitalSignature(await PDFDocument.load(bytes))).toBe(true)
    await expect(exportPdf(bytes, [{ id: 'one', sourceIndex: 0, width: 600, height: 800, rotation: 0 }], [])).rejects.toThrow('電子署名済みPDFは署名を保持して再保存できません')
    expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(1)
  })

  it('detects an orphan signature dictionary even if it is absent from the form tree', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([600, 800])
    // Direct nested dictionary, intentionally without canonical AcroForm fields.
    page.node.set(PDFName.of('Annots'), source.context.obj([{ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', V: { ByteRange: [0, 100, 200, 30], Contents: PDFHexString.of('abcd') } }]))
    const bytes = await source.save()
    expect(hasDigitalSignature(await PDFDocument.load(bytes))).toBe(true)
    await expect(exportPdf(bytes, [{ id: 'one', sourceIndex: 0, width: 600, height: 800, rotation: 0 }], [])).rejects.toThrow('署名前の原本を使用してください')
  })

  it('detects a non-empty signature value without requiring ByteRange, but permits an empty slot', async () => {
    const source = await PDFDocument.create()
    source.addPage()
    const dictionary = source.context.obj({ FT: 'Sig', T: PDFString.of('EmptySignature') })
    const field = source.context.register(dictionary)
    source.catalog.set(PDFName.of('AcroForm'), source.context.obj({ Fields: [field] }))
    expect(hasDigitalSignature(source)).toBe(false)
    dictionary.set(PDFName.of('V'), PDFHexString.of(''))
    expect(hasDigitalSignature(source)).toBe(false)
    dictionary.set(PDFName.of('V'), source.context.obj({ Contents: PDFHexString.of('1234') }))
    expect(hasDigitalSignature(source)).toBe(true)
  })
})
