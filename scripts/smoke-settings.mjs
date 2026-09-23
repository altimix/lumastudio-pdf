import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { expect } from '@playwright/test';

// Windows-only integration check of real Electron safeStorage (Windows DPAPI).
// No OS vault mock and no real API credentials. Run after npm run build.
if (process.platform !== 'win32') throw new Error('This smoke test requires Windows; macOS Keychain is not tested here.');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.access(path.join(repo, 'dist', 'index.html'));
await fs.mkdir(path.join(repo, 'tmp'), { recursive: true });
const output = await fs.mkdtemp(path.join(repo, 'tmp', 'settings-smoke-'));
const userData = path.join(output, 'user-data');
const documents = path.join(output, 'documents');
const missingEnv = path.join(output, 'intentionally-absent.env');
const bootstrap = path.join(output, 'bootstrap.cjs');
const settingsFile = path.join(userData, 'ai-settings.json');
const fakeKey = 'sk-local-test-only-not-a-real-openai-credential';
await Promise.all([fs.mkdir(userData), fs.mkdir(documents)]);
await fs.writeFile(bootstrap, `
const { app, session, dialog } = require('electron');
app.setPath('userData', ${JSON.stringify(userData)});
app.setPath('documents', ${JSON.stringify(documents)});
process.env.LUMA_ENV_PATH = ${JSON.stringify(missingEnv)};
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_MODEL;
globalThis.__settingsSmokeNetworkAttempts = 0;
globalThis.fetch = async () => {
  globalThis.__settingsSmokeNetworkAttempts++;
  throw new Error('Network access is disabled in the settings smoke test.');
};
dialog.showErrorBox = () => { throw new Error('Unexpected application startup error.'); };
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => {
    globalThis.__settingsSmokeNetworkAttempts++;
    callback({ cancel: true });
  });
});
require(${JSON.stringify(path.join(repo, 'electron', 'main.cjs'))});
`, 'utf8');

const env = { ...process.env, LUMA_ENV_PATH: missingEnv };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
delete env.OPENAI_API_KEY;
delete env.OPENAI_MODEL;
let application;
const pageErrors = [];
let blockedNetworkAttempts = 0;
async function launch() {
  application = await _electron.launch({ args: [bootstrap], cwd: repo, env, timeout: 60_000 });
  const page = await application.firstWindow({ timeout: 30_000 });
  page.on('pageerror', error => pageErrors.push(error.message));
  await expect(page.getByRole('button', { name: 'AI設定', exact: true })).toBeVisible({ timeout: 30_000 });
  const identity = await application.evaluate(({ app }) => ({ userData: app.getPath('userData'), documents: app.getPath('documents') }));
  assert.equal(path.resolve(identity.userData), userData);
  assert.equal(path.resolve(identity.documents), documents);
  return page;
}
async function close() {
  if (!application) return;
  blockedNetworkAttempts += await application.evaluate(() => globalThis.__settingsSmokeNetworkAttempts);
  await application.close();
  application = undefined;
}
function assertNoSecret(status) {
  assert.equal(JSON.stringify(status).includes(fakeKey), false, 'IPC status must not contain plaintext');
  assert.equal('key' in status || 'apiKey' in status || 'encryptedKey' in status, false, 'IPC status exposes no key material');
}

try {
  let page = await launch();
  const initial = await page.evaluate(() => window.lumaDesktop.getAiSettings());
  assertNoSecret(initial);
  assert.equal(initial.available, false);
  assert.equal(initial.canStore, true, 'Real Windows safeStorage must be available');
  assert.equal(initial.saved, false);
  assert.equal(initial.source, 'none');

  const saved = await page.evaluate(key => window.lumaDesktop.saveAiSettings({ key, model: 'gpt-6-sol' }), fakeKey);
  assertNoSecret(saved);
  assert.equal(saved.available, true);
  assert.equal(saved.saved, true);
  assert.equal(saved.source, 'saved');
  const rawFile = await fs.readFile(settingsFile, 'utf8');
  assert.equal(rawFile.includes(fakeKey), false, 'Persistence must not contain plaintext');
  const stored = JSON.parse(rawFile);
  assert.deepEqual(Object.keys(stored).sort(), ['encryptedKey', 'model', 'version']);
  assert.equal(stored.version, 2);
  assert.notEqual(stored.encryptedKey, Buffer.from(fakeKey).toString('base64'), 'Base64 encoding is not encryption');
  // Compare inside the main process; even this test never returns decrypted text.
  const decryptsCorrectly = await application.evaluate(async ({ safeStorage }, { encryptedKey, expected }) => {
    const encrypted = Buffer.from(encryptedKey, 'base64');
    const decoded = typeof safeStorage.decryptStringAsync === 'function'
      ? (await safeStorage.decryptStringAsync(encrypted)).result
      : safeStorage.decryptString(encrypted);
    return decoded === expected;
  }, { encryptedKey: stored.encryptedKey, expected: fakeKey });
  assert.equal(decryptsCorrectly, true);
  // A model-only save must keep the existing ciphertext without exposing or re-entering the key.
  const updated = await page.evaluate(() => window.lumaDesktop.saveAiSettings({ key: '', model: 'gpt-6-luna' }));
  assertNoSecret(updated);
  assert.equal(updated.model, 'gpt-6-luna');
  assert.equal(JSON.parse(await fs.readFile(settingsFile, 'utf8')).encryptedKey, stored.encryptedKey);
  await close();

  page = await launch();
  const reopened = await page.evaluate(() => window.lumaDesktop.getAiSettings());
  assertNoSecret(reopened);
  assert.equal(reopened.available, true);
  assert.equal(reopened.saved, true);
  assert.equal(reopened.source, 'saved');
  assert.equal(reopened.model, 'gpt-6-luna');
  assert.equal(reopened.warning, '');
  await page.getByRole('button', { name: 'AI設定', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AIの設定', exact: true });
  await expect(dialog).toContainText('この端末に保存した設定');
  await expect(dialog.getByLabel('OpenAI APIキー', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('利用モデル', { exact: true })).toHaveValue('gpt-6-luna');
  await page.screenshot({ path: path.join(output, 'reopened-settings.png'), fullPage: true });
  await dialog.getByRole('button', { name: '保存したAI設定を削除', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('保存したAI設定を削除しました');
  const removed = await page.evaluate(() => window.lumaDesktop.getAiSettings());
  assertNoSecret(removed);
  assert.equal(removed.available, false);
  assert.equal(removed.source, 'none');
  assert.equal(removed.saved, false);
  assert.equal(removed.hasStoredSettings, false);
  await assert.rejects(fs.access(settingsFile), { code: 'ENOENT' });
  assert.deepEqual(pageErrors, []);
  await close();
  assert.equal(blockedNetworkAttempts, 0, 'No API or network request was attempted');
  const report = {
    result: 'passed', platform: process.platform, encryption: 'real Electron safeStorage / Windows DPAPI',
    mockedEncryption: false, fakeCredentialsOnly: true, persistedPlaintext: false, decryptedComparisonPassed: true,
    restartRestoredSavedConfiguration: true, modelOnlyChangePreservedCiphertext: true, deletionRemovedCiphertextFile: true,
    blockedNetworkAttempts, pageErrors, output,
    notExercised: ['OpenAI authentication or autofill', 'macOS Keychain', 'packaged binary'],
  };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await close();
  // This run's isolated ciphertext is removed even if an assertion fails.
  assert.equal(path.dirname(settingsFile), userData);
  await fs.unlink(settingsFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
