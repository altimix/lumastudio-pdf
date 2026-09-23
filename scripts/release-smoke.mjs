import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { expect } from '@playwright/test';
import { extractFile } from '@electron/asar';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repo, 'release');
assert.ok(['win32', 'darwin'].includes(process.platform), 'Run packaged smoke on Windows or macOS.');
if (process.platform === 'darwin') {
  for (const directory of ['mac', 'mac-arm64']) {
    execFileSync('codesign', ['--verify', '--deep', '--strict', path.join(output, directory, 'LumaStudio PDF.app')], { stdio: 'inherit' });
  }
}
const executable = process.platform === 'win32'
  ? path.join(output, 'win-unpacked', 'LumaStudio PDF.exe')
  : path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'LumaStudio PDF.app', 'Contents', 'MacOS', 'LumaStudio PDF');
await fs.access(executable);
const archive = process.platform === 'win32'
  ? path.join(path.dirname(executable), 'resources', 'app.asar')
  : path.join(path.dirname(executable), '..', 'Resources', 'app.asar');
const bundledLicense = path.join(path.dirname(archive), 'LICENSE');
assert.ok((await fs.readFile(bundledLicense)).equals(await fs.readFile(path.join(repo, 'LICENSE'))),
  '配布アプリ内のGPLライセンス本文が不足または変更されています。');
