// Local-only verification. Pass the two original image paths as CLI arguments.
// Original image files and processed image bytes are never copied into source files.
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

const files = process.argv.slice(2);
if (files.length !== 2) throw new Error('Pass exactly two local PNG or JPEG paths.');
await mkdir('tmp', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  let blockedRequests = 0;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.startsWith('/api/')) {
      blockedRequests++; return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5193');
  await page.getByRole('button', { name: 'サンプルの書類で試す' }).click();
  await page.getByTestId('pdf-surface').waitFor();
  const processing = [];
  for (const [index, filename] of files.entries()) {
    await page.getByRole('button', { name: '印鑑', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '画像から印鑑を登録', exact: true }).click();
    await (await chooser).setFiles(filename);
    const dialog = page.getByRole('dialog', { name: '印鑑画像を登録' });
    const preview = dialog.getByRole('img', { name: '透過処理後の印鑑画像' });
    await preview.waitFor();
    const pixels = await preview.evaluate(async element => {
      await element.decode();
      const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(element, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0, ink = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] === 0) transparent++;
        else if (pixels[index] > 20) ink++;
      }
      return { width: canvas.width, height: canvas.height, transparent, ink };
    });
    assert(pixels.transparent > 0 && pixels.ink > 0, 'Processed image must preserve ink and have transparency.');
    const mode = await dialog.getByRole('radio', { checked: true }).inputValue();
    const name = index === 0 ? '個人印（取り込み確認）' : '会社印（取り込み確認）';
    await dialog.getByRole('textbox', { name: '印鑑名', exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'この印鑑を登録', exact: true }).click();
    if (index === 1) {
      const size = page.locator('.properties-panel input[type="range"]');
      await size.focus();
      await size.press('Home');
      for (let step = 0; step < 46; step++) await size.press('ArrowRight');
    }
    const surface = await page.getByTestId('pdf-surface').boundingBox();
    assert(surface);
    const x = index === 0 ? 489 : 390, y = index === 0 ? 697 : 678;
    await page.mouse.click(surface.x + x * 0.85, surface.y + y * 0.85);
    await page.getByRole('button', { name: `画像: ${name}`, exact: true }).waitFor();
    processing.push({ file: path.basename(filename), mode, ...pixels });
  }
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  assert.equal(await page.locator('.stamp-library button').count(), 2);
  await page.waitForFunction(() => [...document.querySelectorAll('.annotation img')].every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: 'tmp/provided-stamps-test.png', fullPage: true });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  await (await downloaded).saveAs('tmp/provided-stamps-test.pdf');
  const exported = await PDFDocument.load(await readFile('tmp/provided-stamps-test.pdf'));
  assert.equal(exported.getPageCount(), 1);
  await page.getByTestId('pdf-input').setInputFiles('tmp/provided-stamps-test.pdf');
  await page.getByText('provided-stamps-test.pdf', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pdf-canvas');
    if (!canvas || canvas.width < 100) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 90 && pixels[index] > pixels[index + 1] * 1.4 && pixels[index] > pixels[index + 2] * 1.4) red++;
    }
    return red > 100;
  });
  await page.screenshot({ path: 'tmp/provided-stamps-reopened.png', fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(blockedRequests, 0, 'The application should not attempt any API or external request.');
  console.log(JSON.stringify({ mode: 'local-only-real-image-verification', externalApiCalls: 0, imageCount: files.length, processing, pageCount: exported.getPageCount(), errors, outputs: ['tmp/provided-stamps-test.png', 'tmp/provided-stamps-test.pdf', 'tmp/provided-stamps-reopened.png'] }, null, 2));
} finally {
  await browser.close();
}
