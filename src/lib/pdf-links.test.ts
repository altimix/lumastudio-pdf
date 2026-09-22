import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, decodePDFRawStream, degrees } from 'pdf-lib'
import { appendPdfSources, exportPdf } from './pdf'
import type { PageInfo } from './types'

const PRIVATE = 'DELETED PRIVATE BANK DETAILS'
const KEEP = 'RETAINED PAGE CONTENT'
const key = PDFName.of

async function linkedFixture() {
  const source = await PDFDocument.create()
  const [first, deleted, retained] = [0, 1, 2].map(() => source.addPage([400, 600]))
  first.drawText('FIRST PAGE')
  deleted.drawText(PRIVATE)
  retained.drawText(KEEP)
  retained.setRotation(degrees(90))
  const toKeep = source.context.obj([retained.ref, 'Fit'])
  const toDelete = source.context.obj([deleted.ref, 'Fit'])
  source.catalog.set(key('Names'), source.context.obj({ Dests: { Kids: [source.context.register(source.context.obj({
    Names: [PDFString.of('keep'), source.context.register(source.context.obj({ D: toKeep })), PDFHexString.fromText('delete'), toDelete],
  }))] } }))
  source.catalog.set(key('Dests'), source.context.obj({ LegacyKeep: toKeep }))
  const link = (extra: Record<string, unknown>) => source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 100, 20], ...extra } as Parameters<typeof source.context.obj>[0]))
  first.node.set(key('Annots'), source.context.obj([
    link({ Dest: toKeep }),
    link({ Dest: toDelete }),
    link({ A: { S: 'GoTo', D: toKeep } }),
    link({ A: source.context.register(source.context.obj({ S: 'GoTo', D: toDelete })) }),
    link({ Dest: PDFString.of('keep') }),
    link({ A: { S: 'GoTo', D: PDFHexString.fromText('delete') } }),
    link({ Dest: key('LegacyKeep') }),
    link({ A: { S: 'URI', URI: PDFString.of('https://example.org/kept') } }),
    source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10], P: first.ref, Contents: PDFString.of('Keep this comment') })),
    link({ A: { S: 'URI', URI: PDFString.of('https://example.org/next'), Next: [{ S: 'GoTo', D: toDelete }, { S: 'GoTo', D: toKeep }] } }),
  ]))
  return source.save()
}

function info(sourceIndex: number, rotation = 0): PageInfo {
  return { id: `page-${sourceIndex}`, sourceIndex, width: 400, height: 600, rotation }
}

function objectsText(document: PDFDocument) {
  return document.context.enumerateIndirectObjects().map(([, object]) => object instanceof PDFRawStream
    ? new TextDecoder().decode(decodePDFRawStream(object).decode())
    : object.toString()).join('\n')
}

function pageObjects(document: PDFDocument) {
  return document.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFDict && object.get(key('Type')) === key('Page'))
}

function annotations(document: PDFDocument, index: number) {
  return document.getPage(index).node.Annots()!.asArray().map(ref => document.context.lookup(ref, PDFDict))
}

function destinationRef(document: PDFDocument, annotation: PDFDict) {
  const action = document.context.lookup(annotation.get(key('A')))
  const value = annotation.get(key('Dest')) ?? (action instanceof PDFDict ? action.get(key('D')) : undefined)
  return document.context.lookup(value, PDFArray).get(0)
}

