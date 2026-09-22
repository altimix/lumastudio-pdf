import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function waitForPdf(page: Page) {
  await expect(page.getByTestId('pdf-surface')).toBeVisible();
  await expect.poll(() => page.locator('.pdf-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    if (canvas.width < 100 || canvas.height < 100) return false;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index + 3] > 0 && pixels[index] < 200) ink++;
    }
    return ink > 100;
  })).toBe(true);
}

async function openSample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルの書類で試す' }).click();
  await waitForPdf(page);
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled();
}

async function clickOriginalPoint(page: Page, x: number, y: number, rotation = 0) {
  const surface = page.getByTestId('pdf-surface');
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  if (!box) throw new Error('PDF page is not visible');
  const size = await surface.evaluate((element) => ({ width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight }));
  const scale = 0.85;
  let screenX = x * scale, screenY = y * scale;
  if (rotation === 90) { screenX = size.height - y * scale; screenY = x * scale; }
  if (rotation === 180) { screenX = size.width - x * scale; screenY = size.height - y * scale; }
  if (rotation === 270) { screenX = y * scale; screenY = size.width - x * scale; }
  await page.mouse.click(box.x + screenX, box.y + screenY);
}

test.beforeEach(async ({ context }) => {
  // The E2E suite must never transmit documents or registered values to OpenAI.
  await context.route('https://api.openai.com/**', (route) => route.abort());
});

test('日本語の記入・移動・丸印・履歴・保存・再読み込みが一続きで使える', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSample(page);
  const sampleImage = await page.locator('.pdf-canvas').evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));
  await mkdir('tmp', { recursive: true });
  await writeFile('tmp/ai-live-page.png', Buffer.from(sampleImage.split(',')[1], 'base64'));
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('記入する文字').fill('山田 太郎');
  await clickOriginalPoint(page, 190, 275);
  const text = page.getByRole('button', { name: '文字: 山田 太郎', exact: true });
  await expect(text).toBeVisible();
  await expect(text.locator('img')).toHaveAttribute('src', /^data:image\/png/);
  const before = await text.boundingBox();
  if (!before) throw new Error('Text is not visible');
  await page.mouse.move(before.x + 15, before.y + 8);
  await page.mouse.down();
  await page.mouse.move(before.x + 65, before.y + 28, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await text.boundingBox())!.x).toBeGreaterThan(before.x + 40);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect.poll(async () => Math.abs((await text.boundingBox())!.x - before.x)).toBeLessThan(2);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect.poll(async () => (await text.boundingBox())!.x).toBeGreaterThan(before.x + 40);

  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await page.getByLabel('印鑑に入れる名前').fill('山田');
  await page.getByRole('button', { name: '丸印', exact: true }).click();
  await expect(page.locator('.stamp-preview img')).toHaveAttribute('src', /^data:image\/png/);
  await clickOriginalPoint(page, 489, 697);
  await expect(page.getByRole('button', { name: '印鑑: 山田', exact: true })).toBeVisible();
  await expect(page.locator('.status-bar')).toContainText('2件の記入・押印');

  await page.screenshot({ path: testInfo.outputPath('filled-document.png'), fullPage: true });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toContain('_記入済.pdf');
  const file = testInfo.outputPath('filled.pdf');
  await download.saveAs(file);
  const savedPdf = await PDFDocument.load(await readFile(file));
  expect(savedPdf.getPageCount()).toBe(1);
  expect(savedPdf.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await page.getByTestId('pdf-input').setInputFiles(file);
  await expect(page.locator('.document-name')).toContainText('filled.pdf');
  await waitForPdf(page);
  await expect(page.locator('.annotation')).toHaveCount(0);
  // Red pixels must now exist in the rendered PDF itself, not an editor overlay.
  await expect.poll(() => page.locator('.pdf-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] > 110 && data[index] > data[index + 1] * 1.4 && data[index] > data[index + 2] * 1.4) red++;
    }
    return red;
  })).toBeGreaterThan(70);
  await page.screenshot({ path: testInfo.outputPath('reopened-document.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('登録情報と印鑑をAI候補として確認し、選択して配置した後も編集できる', async ({ page }, testInfo) => {
  let calls = 0;
  await page.route('**/api/autofill', async (route) => {
    calls++;
    const request = route.request().postDataJSON();
    expect(request.profile['氏名']).toBe('山田 太郎');
    expect(request.profile['口座番号']).toBe('1234567');
    expect(request.pages).toHaveLength(1);
    expect(request.pages[0].imageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(request.stamp).toEqual({ enabled: true, name: '山田' });
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ placements: [
        { pageId: request.pages[0].pageId, type: 'text', field: '氏名', text: '山田 太郎', x: 188, y: 276, width: 160, height: 24 },
        { pageId: request.pages[0].pageId, type: 'text', field: '口座番号', text: '1234567', x: 188, y: 574, width: 150, height: 24 },
        { pageId: request.pages[0].pageId, type: 'stamp', field: '押印欄', text: '山田', x: 489, y: 699, width: 48, height: 48 },
      ], notes: ['テスト用の配置候補です。外部APIは呼び出していません。'] }),
    });
  });
  await openSample(page);
  await page.getByRole('button', { name: '登録情報', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'よく使う情報' });
  await profile.getByLabel('氏名', { exact: true }).fill('山田 太郎');
  await profile.getByLabel('銀行名', { exact: true }).fill('サンプル銀行');
  await profile.getByLabel('口座番号', { exact: true }).fill('1234567');
  await profile.getByRole('button', { name: 'この端末に登録' }).click();
  await expect(profile).not.toBeVisible();
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await page.getByLabel('印鑑に入れる名前').fill('山田');
  await page.getByRole('button', { name: 'この印鑑を登録', exact: true }).click();
  await page.getByRole('button', { name: 'AI自動記入', exact: true }).click();
  const ai = page.getByRole('dialog', { name: 'AIで記入欄を埋める' });
  await expect(ai).toContainText('OpenAIへ送信します');
  await expect(ai).toContainText('山田 太郎');
  await expect(ai.getByLabel(/登録印鑑も押印欄へ配置する/)).toBeChecked();
  expect(calls).toBe(0);
  await ai.getByRole('button', { name: 'OpenAIに送信して候補を作る' }).click();
  await expect(ai.getByRole('button', { name: '3件を配置して編集' })).toBeVisible();
  await ai.locator('.ai-proposals label').filter({ hasText: '口座番号' }).getByRole('checkbox').uncheck();
  await ai.getByRole('button', { name: '2件を配置して編集' }).click();
  await expect(ai).not.toBeVisible();
  await expect(page.getByRole('button', { name: '文字: 山田 太郎', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '印鑑: 山田', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '文字: 1234567', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '内容', exact: true }).fill('山田 花子');
  await expect(page.getByRole('button', { name: '文字: 山田 花子', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('ai-proposals-applied.png'), fullPage: true });
  expect(calls).toBe(1);
});

