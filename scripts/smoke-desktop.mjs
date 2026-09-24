import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { expect } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';

// Real Electron + built UI + preload + IPC + PDF rendering/export. Only native
// file dialogs and the final printer-driver call are mocked. No API requests.
// Run after npm run build. All profile data and the inbox use this test folder.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.access(path.join(repo, 'dist', 'index.html'));
await fs.mkdir(path.join(repo, 'tmp'), { recursive: true });
const output = await fs.mkdtemp(path.join(repo, 'tmp', 'desktop-smoke-'));
const documents = path.join(output, 'documents');
const userData = path.join(output, 'user-data');
await Promise.all([fs.mkdir(documents), fs.mkdir(userData)]);
const fixturePath = path.join(output, 'desktop-input.pdf');
const savedPath = path.join(output, 'desktop-edited.pdf');
const printReportPath = path.join(output, 'print-report.json');
const bootstrapPath = path.join(output, 'bootstrap.cjs');

const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 2; i += 1) {
  const page = source.addPage([595.28, 841.89]);
  page.drawText(`LumaStudio PDF desktop smoke — page ${i + 1}`, { x: 45, y: 785, font, size: 16, color: rgb(0.1, 0.25, 0.2) });
  page.drawRectangle({ x: 45, y: 515, width: 480, height: 155, borderWidth: 1, borderColor: rgb(0.6, 0.7, 0.65) });
}
await fs.writeFile(fixturePath, await source.save());

