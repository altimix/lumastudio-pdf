import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { expect } from '@playwright/test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = path.join(repo, 'release', 'mvp', 'win-unpacked', 'LumaStudio PDF.exe');
await fs.access(executablePath);
await fs.mkdir(path.join(repo, 'tmp'), { recursive: true });
const userData = await fs.mkdtemp(path.join(repo, 'tmp', 'packaged-user-data-'));
const env = { ...process.env, LUMA_ENV_PATH: path.join(userData, 'no-api-key.env') };
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL; delete env.OPENAI_API_KEY;
const errors = [];
const consoleErrors = [];
let application;
try {
  application = await _electron.launch({ executablePath, args: [`--user-data-dir=${userData}`], cwd: repo, env, timeout: 60_000 });
  const mainState = await application.evaluate(({ app }) => {
    const load = process.getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`);
    const signature = load('./server/signature.cjs');
    return {
      isPackaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'),
      signatureExports: ['inspectCertificate', 'signPdf'].map((name) => [name, typeof signature[name]]),
    };
  });
  assert.equal(mainState.isPackaged, true);
  assert.match(mainState.appPath, /app\.asar$/u);
  assert.equal(path.resolve(mainState.userData), path.resolve(userData));
  assert.deepEqual(mainState.signatureExports, [['inspectCertificate', 'function'], ['signPdf', 'function']]);
  const page = await application.firstWindow({ timeout: 30_000 });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await expect(page.getByRole('button', { name: 'サンプルの書類で試す' })).toBeVisible({ timeout: 30_000 });
  const bridge = await page.evaluate(async () => ({
    openPdf: typeof window.lumaDesktop?.openPdf,
    openPdfs: typeof window.lumaDesktop?.openPdfs,
    openProject: typeof window.lumaDesktop?.openProject,
    saveProject: typeof window.lumaDesktop?.saveProject,
    signAndSavePdf: typeof window.lumaDesktop?.signAndSavePdf,
    rendererNode: typeof window.require,
    aiAvailable: (await window.lumaDesktop.getAiStatus()).available,
    storageKeys: Object.keys(localStorage),
  }));
  assert.equal(bridge.openPdf, 'function');
  assert.equal(bridge.openPdfs, 'function');
  assert.equal(bridge.openProject, 'function');
  assert.equal(bridge.saveProject, 'function');
  assert.equal(bridge.signAndSavePdf, 'function');
  assert.equal(bridge.rendererNode, 'undefined');
  assert.equal(bridge.aiAvailable, false);
  assert.deepEqual(bridge.storageKeys, []);
  await page.getByRole('button', { name: 'サンプルの書類で試す' }).click();
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pdf-canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 100) return false;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] < 190) ink += 1;
    return ink > 500;
  });
  await page.screenshot({ path: path.join(repo, 'tmp', 'packaged-smoke.png'), fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  const summary = {
    result: 'passed', isPackaged: mainState.isPackaged, executablePath,
    isolatedUserData: userData, packagedSignatureModuleLoaded: true,
    sampleRendered: true, consoleErrors, pageErrors: errors, externalApiCalls: 0,
    screenshot: path.join(repo, 'tmp', 'packaged-smoke.png'),
  };
  await fs.writeFile(path.join(repo, 'tmp', 'packaged-smoke.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (application) await application.close();
}
