import { expect, test } from '@playwright/test'
import { PDFDocument, degrees } from 'pdf-lib'
import { readFile } from 'node:fs/promises'

test('縦書き入力・方向変更・履歴・作業データ・PDF保存を通して向きを維持する', async ({ page }, info) => {
  const source = await PDFDocument.create(); source.addPage([500,700])
  await page.goto('/')
  await page.getByTestId('pdf-input').setInputFiles({ name:'vertical.pdf', mimeType:'application/pdf', buffer:Buffer.from(await source.save()) })
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout:30000 })
  await page.getByRole('button', { name:'文字を記入', exact:true }).click()
  await page.getByLabel('文字の向き', { exact:true }).selectOption('vertical-rl')
  await page.getByTestId('pdf-surface').click({ position:{ x:160, y:190 } })
  const input = page.getByRole('textbox', { name:'PDF上の文字入力', exact:true })
  await expect(input).toHaveCSS('writing-mode','vertical-rl')
  await expect(input).toHaveAttribute('wrap','off')
  await input.fill('「東京」、\nケーキ。A1')
  await input.press('ControlOrMeta+Enter')
  const annotation = page.getByRole('button', { name:'文字: 「東京」、 ケーキ。A1', exact:true })
  await expect(annotation.locator('img')).toHaveAttribute('src', /^data:image\/png/)
  await page.getByRole('button', { name:'下線', exact:true }).click()
  await page.getByLabel('文字の向き', { exact:true }).selectOption('horizontal-tb')
  await page.getByRole('button', { name:'元に戻す', exact:true }).click()
  await annotation.click()
  await expect(page.getByLabel('文字の向き', { exact:true })).toHaveValue('vertical-rl')
  await annotation.dblclick()
  await input.fill('「東京」、\nケーキ。A1\n再編集')
  await input.press('ControlOrMeta+Enter')
  await page.screenshot({ path:info.outputPath('vertical-editor.png'), fullPage:true })
  await page.getByRole('button', { name:'作業データ', exact:true }).click()
  const projectEvent = page.waitForEvent('download')
  await page.getByRole('button', { name:'作業データを保存', exact:true }).click()
  const projectPath = info.outputPath('vertical.lumapdf'); await (await projectEvent).saveAs(projectPath)
  const data = JSON.parse(await readFile(projectPath,'utf8'))
  expect(data.version).toBe(4)
  expect(data.annotations[0]).toMatchObject({ writingMode:'vertical-rl', underline:true, text:'「東京」、\nケーキ。A1\n再編集' })
  expect(data.annotations[0].width).toBeCloseTo(3*11*1.4+4)
  await page.reload()
  await page.getByTestId('project-input').setInputFiles(projectPath)
  await page.getByRole('button', { name:/文字: 「東京」、/ }).click()
  await expect(page.getByLabel('文字の向き', { exact:true })).toHaveValue('vertical-rl')
  const pdfEvent = page.waitForEvent('download')
  await page.getByRole('button', { name:'PDFを保存', exact:true }).click()
  const pdfPath = info.outputPath('vertical.pdf'); await (await pdfEvent).saveAs(pdfPath)
  expect((await PDFDocument.load(await readFile(pdfPath))).getPageCount()).toBe(1)
})

test('縦書きの画面と保存PDFがCropBoxと回転のある用紙でも同じ位置に描かれる', async ({ page }) => {
  await page.goto('/')
  for (const rotation of [0,90,180,270]) {
    const source = await PDFDocument.create(); const sheet = source.addPage([400,500])
    sheet.setCropBox(30,40,300,400); sheet.setRotation(degrees(rotation))
    const results = await page.evaluate(async (original) => {
      const { loadPdf, exportPdf, renderPdfPage, annotationToDataUrl } = await import('/src/lib/pdf.ts')
      const { verticalTextSize } = await import('/src/lib/vertical-text.ts')
      const loaded = await loadPdf(new Uint8Array(original))
      const sheet = loaded.pages[0]
      const annotation = { id:'a', pageId:sheet.id, type:'text', x:70, y:70, ...verticalTextSize('「東京」、\nケーキ。A1',20), text:'「東京」、\nケーキ。A1', fontSize:20, fontFamily:'noto-sans-jp', writingMode:'vertical-rl', underline:true }
      const png = new Image(); png.src = await annotationToDataUrl(annotation); await png.decode()
      const canvas = document.createElement('canvas'); canvas.width = sheet.width*3; canvas.height = sheet.height*3
      const ctx = canvas.getContext('2d')!; ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(png, annotation.x*3,annotation.y*3)
      const expected = ctx.getImageData(0,0,canvas.width,canvas.height).data
      const bytes = await exportPdf(new Uint8Array(original), loaded.pages, [annotation])
      const saved = await loadPdf(bytes); const output = document.createElement('canvas')
      await renderPdfPage(saved.document,0,output,3)
      // renderPdfPage also accounts for devicePixelRatio; normalize onto matching pixels.
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(output,0,0,canvas.width,canvas.height)
      const actual=ctx.getImageData(0,0,canvas.width,canvas.height).data
      let ink=0, mismatch=0
      for(let i=0;i<expected.length;i+=4){ if(expected[i]<180 || actual[i]<180){ink++;if(Math.abs(expected[i]-actual[i])>80)mismatch++} }
      await loaded.document.loadingTask.destroy();await saved.document.loadingTask.destroy()
      return { ink, mismatch }
    }, Array.from(await source.save()))
    expect(results.ink).toBeGreaterThan(1000)
    expect(results.mismatch/results.ink, `rotation ${rotation}`).toBeLessThan(0.06)
  }
})
