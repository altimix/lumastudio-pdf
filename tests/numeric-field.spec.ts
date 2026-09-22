import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

async function openText(page: Page) {
  const pdf = await PDFDocument.create();
  pdf.addPage([500, 700]);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'numeric-fields.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  const surface = page.getByTestId('pdf-surface');
  await expect(surface).toBeVisible();
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await surface.click({ position: { x: 70, y: 130 } });
  const inline = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await inline.fill('数値入力の確認');
  await inline.press('ControlOrMeta+Enter');
  await expect(inline).not.toBeVisible();
  const size = page.getByRole('spinbutton', { name: '文字サイズ', exact: true });
  await expect(size).toHaveValue('11');
  return { size, annotation: page.getByRole('button', { name: '文字: 数値入力の確認', exact: true }) };
}

async function projectData(page: Page, testInfo: TestInfo) {
  await page.getByRole('button', { name: '作業データ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '編集の続きを保存・再開', exact: true });
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '作業データを保存', exact: true }).click();
  const path = testInfo.outputPath('numeric-fields.lumapdf');
  await (await download).saveAs(path);
  await expect(dialog).not.toBeVisible();
  return JSON.parse(await readFile(path, 'utf8')) as { annotations: { fontSize: number; width: number }[] };
}

async function beginScrub(page: Page, input: Locator, delta: number, key?: 'Shift' | 'Alt') {
  const box = (await input.boundingBox())!;
  const x = box.x + Math.min(30, box.width / 3), y = box.y + box.height / 2;
  if (key) await page.keyboard.down(key);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 8 });
  if (key) await page.keyboard.up(key);
}

test.beforeEach(async ({ context }) => {
  await context.route('**/api/autofill', route => route.abort());
  await context.route('https://api.openai.com/**', route => route.abort());
});

test('数値を空欄にして置き換え、確定時だけ範囲を適用し、一度で元に戻せる', async ({ page }, testInfo) => {
  const { size, annotation } = await openText(page);
  await size.click();
  await size.press('ControlOrMeta+a');
  await size.press('Backspace');
  await expect(size).toHaveValue('');
  await size.pressSequentially('24.5');
  await expect(size).toHaveValue('24.5');
  await size.press('Enter');
  expect((await projectData(page, testInfo)).annotations[0].fontSize).toBe(24.5);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await annotation.click();
  await expect(size).toHaveValue('11');

  await size.fill('2');
  await expect(size).toHaveValue('2');
  await size.press('Tab');
  await expect(size).toHaveValue('6');
  await size.fill('');
  await size.press('Tab');
  await expect(size).toHaveValue('6');
  await size.fill('12.');
  await expect(size).toHaveValue('12.');
  await size.press('Enter');
  await expect(size).toHaveValue('12');
  await size.fill('invalid');
  await size.press('Enter');
  await expect(size).toHaveValue('12');
  await size.fill('88');
  await size.press('Escape');
  await expect(size).toHaveValue('12');
  await size.fill('120');
  await size.press('Enter');
  await expect(size).toHaveValue('96');
});

test('横ドラッグのプレビューを一度で確定・Undoし、Esc・ウィンドウ離脱では取り消す', async ({ page }, testInfo) => {
  const { size, annotation } = await openText(page);
  await beginScrub(page, size, 40);
  await expect(size).toHaveValue('21');
  await page.mouse.up();
  await expect(size).toHaveValue('21');
  expect((await projectData(page, testInfo)).annotations[0].fontSize).toBe(21);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await annotation.click();
  await expect(size).toHaveValue('11');

  await beginScrub(page, size, 32);
  await expect(size).toHaveValue('19');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(size).toHaveValue('11');
  await beginScrub(page, size, 32);
  await expect(size).toHaveValue('19');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await expect(size).toHaveValue('11');
  // Cancelled previews must not add any history item.
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(annotation).not.toBeVisible();
});

test('横ドラッグのShift・Alt調整とキーボード増減に対応し、通常クリックは変更しない', async ({ page }) => {
  const { size } = await openText(page);
  await size.click();
  await expect(size).toHaveValue('11');
  await size.press('ArrowUp');
  await expect(size).toHaveValue('12');
  await size.press('Shift+ArrowDown');
  await expect(size).toHaveValue('6');
  await size.fill('20');
  await size.press('Enter');
  await beginScrub(page, size, 8, 'Shift');
  await page.mouse.up();
  await expect(size).toHaveValue('40');
  await beginScrub(page, size, 40, 'Alt');
  await page.mouse.up();
  await expect(size).toHaveValue('41');
});

test('数値の入力途中に保存すると現在の値が反映される', async ({ page }, testInfo) => {
  const { size } = await openText(page);
  await size.fill('23.75');
  expect((await projectData(page, testInfo)).annotations[0].fontSize).toBe(23.75);
  await size.fill('34.5');
  const download = page.waitForEvent('download');
  await size.press('ControlOrMeta+s');
  const path = testInfo.outputPath('numeric-shortcut.pdf');
  await (await download).saveAs(path);
  expect((await PDFDocument.load(await readFile(path))).getPageCount()).toBe(1);
  await expect(size).toHaveValue('34.5');
  expect((await projectData(page, testInfo)).annotations[0].fontSize).toBe(34.5);
});

test('配置前の数値を確定せず用紙をクリックしても反映し、別素材へ移る前にも確定する', async ({ page }, testInfo) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([500, 700]);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'draft-numbers.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('記入する文字', { exact: true }).fill('配置時のサイズ');
  const size = page.getByRole('spinbutton', { name: '文字サイズ', exact: true });
  await size.fill('19');
  await page.getByTestId('pdf-surface').click({ position: { x: 65, y: 115 } });
  await expect(size).toHaveValue('19');
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await page.getByLabel('印鑑に入れる名前', { exact: true }).fill('山田');
  await page.getByRole('spinbutton', { name: '印鑑の大きさ', exact: true }).fill('40');
  await page.getByTestId('pdf-surface').click({ position: { x: 210, y: 210 } });
  await expect(page.getByRole('spinbutton', { name: '要素の幅', exact: true })).toHaveValue('40');
  await page.getByRole('button', { name: '文字: 配置時のサイズ', exact: true }).click();
  await size.fill('25');
  await page.getByRole('button', { name: '印鑑: 山田', exact: true }).click();
  const data = await projectData(page, testInfo);
  expect(data.annotations[0].fontSize).toBe(25);
  expect(data.annotations[1].width).toBe(40);
});
