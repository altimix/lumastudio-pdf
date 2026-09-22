import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';
import { expect } from '@playwright/test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(['win32', 'darwin'].includes(process.platform), 'Run packaged smoke on Windows or macOS.');
if (process.platform === 'darwin') {
  for (const directory of ['mac', 'mac-arm64']) {
    execFileSync('codesign', ['--verify', '--deep', '--strict', path.join(repo, 'release', directory, 'LumaStudio PDF.app')], { stdio: 'inherit' });
  }
}
const executable = process.platform === 'win32'
  ? path.join(repo, 'release', 'win-unpacked', 'LumaStudio PDF.exe')
  : path.join(repo, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'LumaStudio PDF.app', 'Contents', 'MacOS', 'LumaStudio PDF');
await fs.access(executable);
await fs.mkdir(path.join(repo, 'tmp'), { recursive: true });
const userData = await fs.mkdtemp(path.join(repo, 'tmp', 'release-user-data-'));
const env = { ...process.env, LUMA_ENV_PATH: path.join(userData, 'no-api-key.env') };
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
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await expect(page.getByRole('button', { name: 'サンプルの書類で試す' })).toBeVisible({ timeout: 30_000 });
  const bridge = await page.evaluate(async () => ({
    rendererNode: typeof window.require,
    signAndSavePdf: typeof window.lumaDesktop?.signAndSavePdf,
    aiAvailable: (await window.lumaDesktop.getAiStatus()).available,
  }));
  assert.equal(bridge.rendererNode, 'undefined');
  assert.equal(bridge.signAndSavePdf, 'function');
  assert.equal(bridge.aiAvailable, false);
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
  await page.screenshot({ path: path.join(repo, 'tmp', `release-smoke-${process.platform}.png`), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', platform: process.platform, arch: process.arch, isPackaged: packaged.isPackaged, sampleRendered: true, externalApiCalls: 0, physicalPrintTested: false }));
} finally {
  if (application) await application.close();
}