await fs.writeFile(bootstrapPath, `
const { app, dialog } = require('electron');
const fs = require('node:fs');
app.setPath('userData', ${JSON.stringify(userData)});
app.setPath('documents', ${JSON.stringify(documents)});
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(fixturePath)}] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(savedPath)} });
dialog.showMessageBoxSync = () => 1;
app.on('web-contents-created', (_event, contents) => {
  contents.print = (options, callback) => {
    contents.executeJavaScript(
      "Array.from(document.querySelectorAll('.sheet canvas')).map(c => ({ width: c.width, height: c.height, ink: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data).filter((v, i) => i % 4 !== 3 && v < 220).length }))"
    ).then(canvases => {
      fs.writeFileSync(${JSON.stringify(printReportPath)}, JSON.stringify({ mockedPrinterCall: true, options, canvases }, null, 2));
      callback(true);
    }, error => callback(false, error.message));
  };
});
require(${JSON.stringify(path.join(repo, 'electron', 'main.cjs'))});
`, 'utf8');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
let application;
const pageErrors = [];
const consoleErrors = [];
try {
  application = await _electron.launch({ args: [bootstrapPath], cwd: repo, env, timeout: 60_000 });
  application.on('window', (page) => {
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  });
  const window = await application.firstWindow({ timeout: 60_000 });
  window.on('pageerror', (error) => pageErrors.push(error.message));
  window.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await expect(window.getByRole('button', { name: 'サンプルの書類で試す' })).toBeVisible({ timeout: 30_000 });

  const bridge = await window.evaluate(async () => ({
    methods: Object.keys(window.lumaDesktop).sort(),
    nodeProcess: typeof window.process,
    nodeRequire: typeof window.require,
    statusKeys: Object.keys(await window.lumaDesktop.getAiStatus()).sort(),
    inbox: await window.lumaDesktop.getPrintInbox(),
  }));
  assert.deepEqual(bridge.methods, ['autofill', 'getAiStatus', 'getAiSettings', 'saveAiSettings', 'removeAiSettings', 'openHelpLink', 'getPrintInbox', 'onOpenPdf', 'openPdf', 'openPdfs', 'openProject', 'saveProject', 'openPrintInbox', 'printPdf', 'savePdf', 'chooseCertificate', 'inspectCertificate', 'signAndSavePdf', 'getWindowState', 'restoreWindow', 'onWindowStateChange', 'onMenuAction', 'onSaveAndClose', 'finishCloseSave'].sort());
  assert.equal(bridge.nodeProcess, 'undefined');
  assert.equal(bridge.nodeRequire, 'undefined');
  assert.deepEqual(bridge.statusKeys, ['available', 'model']);
  assert.equal(path.resolve(bridge.inbox), path.join(documents, 'LumaStudio PDF', 'Print Inbox'));

  // Exercise the actual native-open IPC through the UI (only dialog selection is mocked).
  await window.getByRole('button', { name: '開く', exact: true }).click();
  await expect(window.locator('.document-name')).toContainText('desktop-input.pdf');
  const surface = window.getByTestId('pdf-surface');
  await expect(surface).toBeVisible();
  await expect(window.locator('.busy-indicator')).toHaveCount(0);
  await window.getByRole('button', { name: '文字を記入', exact: true }).click();
  await window.getByLabel('記入する文字').fill('山田 太郎');
  await surface.click({ position: { x: 130, y: 180 } });
  await expect(window.getByRole('button', { name: '文字: 山田 太郎', exact: true })).toBeVisible();
  await window.getByRole('button', { name: '印鑑', exact: true }).click();
  await window.getByLabel('印鑑に入れる名前').fill('山田');
  await surface.click({ position: { x: 330, y: 220 } });
  await expect(window.getByRole('button', { name: '印鑑: 山田', exact: true })).toBeVisible();
  await expect(window.locator('.annotation img')).toHaveCount(2);
  await window.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  await expect(window.locator('.unsaved')).toHaveCount(0, { timeout: 30_000 });

  const saved = await PDFDocument.load(await fs.readFile(savedPath));
  assert.equal(saved.getPageCount(), 2);
  const objects = saved.getPage(0).node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  assert.ok(objects.keys().length >= 2, 'saved PDF contains the added name and seal');
  await window.screenshot({ path: path.join(output, 'desktop-editor.png'), fullPage: true });

  // Trigger real export, IPC, print preload, PDF.js and canvas rendering. The
  // printer call is intercepted before Windows/macOS can submit a print job.
  await window.getByRole('button', { name: '印刷', exact: true }).click();
  await expect.poll(async () => {
    try { return JSON.parse(await fs.readFile(printReportPath, 'utf8')); } catch { return null; }
  }, { timeout: 60_000, message: 'PDF rendered and reached the intercepted printer call' }).not.toBeNull();
  const printReport = JSON.parse(await fs.readFile(printReportPath, 'utf8'));
  assert.equal(printReport.mockedPrinterCall, true);
  assert.equal(printReport.options.silent, false);
  assert.equal(printReport.canvases.length, 2);
  assert.ok(printReport.canvases.every((canvas) => canvas.width > 800 && canvas.height > 1000 && canvas.ink > 200));
  await expect(window.locator('.busy-indicator')).toHaveCount(0, { timeout: 10_000 });

  // A newly printed PDF should pass the real inbox watcher and preload handshake.
  await fs.copyFile(savedPath, path.join(bridge.inbox, 'incoming-smoke.pdf'));
  await expect(window.locator('.document-name')).toContainText('incoming-smoke.pdf', { timeout: 15_000 });
  await expect(window.locator('.busy-indicator')).toHaveCount(0, { timeout: 10_000 });
  assert.deepEqual(pageErrors, [], 'renderer has no uncaught errors');
  assert.deepEqual(consoleErrors, [], 'renderer console has no errors');
  const summary = {
    result: 'passed', platform: process.platform,
    exercised: ['isolated Electron launch', 'sandbox/contextBridge', 'native open IPC', 'Japanese text + seal', 'native save IPC + parse saved PDF', 'print renderer + intercepted OS print call', 'print inbox watcher + incoming PDF IPC'],
    notExercised: ['physical printer', 'virtual printer installation/output', 'macOS PDF Services', 'live OpenAI API'],
    savedPdf: savedPath, screenshot: path.join(output, 'desktop-editor.png'), printReport: printReportPath,
  };
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(`Desktop smoke failed. Artifacts: ${output}`);
  console.error(JSON.stringify({ pageErrors, consoleErrors }, null, 2));
  if (application) {
    for (const [index, page] of application.windows().entries()) {
      try {
        console.error(JSON.stringify({ window: index, url: page.url(), alerts: await page.locator('[role="alert"], #progress').allTextContents() }));
        await page.screenshot({ path: path.join(output, `failed-window-${index}.png`) });
      } catch { /* A failed print window may already be closed. */ }
    }
  }
  throw error;
} finally {
  if (application) await application.close();
}
