// Replay a previously saved real API response through the UI. Makes no API call.
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const response = JSON.parse(await readFile(process.argv[2] || 'tmp/ai-live-result.json', 'utf8'));
const outputPrefix = process.argv[3] || 'tmp/ai-live';
const profile = {
  氏名: '山田 太郎', 会社名: '株式会社テスト文具', 住所: '東京都架空区テスト町1-2-3',
  電話番号: '03-0000-0000', 銀行名: '架空銀行', 支店名: 'テスト支店',
  口座種別: '普通', 口座番号: '0000000', 口座名義: 'ヤマダ タロウ',
};
await mkdir('tmp', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  await context.route('https://api.openai.com/**', route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let replayCount = 0;
  await page.route('**/api/autofill', async route => {
    replayCount++;
    const request = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ...response,
      placements: response.placements.map(placement => ({ ...placement, pageId: request.pages[0].pageId })),
    }) });
  });
  await page.goto(process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5193');
  await page.getByRole('button', { name: 'サンプルの書類で試す' }).click();
  await page.getByTestId('pdf-surface').waitFor();
  await page.getByRole('button', { name: '登録情報', exact: true }).click();
  const registration = page.getByRole('dialog', { name: 'よく使う情報' });
  for (const [field, value] of Object.entries(profile)) await registration.getByLabel(field, { exact: true }).fill(value);
  await registration.getByRole('button', { name: 'この端末に登録' }).click();
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await page.getByLabel('印鑑に入れる名前').fill('山田');
  await page.getByRole('button', { name: 'この印鑑を登録', exact: true }).click();
  await page.getByRole('button', { name: 'AI自動記入', exact: true }).click();
  const ai = page.getByRole('dialog', { name: 'AIで記入欄を埋める' });
  await ai.getByLabel('記入日', { exact: true }).fill('2026年9月22日');
  await ai.getByRole('button', { name: 'OpenAIに送信して候補を作る' }).click();
  await ai.getByRole('button', { name: `${response.placements.length}件を配置して編集` }).click();
  await page.getByRole('button', { name: '選択・移動', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.annotation img')].every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: outputPrefix + '-applied.png', fullPage: true });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  await (await downloaded).saveAs(outputPrefix + '-filled.pdf');
  const pdf = await PDFDocument.load(await readFile(outputPrefix + '-filled.pdf'));
  await page.getByTestId('pdf-input').setInputFiles(outputPrefix + '-filled.pdf');
  await page.getByText(outputPrefix.split('/').pop() + '-filled.pdf', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pdf-canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 100) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 110 && pixels[index] > pixels[index + 1] * 1.4 && pixels[index] > pixels[index + 2] * 1.4) red++;
    }
    return red > 70;
  });
  await page.screenshot({ path: outputPrefix + '-reopened.png', fullPage: true });
  console.log(JSON.stringify({ mode: 'saved-real-response-replay', externalApiCalls: 0, replayCount, pageCount: pdf.getPageCount(), placementCount: response.placements.length, errors, outputs: [outputPrefix + '-applied.png', outputPrefix + '-filled.pdf', outputPrefix + '-reopened.png'] }, null, 2));
} finally {
  await browser.close();
}
