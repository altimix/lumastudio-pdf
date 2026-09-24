import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

interface ProjectJson {
  app: string;
  version: number;
  filename: string;
  original: string;
  pages: { id: string; sourceIndex: number; width: number; height: number; rotation: number }[];
  annotations: { id: string; pageId: string; type: string; text?: string }[];
}

async function fixture(signed = false) {
  const document = await PDFDocument.create();
  for (const [index, width] of [400, 410, 420].entries()) {
    document.addPage([width, 600]).drawText(`PROJECT ORIGINAL PAGE ${index + 1}`, { x: 30, y: 550, size: 16 });
  }
  if (signed) {
    const value = document.context.register(document.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', ByteRange: [0, 100, 200, 30], Contents: PDFHexString.of('010203') }));
    const field = document.context.register(document.context.obj({ FT: 'Sig', T: PDFString.of('TestSignature'), V: value }));
    document.catalog.set(PDFName.of('AcroForm'), document.context.obj({ Fields: [field] }));
  }
  return { name: 'editable-original.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) };
}

async function writeText(page: Page, value: string) {
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('記入する文字').fill(value);
  await page.getByTestId('pdf-surface').click({ position: { x: 65, y: 115 } });
  await expect(page.locator('.busy-indicator')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: `文字: ${value}`, exact: true })).toBeVisible();
}