describe('PDF page copying with internal navigation', () => {
  it('removes deleted page content, repairs retained links, and keeps URI links and comments', async () => {
    const original = await linkedFixture()
    const snapshot = original.slice()
    const output = await PDFDocument.load(await exportPdf(original, [info(2, 90), info(0)], []))
    expect(output.getPageCount()).toBe(2)
    expect(pageObjects(output)).toHaveLength(2)
    const text = objectsText(output)
    expect(text).not.toContain(Buffer.from(PRIVATE).toString('hex').toUpperCase())
    expect(text).not.toContain(PRIVATE)
    expect(text).toContain(Buffer.from(KEEP).toString('hex').toUpperCase())
    expect(output.getPage(0).getRotation().angle).toBe(180)
    const links = annotations(output, 1)
    for (const index of [0, 2, 4, 6]) expect(destinationRef(output, links[index])).toBe(output.getPage(0).ref)
    for (const index of [1, 3, 5]) {
      expect(links[index].has(key('Dest'))).toBe(false)
      expect(links[index].has(key('A'))).toBe(false)
    }
    const uri = output.context.lookup(links[7].get(key('A')), PDFDict)
    expect(uri.lookup(key('URI'), PDFString).decodeText()).toBe('https://example.org/kept')
    expect(links[8].get(key('P'))).toBe(output.getPage(1).ref)
    expect(links[8].lookup(key('Contents'), PDFString).decodeText()).toBe('Keep this comment')
    const chained = links[9].lookup(key('A'), PDFDict).lookup(key('Next'), PDFArray)
    expect(chained.size()).toBe(1)
    expect(chained.lookup(0, PDFDict).lookup(key('D'), PDFArray).get(0)).toBe(output.getPage(0).ref)
    expect(original).toEqual(snapshot)
  })

  it('single-page extraction cannot carry content from either excluded linked page', async () => {
    const output = await PDFDocument.load(await exportPdf(await linkedFixture(), [info(0)], []))
    expect(output.getPageCount()).toBe(1)
    expect(pageObjects(output)).toHaveLength(1)
    const text = objectsText(output)
    for (const secret of [PRIVATE, KEEP]) expect(text).not.toContain(Buffer.from(secret).toString('hex').toUpperCase())
    const links = annotations(output, 0)
    expect(links[8].get(key('P'))).toBe(output.getPage(0).ref)
    expect(links[7].lookup(key('A'), PDFDict).get(key('S'))).toBe(key('URI'))
  })

  it('merge keeps destinations within their own source and never creates orphan page copies', async () => {
    const original = await linkedFixture()
    const merged = await appendPdfSources(original, [{ name: 'second.pdf', bytes: original }])
    const output = await PDFDocument.load(merged.bytes)
    expect(output.getPageCount()).toBe(6)
    expect(pageObjects(output)).toHaveLength(6)
    expect(destinationRef(output, annotations(output, 0)[0])).toBe(output.getPage(2).ref)
    expect(destinationRef(output, annotations(output, 3)[0])).toBe(output.getPage(5).ref)
    expect(annotations(output, 3)[8].get(key('P'))).toBe(output.getPage(3).ref)
    // A later deletion still removes linked data from the merged backing PDF.
    const extracted = await PDFDocument.load(await exportPdf(merged.bytes, [info(0), info(3)], []))
    expect(pageObjects(extracted)).toHaveLength(2)
    expect(objectsText(extracted)).not.toContain(Buffer.from(PRIVATE).toString('hex').toUpperCase())
  })

  it('drops unresolved, circular, and unsupported internal destinations without losing other annotations', async () => {
    const source = await PDFDocument.create()
    const page = source.addPage([300, 500])
    source.catalog.set(key('Dests'), source.context.obj({ Loop: key('Loop') }))
    page.node.set(key('Annots'), source.context.obj([
      { Type: 'Annot', Subtype: 'Link', Dest: key('Loop') },
      { Type: 'Annot', Subtype: 'Link', A: { S: 'GoTo', D: PDFString.of('missing') } },
      { Type: 'Annot', Subtype: 'Link', Dest: [page.ref, 'UnsupportedMode'] },
      { Type: 'Annot', Subtype: 'Text', P: page.ref, Contents: PDFString.of('Keep note') },
    ]))
    const output = await PDFDocument.load(await exportPdf(await source.save(), [info(0)], []))
    const result = annotations(output, 0)
    expect(result).toHaveLength(4)
    for (const item of result.slice(0, 3)) {
      expect(item.has(key('Dest'))).toBe(false)
      expect(item.has(key('A'))).toBe(false)
    }
    expect(result[3].get(key('P'))).toBeInstanceOf(PDFRef)
    expect(result[3].get(key('P'))).toBe(output.getPage(0).ref)
    expect(pageObjects(output)).toHaveLength(1)
  })
})