test('回転したページへの記入位置とPDF保存後の回転が一致する', async ({ page }, testInfo) => {
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const first = source.addPage([400, 500]);
  first.drawText('ROTATION TEST', { x: 40, y: 430, size: 20, font });
  first.drawRectangle({ x: 40, y: 350, width: 300, height: 40, borderWidth: 1, borderColor: rgb(0.3, 0.3, 0.3) });
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'rotation.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) });
  await waitForPdf(page);
  await page.getByRole('button', { name: 'ページを右に回転', exact: true }).click();
  await expect(page.getByTestId('pdf-surface')).toHaveCSS('transform', /matrix\(0, 1, -1, 0,/);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('記入する文字').fill('回転後の記入');
  await clickOriginalPoint(page, 80, 100, 90);
  const annotation = page.getByRole('button', { name: '文字: 回転後の記入', exact: true });
  await expect(annotation).toBeVisible();
  await expect.poll(() => annotation.evaluate((element) => parseFloat((element as HTMLElement).style.left))).toBeCloseTo(68, 0);
  await expect.poll(() => annotation.evaluate((element) => parseFloat((element as HTMLElement).style.top))).toBeCloseTo(85, 0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const outputPath = testInfo.outputPath('rotated.pdf');
  await (await downloaded).saveAs(outputPath);
  const output = await PDFDocument.load(await readFile(outputPath));
  expect(output.getPage(0).getRotation().angle).toBe(90);
  await page.getByTestId('pdf-input').setInputFiles(outputPath);
  await expect(page.locator('.document-name')).toContainText('rotated.pdf');
  await expect(page.locator('.annotation')).toHaveCount(0);
  await waitForPdf(page);
  await expect.poll(() => page.locator('.pdf-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return canvas.width > canvas.height;
  })).toBe(true);
  const dimensions = await page.getByTestId('pdf-surface').boundingBox();
  expect(dimensions!.width).toBeGreaterThan(dimensions!.height);
  await page.screenshot({ path: testInfo.outputPath('rotated-reopened.png'), fullPage: true });
});

test('白背景の印影を透過し、複数の登録印鑑を管理してもPDFの罫線を隠さない', async ({ page }, testInfo) => {
  let apiCalls = 0;
  await page.route('**/api/**', route => { apiCalls++; return route.abort(); });
  const source = await PDFDocument.create();
  const sheet = source.addPage([400, 500]);
  sheet.drawText('TRANSPARENT STAMP TEST', { x: 30, y: 440, size: 15 });
  sheet.drawLine({ start: { x: 20, y: 300 }, end: { x: 380, y: 300 }, thickness: 3, color: rgb(0.05, 0.25, 0.95) });
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'stamp-lines.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) });
  await waitForPdf(page);
  const syntheticPng = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff'; context.fillRect(0, 0, 100, 100);
    context.strokeStyle = '#bc2028'; context.lineWidth = 7;
    context.beginPath(); context.arc(50, 50, 35, 0, Math.PI * 2); context.stroke();
    return canvas.toDataURL('image/png');
  });
  const register = async (name: string) => {
    await page.getByRole('button', { name: '印鑑', exact: true }).click();
    const selected = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '画像から印鑑を登録', exact: true }).click();
    await (await selected).setFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(syntheticPng.split(',')[1], 'base64') });
    const dialog = page.getByRole('dialog', { name: '印鑑画像を登録' });
    await dialog.getByRole('radio', { name: '白い背景を除去', exact: true }).check();
    await dialog.getByRole('textbox', { name: '印鑑名', exact: true }).fill(name);
    const preview = dialog.getByRole('img', { name: '透過処理後の印鑑画像' });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate(async element => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      return context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3];
    })).toBe(0);
    await dialog.getByRole('button', { name: 'この印鑑を登録', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  };
  await register('個人印テスト');
  await clickOriginalPoint(page, 150, 176);
  await expect(page.getByRole('button', { name: '画像: 個人印テスト', exact: true })).toBeVisible();
  await register('会社印テスト');
  const library = page.locator('.stamp-library');
  await expect(library.getByRole('button')).toHaveCount(2);
  await library.getByRole('button', { name: '個人印テスト', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '印鑑の名前', exact: true })).toHaveValue('個人印テスト');
  await library.getByRole('button', { name: '会社印テスト', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '印鑑の名前', exact: true })).toHaveValue('会社印テスト');
  await library.getByRole('button', { name: '個人印テスト', exact: true }).click();
  await page.getByRole('button', { name: 'この印鑑の登録を削除', exact: true }).click();
  await expect(library.getByRole('button')).toHaveCount(1);
  await expect(library.getByRole('button', { name: '会社印テスト', exact: true })).toBeVisible();
  // Deleting a registration must not remove a stamp already placed in the PDF.
  await expect(page.getByRole('button', { name: '画像: 個人印テスト', exact: true })).toBeVisible();
  await library.getByRole('button', { name: '会社印テスト', exact: true }).click();
  await clickOriginalPoint(page, 270, 270);
  await expect(page.getByRole('button', { name: '画像: 会社印テスト', exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const outputPath = testInfo.outputPath('transparent-stamps.pdf');
  await (await downloaded).saveAs(outputPath);
  expect((await PDFDocument.load(await readFile(outputPath))).getPageCount()).toBe(1);
  await page.getByTestId('pdf-input').setInputFiles(outputPath);
  await expect(page.locator('.document-name')).toContainText('transparent-stamps.pdf');
  await expect(page.locator('.annotation')).toHaveCount(0);
  await waitForPdf(page);
  await expect.poll(() => page.locator('.pdf-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] > 100 && data[index] > data[index + 1] * 2) red++;
    return red;
  })).toBeGreaterThan(70);
  const pixel = await page.locator('.pdf-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    return Array.from(canvas.getContext('2d')!.getImageData(Math.round(174 / 400 * canvas.width), Math.round(200 / 500 * canvas.height), 1, 1).data);
  });
  expect(pixel[2]).toBeGreaterThan(180);
  expect(pixel[2]).toBeGreaterThan(pixel[0] * 2);
  await page.screenshot({ path: testInfo.outputPath('transparent-stamps-reopened.png'), fullPage: true });
  expect(apiCalls).toBe(0);
});