async function projectDialog(page: Page) {
  await page.getByRole('button', { name: '作業データ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '編集の続きを保存・再開', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function saveProject(page: Page, testInfo: TestInfo) {
  const dialog = await projectDialog(page);
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '作業データを保存', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.lumapdf$/u);
  const file = testInfo.outputPath('editable-project.lumapdf');
  await download.saveAs(file);
  await expect(dialog).not.toBeVisible();
  const text = await readFile(file, 'utf8');
  return { file, text, data: JSON.parse(text) as ProjectJson };
}

test.beforeEach(async ({ context }) => {
  await context.route('**/api/autofill', route => route.abort());
  await context.route('https://api.openai.com/**', route => route.abort());
});

test('作業データから文字・印鑑・並び順・回転・削除状態を再開して修正できる', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('luma.profile.v1', JSON.stringify({ '氏名': '登録情報だけの秘密テスト', '口座番号': '9876543' }));
    localStorage.setItem('private-test-only', 'PRIVATE_STATE_MUST_NOT_EXPORT');
  });
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(await fixture());
  await expect(page.locator('.thumbnail-button')).toHaveCount(3, { timeout: 30_000 });
  await page.getByRole('button', { name: '2ページ目', exact: true }).click();
  await writeText(page, 'あとで修正する氏名');
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await page.getByLabel('印鑑に入れる名前').fill('山田');
  await page.getByRole('button', { name: '丸印', exact: true }).click();
  await page.getByTestId('pdf-surface').click({ position: { x: 230, y: 230 } });
  await expect(page.getByRole('button', { name: '印鑑: 山田', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '選択・移動', exact: true }).click();
  await page.getByRole('button', { name: 'ページを右に回転', exact: true }).click();
  const ids = await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')));
  const last = page.locator(`[data-page-entry="${ids[2]}"]`);
  const lastBox = await last.boundingBox();
  if (!lastBox) throw new Error('The last page is not visible');
  await page.locator(`.thumbnail-button[data-page-id="${ids[1]}"]`).dragTo(last, { targetPosition: { x: 45, y: lastBox.height - 5 } });
  await page.getByRole('button', { name: '1ページ目', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'このページを削除', exact: true }).click();
  await expect(page.locator('.thumbnail-button')).toHaveCount(2);
  const saved = await saveProject(page, testInfo);
  expect(saved.data.app).toBe('LumaStudio PDF');
  expect(saved.data.version).toBe(3);
  expect(Object.keys(saved.data).sort()).toEqual(['annotations', 'app', 'filename', 'original', 'pages', 'version']);
  expect(saved.data.pages.map(item => item.sourceIndex)).toEqual([2, 1]);
  expect(saved.data.pages.map(item => item.rotation)).toEqual([0, 90]);
  expect(saved.data.annotations.map(item => item.type).sort()).toEqual(['stamp', 'text']);
  expect(saved.text).not.toContain('登録情報だけの秘密テスト');
  expect(saved.text).not.toContain('9876543');
  expect(saved.text).not.toContain('PRIVATE_STATE_MUST_NOT_EXPORT');
  expect((await PDFDocument.load(Buffer.from(saved.data.original, 'base64'))).getPageCount()).toBe(3);

  // A new app session has no source PDF or editable objects until this file opens.
  await page.reload();
  await expect(page.locator('.thumbnail-button')).toHaveCount(0);
  const dialog = await projectDialog(page);
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: '保存した作業データを開く', exact: true }).click();
  await (await chooser).setFiles(saved.file);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.thumbnail-button')).toHaveCount(2, { timeout: 30_000 });
  const restoredIds = await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')));
  expect(restoredIds.every(id => !saved.data.pages.some(item => item.id === id))).toBe(true);
  await page.getByRole('button', { name: '2ページ目', exact: true }).click();
  await expect(page.getByRole('button', { name: '印鑑: 山田', exact: true })).toBeVisible();
  const text = page.getByRole('button', { name: '文字: あとで修正する氏名', exact: true });
  await expect(text).toBeVisible();
  const surface = await page.getByTestId('pdf-surface').boundingBox();
  expect(surface!.width).toBeGreaterThan(surface!.height);
  await text.click();
  await page.getByRole('textbox', { name: '内容', exact: true }).fill('再開して修正した氏名');
  await expect(page.getByRole('button', { name: '文字: 再開して修正した氏名', exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const pdfPath = testInfo.outputPath('project-reopened-and-edited.pdf');
  await (await downloadEvent).saveAs(pdfPath);
  const output = await PDFDocument.load(await readFile(pdfPath));
  expect(output.getPages().map(sheet => sheet.getWidth())).toEqual([420, 410]);
  expect(output.getPages().map(sheet => sheet.getRotation().angle)).toEqual([0, 90]);
  expect(output.getPage(1).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict).entries()).toHaveLength(2);
  await page.screenshot({ path: testInfo.outputPath('project-reopened.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('不正な作業データや署名付き原本を開こうとしても編集中の内容を失わない', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(await fixture());
  await expect(page.locator('.thumbnail-button')).toHaveCount(3, { timeout: 30_000 });
  await writeText(page, '保存済みの記入');
  const saved = await saveProject(page, testInfo);
  await page.getByRole('button', { name: '文字: 保存済みの記入', exact: true }).click();
  await page.getByRole('textbox', { name: '内容', exact: true }).fill('失ってはいけない未保存の記入');
  const originalIds = await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')));
  let confirmations = 0;
  page.on('dialog', async dialog => { confirmations++; await dialog.accept(); });
  const signedOriginal = (await fixture(true)).buffer.toString('base64');
  const cases: { name: string; change(data: ProjectJson): void; error: RegExp }[] = [
    { name: 'duplicate-ids', change: data => { data.pages[1].id = data.pages[0].id; }, error: /ページIDが重複/ },
    { name: 'wrong-source-index', change: data => { data.pages[1].sourceIndex = 99; }, error: /ページ情報が元のPDFと一致しません/ },
    { name: 'wrong-page-size', change: data => { data.pages[1].width += 20; }, error: /ページ情報が元のPDFと一致しません/ },
    { name: 'signed-original', change: data => { data.original = signedOriginal; }, error: /署名付きPDFを含む作業データは編集できません/ },
  ];
  const dialog = await projectDialog(page);
  for (const scenario of cases) {
    const invalid = structuredClone(saved.data);
    scenario.change(invalid);
    await page.getByTestId('project-input').setInputFiles({ name: `${scenario.name}.lumapdf`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await expect(dialog.getByRole('alert')).toHaveText(scenario.error, { timeout: 30_000 });
    await expect(dialog.getByRole('button', { name: '保存した作業データを開く', exact: true })).toBeEnabled();
    await expect(page.locator('.thumbnail-button')).toHaveCount(3);
    expect(await page.locator('.thumbnail-button').evaluateAll(elements => elements.map(element => element.getAttribute('data-page-id')))).toEqual(originalIds);
    await expect(page.locator('.unsaved')).toHaveCount(1);
  }
  expect(confirmations).toBe(cases.length);
  await dialog.getByRole('button', { name: '作業データ画面を閉じる', exact: true }).click();
  await page.getByRole('button', { name: '文字: 失ってはいけない未保存の記入', exact: true }).click();
  await page.getByRole('textbox', { name: '内容', exact: true }).fill('読込失敗後も編集できる');
  await expect(page.getByRole('button', { name: '文字: 読込失敗後も編集できる', exact: true })).toBeVisible();
});
