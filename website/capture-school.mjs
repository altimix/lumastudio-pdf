// Recreate the website's fictional school example in the packaged v1.0.8 app.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(['darwin', 'win32'].includes(process.platform), 'Capture on Windows or macOS with the packaged app.');
const release = path.resolve(process.argv[2] || path.join(repo, 'release'));
const executable = process.platform === 'win32'
  ? path.join(release, 'win-unpacked', 'LumaStudio PDF.exe')
  : path.join(release, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'LumaStudio PDF.app', 'Contents', 'MacOS', 'LumaStudio PDF');
await mkdir(path.join(repo, 'tmp'), { recursive: true });
const isolated = await mkdtemp(path.join(repo, 'tmp', 'school-capture-'));
const printInbox = path.join(isolated, 'print-inbox');
await mkdir(printInbox);
const env = { ...process.env, LUMA_ENV_PATH: path.join(isolated, 'no-api-key.env'), LUMA_PRINT_INBOX: printInbox };
for (const name of ['ELECTRON_RUN_AS_NODE', 'VITE_DEV_SERVER_URL', 'OPENAI_API_KEY']) delete env[name];
let application;
try {
  application = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${isolated}`], cwd: repo, env });
  console.log('Capture app launched');
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  await expect(page.getByRole('button', { name: 'サンプルの書類で試す' })).toBeVisible();
  const actual = await application.evaluate(({ app, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1600, 900);
    return { version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath('userData') };
  });
  assert.equal(actual.version, '1.0.8');
  assert.equal(actual.packaged, true);
  assert.equal(path.resolve(actual.userData), path.resolve(isolated));
  await page.context().route('https://api.openai.com/**', route => route.abort());
  await expect(page.getByRole('button', { name: 'サンプルの書類で試す' })).toBeVisible();
  assert.equal(path.resolve(await page.evaluate(() => window.lumaDesktop.getPrintInbox())), path.resolve(printInbox));
  assert.equal((await page.evaluate(() => window.lumaDesktop.getAiStatus())).available, false);
  console.log('Isolated app ready');
  const base = await page.evaluate(async () => {
    const family = '"Noto Sans JP Variable", sans-serif';
    const labels = ['授業用の見本PDF', '校外学習の準備メモ', '出発前に、持ち物と集合場所を確認しましょう。', '集合について', '集合場所　学校の正門前', '集合時刻', '持ち物', '水筒', '筆記用具', '雨具', 'ハンカチ・ティッシュ', '確認メモ', '架空の教材：このプリントは操作例のために作成しています。'];
    await document.fonts.load(`400 12px ${family}`, labels.join(''));
    await document.fonts.load(`700 24px ${family}`, labels.join(''));
    const canvas = document.createElement('canvas');
    canvas.width = 1190; canvas.height = 1684;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 595, 842);
    const text = (value, x, y, size = 12, bold = false, color = '#253b33') => {
      ctx.font = `${bold ? 700 : 400} ${size}px ${family}`;
      ctx.fillStyle = color; ctx.textBaseline = 'top'; ctx.fillText(value, x, y);
    };
    const section = (title, y) => {
      ctx.fillStyle = '#edf3ed'; ctx.fillRect(48, y, 499, 32); text(title, 60, y + 7, 13, true);
    };
    text(labels[0], 48, 30, 9, false, '#728078');
    text(labels[1], 48, 56, 24, true);
    text(labels[2], 48, 99, 11);
    section('1  集合について', 137);
    text(labels[4], 60, 184);
    text(labels[5], 60, 218);
    ctx.strokeStyle = '#c7d2ca'; ctx.lineWidth = 0.8;
    ctx.strokeRect(140, 211, 300, 30);
    section('2  持ち物', 273);
    for (const [index, value] of labels.slice(7, 11).entries()) {
      const y = 323 + index * 37;
      ctx.strokeStyle = '#9aaba1'; ctx.strokeRect(59, y + 1, 13, 13);
      text(value, 87, y, 13);
    }
    section('3  確認メモ', 505);
    ctx.strokeStyle = '#dce4de';
    for (const y of [562, 602, 642, 682]) { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(535, y); ctx.stroke(); }
    text(labels[12], 48, 788, 8, false, '#7b8780');
    text('1 / 1', 520, 788, 8, false, '#7b8780');
    return canvas.toDataURL('image/png');
  });
  console.log('Fictional worksheet rendered');
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(base);
  pdf.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  pdf.setTitle('校外学習の準備メモ（見本）');
  await page.getByTestId('pdf-input').setInputFiles({ name: '校外学習の準備メモ（見本）.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  const surface = page.getByTestId('pdf-surface');
  await expect(surface).toBeVisible();
  await page.getByRole('button', { name: 'ページ全体に合わせる', exact: true }).click();
  console.log('Fictional worksheet opened');
  const point = async (x, y) => {
    const box = await surface.boundingBox();
    const scale = box.width / 595;
    return { x: box.x + x * scale, y: box.y + y * scale };
  };
  const addText = async (value, x, y) => {
    await page.getByRole('button', { name: '文字を記入', exact: true }).click();
    await page.getByLabel('記入する文字').fill(value);
    const p = await point(x, y); await page.mouse.click(p.x, p.y);
    await expect(page.getByRole('button', { name: `文字: ${value}`, exact: true })).toBeVisible();
  };
  await addText('8:40に集合', 155, 229);
  await addText('歩きやすい靴で来ましょう。', 65, 560);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('文字の向き', { exact: true }).selectOption('vertical-rl');
  const size = page.getByRole('spinbutton', { name: '文字サイズ', exact: true });
  await size.fill('20'); await size.press('Enter');
  await addText('雨天も実施', 480, 610);
  await page.getByRole('button', { name: 'チェック', exact: true }).click();
  const check = await point(65.5, 330); await page.mouse.click(check.x, check.y);
  await page.getByRole('button', { name: '蛍光ペン', exact: true }).click();
  const from = await point(86, 332), to = await point(125, 332);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up();
  await page.getByRole('button', { name: '選択・移動', exact: true }).click();
  await expect(page.locator('.annotation')).toHaveCount(5);
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, path.join(isolated, '校外学習の準備メモ_追記例.pdf'));
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '記入済みPDFを書き出しました' })).toBeVisible();
  if (await page.getByRole('button', { name: '通知を閉じる' }).count()) await page.getByRole('button', { name: '通知を閉じる' }).click();
  await page.getByRole('button', { name: 'ページ全体に合わせる', exact: true }).click();
  await page.getByRole('button', { name: '文字: 雨天も実施', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(repo, 'website/public/assets/editor-school-v1.0.8.png'), scale: 'css' });
  console.log(JSON.stringify({ result: 'captured', appVersion: actual.version, isPackaged: true, fictionalDocument: true, annotations: 5, output: 'website/public/assets/editor-school-v1.0.8.png' }));
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (application) {
    const child = application.process();
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await application.close().catch(() => {});
    clearTimeout(timeout);
  }
  await rm(isolated, { recursive: true, force: true });
}
