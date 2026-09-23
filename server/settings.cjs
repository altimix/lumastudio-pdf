'use strict';

// Desktop main process only. API keys never return to the renderer or logs.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_AI_MODEL, isSupportedAiModel, normalizeAiModel } = require('./ai-models.cjs');

async function createAiSettings({ directory, safeStorage, createAutofill, envPath, platform = process.platform }) {
  const filename = path.join(directory, 'ai-settings.json');
  const environment = createAutofill({ envPath });
  let active = environment;
  let saved = false;
  let encryptedKey = null;
  let hasStoredSettings = false;
  let warning = '';
  let queue = Promise.resolve();
  const exclusive = (action) => { const next = queue.then(action); queue = next.catch(() => {}); return next; };
  const available = async () => {
    if (platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
    return typeof safeStorage.isAsyncEncryptionAvailable === 'function'
      ? safeStorage.isAsyncEncryptionAvailable()
      : safeStorage.isEncryptionAvailable();
  };
  const encrypt = (value) => typeof safeStorage.encryptStringAsync === 'function'
    ? safeStorage.encryptStringAsync(value) : safeStorage.encryptString(value);
  const decrypt = async (value) => typeof safeStorage.decryptStringAsync === 'function'
    ? (await safeStorage.decryptStringAsync(value)).result : safeStorage.decryptString(value);
  function validateKey(key) {
    if (typeof key !== 'string' || key.trim().length < 20 || key.length > 1024 || /\s/.test(key.trim())) throw new Error('APIキーを確認してください。キーだけを入力してください。');
    return key.trim();
  }
  function validateModel(model) {
    if (typeof model !== 'string' || !isSupportedAiModel(model)) throw new Error('モデルはGPT-6 SolまたはGPT-6 Lunaを選んでください。');
    return model;
  }
  const service = (key, model) => createAutofill({ env: { OPENAI_API_KEY: key, OPENAI_MODEL: model } });
  const write = async (data) => {
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `ai-settings-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, filename);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  };
  try {
    const stat = await fs.stat(filename);
    hasStoredSettings = true;
    if (!stat.isFile() || stat.size > 32 * 1024) throw new Error('invalid');
    const data = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (![1, 2].includes(data.version) || typeof data.model !== 'string') throw new Error('invalid');
    const model = data.version === 1 ? normalizeAiModel(data.model) : validateModel(data.model);
    if (typeof data.encryptedKey === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(data.encryptedKey)) {
      if (!(await available())) throw new Error('unavailable');
      const key = validateKey(await decrypt(Buffer.from(data.encryptedKey, 'base64')));
      active = service(key, model); saved = true; encryptedKey = data.encryptedKey;
    } else if (data.version === 2 && data.encryptedKey === undefined) {
      active = environment.withModel(model);
    } else throw new Error('invalid');
  } catch (error) {
    if (error?.code !== 'ENOENT') { hasStoredSettings = true; warning = '保存したAI設定を読み込めませんでした。必要ならAPIキーを登録し直してください。'; }
  }
  const status = () => ({
    ...active.getAiStatus(), source: saved ? 'saved' : environment.getAiStatus().available ? 'environment' : 'none',
    saved, hasStoredSettings, warning,
  });
  return {
    getAiStatus: () => active.getAiStatus(),
    autofill: (payload) => active.autofill(payload),
    async getSettings() { return { ...status(), canStore: await available() }; },
    save: (input) => exclusive(async () => {
      if (!(await available())) throw new Error('この環境ではAPIキーを安全に保存できません。OSの保管機能を確認してください。');
      const model = validateModel(input?.model ?? DEFAULT_AI_MODEL);
      if (typeof input?.key !== 'string') throw new Error('APIキーを確認してください。');
      let next, nextEncryptedKey = null;
      if (input.key.trim()) {
        const key = validateKey(input.key);
        let encrypted;
        try { encrypted = await encrypt(key); }
        catch { throw new Error('OSの保管機能で暗号化できませんでした。設定は変更していません。'); }
        nextEncryptedKey = encrypted.toString('base64');
        next = service(key, model);
      } else if (saved && encryptedKey) {
        next = active.withModel(model);
        nextEncryptedKey = encryptedKey;
      } else {
        next = environment.withModel(model);
      }
      try { await write({ version: 2, model, ...(nextEncryptedKey ? { encryptedKey: nextEncryptedKey } : {}) }); }
      catch { throw new Error('設定を保存できませんでした。書き込み先の空き容量とアクセス権を確認してください。'); }
      active = next; saved = Boolean(nextEncryptedKey); encryptedKey = nextEncryptedKey; hasStoredSettings = true; warning = '';
      return status();
    }),
    remove: () => exclusive(async () => {
      try { await fs.unlink(filename); }
      catch (error) { if (error?.code !== 'ENOENT') throw new Error('保存設定を削除できませんでした。'); }
      active = environment; saved = false; encryptedKey = null; hasStoredSettings = false; warning = '';
      return status();
    }),
  };
}

module.exports = { createAiSettings };