// Reject stale builds before starting Electron or its print-inbox watcher.
for (const source of ['electron/main.cjs', 'electron/preload.cjs', 'electron/inbox-path.cjs', 'server/ai.cjs', 'server/ai-models.cjs', 'server/settings.cjs', 'dist/index.html']) {
  const current = await fs.readFile(path.join(repo, source));
  const bundled = extractFile(archive, path.normalize(source));
  assert.ok(current.equals(bundled), `配布アプリが古いため起動しません。再ビルド・再パッケージしてください: ${source}`);
}
await fs.mkdir(path.join(repo, 'tmp'), { recursive: true });
const userData = await fs.mkdtemp(path.join(repo, 'tmp', 'release-user-data-'));
const printInbox = path.join(userData, 'print-inbox');
await fs.mkdir(printInbox);
const env = { ...process.env, LUMA_ENV_PATH: path.join(userData, 'no-api-key.env'), LUMA_PRINT_INBOX: printInbox };
for (const key of ['ELECTRON_RUN_AS_NODE', 'VITE_DEV_SERVER_URL', 'OPENAI_API_KEY']) delete env[key];
let application;
const errors = [];
try {
  application = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${userData}`], cwd: repo, env, timeout: 60_000 });
  const packaged = await application.evaluate(({ app }) => {
    const load = process.getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`);
    const signature = load('./server/signature.cjs');
    return { isPackaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'), signPdf: typeof signature.signPdf };
  });
  assert.equal(packaged.isPackaged, true);
  assert.match(packaged.appPath, /app\.asar$/);
  assert.equal(path.resolve(packaged.userData), path.resolve(userData));
  assert.equal(packaged.signPdf, 'function');
  const page = await application.firstWindow({ timeout: 30_000 });
  const fontRequests = [];
  page.on('request', (request) => { if (/\.woff2?(?:\?|$)/.test(request.url())) fontRequests.push(request.url()); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await expect(page.getByRole('button', { name: 'サンプルの書類で試す' })).toBeVisible({ timeout: 30_000 });
  const bridge = await page.evaluate(async () => ({
    rendererNode: typeof window.require,
    signAndSavePdf: typeof window.lumaDesktop?.signAndSavePdf,
    aiAvailable: (await window.lumaDesktop.getAiStatus()).available,
    printInbox: await window.lumaDesktop.getPrintInbox(),
  }));
  assert.equal(bridge.rendererNode, 'undefined');
  assert.equal(bridge.signAndSavePdf, 'function');
  assert.equal(bridge.aiAvailable, false);
  assert.equal(path.resolve(bridge.printInbox), path.resolve(printInbox));
  const initialWindowState = await page.evaluate(() => window.lumaDesktop.getWindowState());
  assert.equal(typeof initialWindowState.maximized, 'boolean');
  assert.equal(typeof initialWindowState.fullScreen, 'boolean');
  const fullScreenable = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('LumaStudio PDFのメイン画面が見つかりません。');
    return window.isFullScreenable();
  });
  assert.equal(fullScreenable, true);
  // Headless macOS CI cannot reliably drive native window animations. Browser
  // tests exercise the renderer's state and Esc/button behavior on both OSes;
  // the packaged macOS smoke still checks the bridge, app launch, and PDF work.
  if (process.platform === 'win32') {
    const restoreButton = page.getByRole('button', { name: '元のサイズに戻す' });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await expect(restoreButton).toBeVisible({ timeout: 30_000 });
    await restoreButton.focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.lumaDesktop.getWindowState()), { timeout: 30_000 }).toMatchObject({ maximized: false, fullScreen: false });
    await expect(restoreButton).toHaveCount(0, { timeout: 30_000 });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
    await expect.poll(() => page.evaluate(() => window.lumaDesktop.getWindowState()), { timeout: 30_000 }).toMatchObject({ fullScreen: true });
    await expect(restoreButton).toBeVisible({ timeout: 30_000 });
    await restoreButton.click();
    await expect(restoreButton).toHaveCount(0, { timeout: 30_000 });
    assert.deepEqual(await page.evaluate(() => window.lumaDesktop.getWindowState()), { maximized: false, fullScreen: false });
  }
  await page.getByRole('button', { name: 'サンプルの書類で試す' }).click();
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pdf-canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 100) return false;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] < 190) ink += 1;
    return ink > 500;
  });
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await expect(page.getByLabel('フォント', { exact: true })).toHaveValue('noto-sans-jp');
  await expect(page.getByRole('spinbutton', { name: '文字サイズ', exact: true })).toHaveValue('11');
  await page.getByTestId('pdf-surface').click({ position: { x: 150, y: 220 } });
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await input.fill('同梱フォントの確認');
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByRole('button', { name: '文字: 同梱フォントの確認', exact: true }).locator('img')).toHaveAttribute('src', /^data:image\/png/);
  const fontState = await page.evaluate(() => {
    const faces = [];
    document.fonts.forEach((face) => { if (face.family.includes('Noto Sans JP Variable')) faces.push(face); });
    return {
      total: faces.length,
      loaded: faces.filter(face => face.status === 'loaded').length,
      textReady: document.fonts.check('normal 400 11px "Noto Sans JP Variable"', '同梱フォントの確認'),
    };
  });
  assert.ok(fontState.total > 50 && fontState.loaded > 0 && fontState.loaded < fontState.total / 2 && fontState.textReady,
    'Only the Japanese font subsets used by the sample text should be loaded.');
  assert.ok(fontRequests.length > 0 && fontRequests.every(url => url.startsWith('file:')), 'Fonts must load from the packaged application.');
  await page.getByRole('button', { name: '図形', exact: true }).click();
  await page.getByTestId('pdf-surface').click({ position: { x: 210, y: 340 } });
  await expect(page.locator('.annotation.selected .annotation-resize-handle')).toHaveCount(8);
  await page.getByRole('button', { name: 'ペン', exact: true }).click();
  const surface = await page.getByTestId('pdf-surface').boundingBox();
  if (!surface) throw new Error('手書き用のPDFが表示されていません。');
  await page.mouse.move(surface.x + 100, surface.y + 250);
  await page.mouse.down();
  await page.mouse.move(surface.x + 200, surface.y + 280, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /^ペン:/ })).toBeVisible();
  await page.screenshot({ path: path.join(repo, 'tmp', `release-smoke-${process.platform}.png`), fullPage: true });
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  const sealSize = page.getByRole('spinbutton', { name: '印鑑の大きさ', exact: true });
  await sealSize.fill('44');
  await sealSize.press('Enter');
  await page.reload();
  await page.getByRole('button', { name: 'サンプルの書類で試す' }).click();
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await expect(sealSize).toHaveValue('44');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', platform: process.platform, arch: process.arch, isPackaged: packaged.isPackaged, windowRestoreTested: process.platform === 'win32', nativeFullScreenTested: process.platform === 'win32', windowStateBridge: true, sampleRendered: true, bundledFontLoaded: true, shapeEditing: true, penDrawing: true, stampSizeRemembered: true, externalApiCalls: 0, physicalPrintTested: false }));
} finally {
  if (application) await application.close();
}
