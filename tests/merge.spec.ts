import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib';

type Fixture = { name: string; mimeType: string; buffer: Buffer };

async function fixture(name: string, widths: number[]): Promise<Fixture> {
  const document = await PDFDocument.create();
  for (const [index, width] of widths.entries()) {
    const page = document.addPage([width, 600]);
    page.drawText(`${name.toUpperCase()} PAGE ${index + 1}`, { x: 35, y: 540, size: 20 });
  }
  return { name: `${name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) };
}

async function expectPages(page: Page, count: number) {
  await expect(page.locator('.thumbnail-button')).toHaveCount(count, { timeout: 30_000 });
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled();
}

async function chooseMerge(page: Page, files: Fixture[]) {
  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'PDFを結合', exact: true }).click();
  await (await fileChooser).setFiles(files);
  const dialog = page.getByRole('dialog', { name: 'PDFを結合', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function merge(page: Page, files: Fixture[]) {
  const dialog = await chooseMerge(page, files);
  await dialog.getByRole('button', { name: 'この順序で結合', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

async function saveAndRead(page: Page, testInfo: TestInfo, name: string) {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const file = testInfo.outputPath(name);
  await (await downloaded).saveAs(file);
  return PDFDocument.load(await readFile(file));
}

function expectSourceLabels(document: PDFDocument, labels: string[]) {
  expect(document.getPageCount()).toBe(labels.length);
  document.getPages().forEach((sheet, index) => {
    const contents = sheet.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    const operators = streams.map(stream => Buffer.from(decodePDFRawStream(document.context.lookup(stream, PDFRawStream)).decode()).toString()).join('\n');
    // The synthetic originals contain unique text, so matching page dimensions alone
    // cannot hide blank output or copies of the wrong source page.
    expect(operators.toUpperCase()).toContain(Buffer.from(labels[index]).toString('hex').toUpperCase());
  });
}

async function addText(page: Page, value: string) {
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('記入する文字').fill(value);
  await page.getByTestId('pdf-surface').click({ position: { x: 85, y: 140 } });
  await expect(page.getByRole('button', { name: `文字: ${value}`, exact: true })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  // These flows contain synthetic local PDFs only and must not call the live AI service.
  await context.route('**/api/autofill', route => route.abort());
  await context.route('https://api.openai.com/**', route => route.abort());
});

test('編集中のPDFに結合し、別ページを右クリック削除して履歴と記入を維持して保存できる', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const a = await fixture('document-a', [400, 410, 420]);
  const b = await fixture('document-b', [500, 510]);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(a);
  await expectPages(page, 3);
  await page.getByRole('button', { name: '2ページ目', exact: true }).click();
  await addText(page, '結合前の記入');
  await merge(page, [b]);
  await expectPages(page, 5);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expectPages(page, 3);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expectPages(page, 5);
  await page.getByRole('button', { name: '2ページ目', exact: true }).click();
  await page.getByRole('button', { name: '文字: 結合前の記入', exact: true }).click();
  await page.getByRole('textbox', { name: '内容', exact: true }).fill('結合後も編集できる');
  const annotation = page.getByRole('button', { name: '文字: 結合後も編集できる', exact: true });
  await expect(annotation).toBeVisible();
  const targetPageId = await page.getByRole('button', { name: '2ページ目', exact: true }).getAttribute('data-page-id');
  await page.getByRole('button', { name: '1ページ目', exact: true }).click();
  let confirmations = 0;
  page.on('dialog', async dialog => { confirmations++; await dialog.dismiss(); });
  await page.getByRole('button', { name: '2ページ目', exact: true }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'ページの操作', exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'このページを削除', exact: true }).click();
  await expectPages(page, 4);
  await expect(page.locator(`.thumbnail-button[data-page-id="${targetPageId}"]`)).toHaveCount(0);
  await expect(page.locator('.edited-dot')).toHaveCount(0);
  expect(confirmations).toBe(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expectPages(page, 5);
  await page.getByRole('button', { name: '2ページ目', exact: true }).click();
  await expect(annotation).toBeVisible();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expectPages(page, 4);
  const deleted = await saveAndRead(page, testInfo, 'merged-page-deleted.pdf');
  expect(deleted.getPages().map(sheet => sheet.getWidth())).toEqual([400, 420, 500, 510]);
  expectSourceLabels(deleted, ['DOCUMENT-A PAGE 1', 'DOCUMENT-A PAGE 3', 'DOCUMENT-B PAGE 1', 'DOCUMENT-B PAGE 2']);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expectPages(page, 5);
  const restored = await saveAndRead(page, testInfo, 'merged-annotation-restored.pdf');
  expect(restored.getPages().map(sheet => sheet.getWidth())).toEqual([400, 410, 420, 500, 510]);
  expectSourceLabels(restored, ['DOCUMENT-A PAGE 1', 'DOCUMENT-A PAGE 2', 'DOCUMENT-A PAGE 3', 'DOCUMENT-B PAGE 1', 'DOCUMENT-B PAGE 2']);
  const images = restored.getPage(1).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  expect(images?.entries().length).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('merged-pages.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('複数PDFのファイル順をドラッグとキーボードで変更して保存できる', async ({ page }, testInfo) => {
  const a = await fixture('first', [400, 410]);
  const b = await fixture('second', [500]);
  await page.goto('/');
  const dialog = await chooseMerge(page, [a, b]);
  const first = dialog.locator('[data-merge-file-id]').filter({ hasText: 'first.pdf' });
  const second = dialog.locator('[data-merge-file-id]').filter({ hasText: 'second.pdf' });
  const filenames = dialog.locator('[data-merge-file-id] strong');
  await expect(first).toHaveAttribute('draggable', 'true');
  await second.dragTo(first, { sourcePosition: { x: 30, y: 20 }, targetPosition: { x: 30, y: 5 } });
  await expect(filenames).toHaveText(['second.pdf', 'first.pdf']);
  // The existing keyboard alternative must still work after dragging.
  await dialog.getByRole('button', { name: '2番目の「first.pdf」を上へ移動', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(filenames).toHaveText(['first.pdf', 'second.pdf']);
  const secondBox = await second.boundingBox();
  if (!secondBox) throw new Error('The second PDF row is not visible');
  await first.dragTo(second, { sourcePosition: { x: 30, y: 20 }, targetPosition: { x: 30, y: secondBox.height - 5 } });
  await expect(filenames).toHaveText(['second.pdf', 'first.pdf']);
  await dialog.getByRole('button', { name: 'この順序で結合', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expectPages(page, 3);
  const result = await saveAndRead(page, testInfo, 'reordered-merge.pdf');
  expect(result.getPages().map(sheet => sheet.getWidth())).toEqual([500, 400, 410]);
  expectSourceLabels(result, ['SECOND PAGE 1', 'FIRST PAGE 1', 'FIRST PAGE 2']);
});

test('ページをドラッグして上下に並べ替え、記入を保ったまま保存し、元に戻せる', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(await fixture('drag-pages', [400, 410, 420]));
  await expectPages(page, 3);
  await page.getByRole('button', { name: '2ページ目', exact: true }).click();
  await addText(page, 'ページと一緒に移動');
  const originalIds = await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')));
  const moved = page.locator(`.thumbnail-button[data-page-id="${originalIds[1]}"]`);
  const firstEntry = page.locator(`[data-page-entry="${originalIds[0]}"]`);
  const lastEntry = page.locator(`[data-page-entry="${originalIds[2]}"]`);
  await expect(moved).toHaveAttribute('draggable', 'true');
  await moved.dragTo(firstEntry, { targetPosition: { x: 45, y: 5 } });
  await expect(page.locator('.thumbnail-button').first()).toHaveAttribute('data-page-id', originalIds[1]!);
  await expect(moved).toHaveAttribute('aria-label', '1ページ目');
  await expect(page.getByRole('button', { name: '文字: ページと一緒に移動', exact: true })).toBeVisible();
  const lastBox = await lastEntry.boundingBox();
  if (!lastBox) throw new Error('The last thumbnail is not visible');
  await moved.dragTo(lastEntry, { targetPosition: { x: 45, y: lastBox.height - 5 } });
  await expect(page.locator('.thumbnail-button').last()).toHaveAttribute('data-page-id', originalIds[1]!);
  await expect(moved).toHaveAttribute('aria-label', '3ページ目');
  await expect(page.getByRole('button', { name: '文字: ページと一緒に移動', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('drag-reordered-pages.png'), fullPage: true });
  const reordered = await saveAndRead(page, testInfo, 'drag-reordered.pdf');
  expect(reordered.getPages().map(sheet => sheet.getWidth())).toEqual([400, 420, 410]);
  expectSourceLabels(reordered, ['DRAG-PAGES PAGE 1', 'DRAG-PAGES PAGE 3', 'DRAG-PAGES PAGE 2']);
  expect(reordered.getPage(2).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict).entries().length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.thumbnail-button').first()).toHaveAttribute('data-page-id', originalIds[1]!);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(moved).toHaveAttribute('aria-label', '2ページ目');
  expect(await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')))).toEqual(originalIds);
  await expect(page.getByRole('button', { name: '文字: ページと一緒に移動', exact: true })).toBeVisible();
  const restored = await saveAndRead(page, testInfo, 'drag-order-restored.pdf');
  expect(restored.getPages().map(sheet => sheet.getWidth())).toEqual([400, 410, 420]);
  expectSourceLabels(restored, ['DRAG-PAGES PAGE 1', 'DRAG-PAGES PAGE 2', 'DRAG-PAGES PAGE 3']);
  expect(restored.getPage(1).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict).entries().length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('並べ替えた指定ページだけを右クリックからPDF保存しても編集状態が残る', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(await fixture('single-page', [400, 410, 420]));
  await expectPages(page, 3);
  await page.getByRole('button', { name: '2ページ目', exact: true }).click();
  await addText(page, '指定ページへの記入');
  const originalIds = await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')));
  const annotatedPage = page.locator(`.thumbnail-button[data-page-id="${originalIds[1]}"]`);
  await annotatedPage.dragTo(page.locator(`[data-page-entry="${originalIds[0]}"]`), { targetPosition: { x: 45, y: 5 } });
  await expect(annotatedPage).toHaveAttribute('aria-label', '1ページ目');
  const orderBeforeExport = await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')));
  await expect(page.locator('.unsaved')).toHaveCount(1);
  await page.getByRole('button', { name: '3ページ目', exact: true }).click();
  await annotatedPage.click({ button: 'right' });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('menu', { name: 'ページの操作', exact: true }).getByRole('menuitem', { name: 'このページをPDF保存', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('single-page_1ページ.pdf');
  const file = testInfo.outputPath('one-page-with-annotation.pdf');
  await download.saveAs(file);
  const extracted = await PDFDocument.load(await readFile(file));
  expect(extracted.getPages().map(sheet => sheet.getWidth())).toEqual([410]);
  expectSourceLabels(extracted, ['SINGLE-PAGE PAGE 2']);
  expect(extracted.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict).entries().length).toBeGreaterThan(0);
  await expectPages(page, 3);
  expect(await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')))).toEqual(orderBeforeExport);
  await expect(page.locator('.unsaved')).toHaveCount(1);
  await page.getByRole('button', { name: '文字: 指定ページへの記入', exact: true }).click();
  await page.getByRole('textbox', { name: '内容', exact: true }).fill('ページ書き出し後も編集できる');
  await expect(page.getByRole('button', { name: '文字: ページ書き出し後も編集できる', exact: true })).toBeVisible();
});

test('結合を戻して別PDFを結合しても不要なページが混ざらず、不正なPDFで部分的に結合されない', async ({ page }, testInfo) => {
  const a = await fixture('base', [400]);
  const b = await fixture('discarded', [500, 510]);
  const c = await fixture('replacement', [600]);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(a);
  await expectPages(page, 1);
  await page.getByRole('button', { name: '1ページ目', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'このページを削除', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await merge(page, [b]);
  await expectPages(page, 3);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expectPages(page, 1);
  await merge(page, [c]);
  await expectPages(page, 2);
  await expect(page.getByRole('button', { name: 'やり直す', exact: true })).toBeDisabled();
  const beforeIds = await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')));
  const dialog = await chooseMerge(page, [b, { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('This is not a PDF') }]);
  await dialog.getByRole('button', { name: 'この順序で結合', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.thumbnail-button')).toHaveCount(2);
  expect(await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')))).toEqual(beforeIds);
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  const result = await saveAndRead(page, testInfo, 'merge-after-undo.pdf');
  expect(result.getPages().map(sheet => sheet.getWidth())).toEqual([400, 600]);
  expectSourceLabels(result, ['BASE PAGE 1', 'REPLACEMENT PAGE 1']);
});

test('署名付きPDFでは結合とページ削除を無効にする', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 600]).drawText('SIGNED SOURCE ONE');
  pdf.addPage([410, 600]).drawText('SIGNED SOURCE TWO');
  const value = pdf.context.register(pdf.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', ByteRange: [0, 100, 200, 30], Contents: PDFHexString.of('010203') }));
  const field = pdf.context.register(pdf.context.obj({ FT: 'Sig', T: PDFString.of('TestSignature'), V: value }));
  pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.obj({ Fields: [field] }));
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'signed-pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.signed-badge')).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDFを結合', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '2ページ目', exact: true })).toHaveAttribute('draggable', 'false');
  await page.getByRole('button', { name: '2ページ目', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'このページを削除', exact: true })).toBeDisabled();
  await expect(page.locator('.thumbnail-button')).toHaveCount(2);
});
