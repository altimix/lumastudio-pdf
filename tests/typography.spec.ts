import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';

async function open(page: Page) {
  const pdf = await PDFDocument.create();
  pdf.addPage([500, 700]);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'typography.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByTestId('pdf-surface')).toBeVisible();
}

async function project(page: Page, info: TestInfo, name: string) {
  await page.getByRole('button', { name: '作業データ', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '作業データを保存', exact: true }).click();
  const path = info.outputPath(name);
  await (await event).saveAs(path);
  return { path, data: JSON.parse(await readFile(path, 'utf8')) };
}

test('同梱Googleフォントの標準・装飾を選んで再開し、PDFにも書き出せる', async ({ page }, info) => {
  const externalFonts: string[] = [];
  page.on('request', request => { if (/fonts\.(?:googleapis|gstatic)\.com/.test(request.url())) externalFonts.push(request.url()); });
  await open(page);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await expect(page.getByLabel('フォント', { exact: true })).toHaveValue('noto-sans-jp');
  await expect(page.getByRole('spinbutton', { name: '文字サイズ', exact: true })).toHaveValue('11');
  await page.getByLabel('記入する文字', { exact: true }).fill('日本語の書体と太字');
  await page.getByLabel('フォント', { exact: true }).selectOption('noto-serif-jp');
  await page.getByRole('button', { name: '太字', exact: true }).click();
  await page.getByRole('button', { name: '斜体', exact: true }).click();
  await page.getByRole('button', { name: '下線', exact: true }).click();
  await page.getByTestId('pdf-surface').click({ position: { x: 70, y: 140 } });
  const annotation = page.getByRole('button', { name: '文字: 日本語の書体と太字', exact: true });
  await expect(annotation.locator('img')).toHaveAttribute('src', /^data:image\/png/);
  const saved = await project(page, info, 'styled-text.lumapdf');
  expect(saved.data.annotations[0]).toMatchObject({ fontFamily: 'noto-serif-jp', fontWeight: 700, fontStyle: 'italic', underline: true, fontSize: 11, color: '#000000' });
  await page.reload();
  await page.getByTestId('project-input').setInputFiles(saved.path);
  await expect(annotation).toBeVisible();
  await annotation.click();
  await expect(page.getByLabel('フォント', { exact: true })).toHaveValue('noto-serif-jp');
  await expect(page.getByRole('button', { name: '太字', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await annotation.dblclick();
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await expect(input).toHaveCSS('font-weight', '700');
  await expect(input).toHaveCSS('font-style', 'italic');
  await expect(input).toHaveCSS('text-decoration-line', 'underline');
  await expect(input).toHaveCSS('font-family', /Noto Serif JP Variable/);
  await input.fill('明朝体の再編集');
  await input.press('ControlOrMeta+Enter');
  await page.getByLabel('フォント', { exact: true }).selectOption('biz-udgothic');
  await expect(page.getByLabel('フォント', { exact: true })).toHaveValue('biz-udgothic');
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
  const changed = await project(page, info, 'changed-font.lumapdf');
  expect(changed.data.annotations[0]).toMatchObject({ text: '明朝体の再編集', fontFamily: 'biz-udgothic', fontWeight: 700, underline: true });
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const pdfPath = info.outputPath('styled-text.pdf');
  await (await event).saveAs(pdfPath);
  const output = await PDFDocument.load(await readFile(pdfPath));
  expect(output.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict).entries()).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('typography-controls.png'), fullPage: true });
  expect(externalFonts).toEqual([]);
});

test('印鑑35四方とチェック12四方で配置し、旧作業データは従来書体で開く', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '印鑑の大きさ', exact: true })).toHaveValue('35');
  await page.getByLabel('印鑑に入れる名前', { exact: true }).fill('山田');
  await page.getByTestId('pdf-surface').click({ position: { x: 80, y: 100 } });
  await expect(page.getByRole('spinbutton', { name: '要素の幅', exact: true })).toHaveValue('35');
  await expect(page.getByRole('spinbutton', { name: '要素の高さ', exact: true })).toHaveValue('35');
  await page.getByRole('button', { name: 'チェック', exact: true }).click();
  await page.getByTestId('pdf-surface').click({ position: { x: 150, y: 200 } });
  await expect(page.getByRole('spinbutton', { name: '要素の幅', exact: true })).toHaveValue('12');
  await expect(page.getByRole('spinbutton', { name: '要素の高さ', exact: true })).toHaveValue('12');
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('記入する文字', { exact: true }).fill('従来の文字');
  await page.getByTestId('pdf-surface').click({ position: { x: 70, y: 300 } });
  const saved = await project(page, info, 'sizes-and-legacy.lumapdf');
  expect(saved.data.annotations[0]).toMatchObject({ type: 'stamp', width: 35, height: 35 });
  expect(saved.data.annotations[1]).toMatchObject({ type: 'check', width: 12, height: 12 });
  const legacy = saved.data.annotations[2];
  saved.data.version = 1;
  delete legacy.fontFamily; delete legacy.fontWeight; delete legacy.fontStyle; delete legacy.underline;
  await page.reload();
  await page.getByTestId('project-input').setInputFiles({ name: 'legacy.lumapdf', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved.data)) });
  await page.getByRole('button', { name: '文字: 従来の文字', exact: true }).click();
  await expect(page.getByLabel('フォント', { exact: true })).toHaveValue('legacy');
});

test('フォント読込が遅れても作業データ画面から入力欄へフォーカスを奪わない', async ({ page }) => {
  let releaseFonts!: () => void;
  const gate = new Promise<void>(resolve => { releaseFonts = resolve; });
  await page.route(/\.woff2?(?:\?|$)/, async route => { await gate; await route.continue(); });
  const pdf = await PDFDocument.create(); pdf.addPage([500, 700]);
  const source = {
    app: 'LumaStudio PDF', version: 2, filename: 'font-load.pdf', original: Buffer.from(await pdf.save()).toString('base64'),
    pages: [{ id:'p', sourceIndex:0, width:500, height:700, rotation:0, viewportTransform:[1,0,0,-1,0,700] }],
    annotations: [{ id:'a', pageId:'p', type:'text', x:70, y:140, width:180, height:30, text:'読込中の文字', fontFamily:'noto-sans-jp', fontSize:11 }],
  };
  await page.goto('/');
  await page.getByTestId('project-input').setInputFiles({ name:'font-load.lumapdf', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name:'文字: 読込中の文字', exact:true }).dblclick();
  const input = page.getByRole('textbox', { name:'PDF上の文字入力', exact:true });
  await expect(input).toBeDisabled();
  await page.getByRole('button', { name:'作業データ', exact:true }).click();
  const dialog = page.getByRole('dialog', { name:'編集の続きを保存・再開', exact:true });
  await dialog.getByRole('button', { name:'作業データ画面を閉じる', exact:true }).focus();
  releaseFonts();
  await expect(input).toBeEditable();
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name:'作業データ画面を閉じる', exact:true }).click();
  await input.fill('読み込み後も編集できる');
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByRole('button', { name:'文字: 読み込み後も編集できる', exact:true })).toBeVisible();
});
