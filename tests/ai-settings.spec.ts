import { expect, test, type Page } from '@playwright/test';

const FAKE_KEY = 'sk-fixture-api-settings-never-a-real-credential';

async function desktopFixture(page: Page, options: { canStore?: boolean; saved?: boolean; failSave?: boolean; corrupt?: boolean } = {}) {
  await page.addInitScript(({ options, fakeKey }) => {
    const fallback = { available: true, model: 'gpt-6-sol', source: 'environment' as const, saved: false, warning: '' };
    let current = options.saved ? { ...fallback, model: 'gpt-6-luna', source: 'saved' as 'saved' | 'environment', saved: true } : fallback;
    let hasStoredSettings = Boolean(options.saved || options.corrupt);
    if (options.corrupt) current = { ...current, warning: '保存したAI設定を読み込めませんでした。必要ならAPIキーを登録し直してください。' };
    const state = { saveCalls: 0, modelOnlySaves: 0, removeCalls: 0, receivedExpectedKey: false, savedModel: '' };
    Object.defineProperty(window, 'aiSettingsTest', { value: state });
    Object.defineProperty(window, 'lumaDesktop', { value: {
      onOpenPdf: () => () => {},
      getAiStatus: async () => ({ available: current.available, model: current.model }),
      getAiSettings: async () => ({ ...current, hasStoredSettings, canStore: options.canStore ?? true }),
      saveAiSettings: async ({ key, model }: { key: string; model: string }) => {
        state.saveCalls++;
        if (!key) state.modelOnlySaves++;
        state.receivedExpectedKey = key === fakeKey;
        if (options.failSave) throw new Error(`Raw backend diagnostic must not reach the UI: ${fakeKey}`);
        state.savedModel = model;
        current = { ...current, source: key || current.saved ? 'saved' : 'environment', model, saved: Boolean(key || current.saved) };
        hasStoredSettings = true;
        return { ...current, hasStoredSettings };
      },
      removeAiSettings: async () => {
        state.removeCalls++;
        current = fallback;
        hasStoredSettings = false;
        return { ...current, hasStoredSettings };
      },
    } });
  }, { options, fakeKey: FAKE_KEY });
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'AI設定', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AIの設定', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ context }) => {
  await context.route('**/api/**', route => route.abort());
  await context.route('https://api.openai.com/**', route => route.abort());
});

test('デスクトップのAI設定はキーを伏せて受け渡し、保存後と再表示時に入力を残さない', async ({ page }) => {
  await desktopFixture(page);
  await page.goto('/');
  const dialog = await openSettings(page);
  await expect(dialog).toContainText('既存の環境設定');
  const key = dialog.getByLabel('OpenAI APIキー', { exact: true });
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveAttribute('autocomplete', 'off');
  await expect(key).toHaveValue('');
  await expect(dialog.getByLabel('利用モデル', { exact: true })).toHaveValue('gpt-6-sol');
  await expect(dialog.getByLabel('利用モデル', { exact: true }).locator('option')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: 'この端末に保存', exact: true })).toBeDisabled();
  await key.fill(FAKE_KEY);
  await dialog.getByLabel('利用モデル', { exact: true }).selectOption('gpt-6-luna');
  await dialog.getByRole('button', { name: 'この端末に保存', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('設定を保存しました');
  await expect(key).toHaveValue('');
  await expect(dialog).toContainText('この端末に保存した設定');
  expect(await dialog.innerText()).not.toContain(FAKE_KEY);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(FAKE_KEY);
  expect(await page.evaluate(() => (window as unknown as { aiSettingsTest: unknown }).aiSettingsTest)).toEqual({
    saveCalls: 1, modelOnlySaves: 0, removeCalls: 0, receivedExpectedKey: true, savedModel: 'gpt-6-luna',
  });
  await dialog.getByRole('button', { name: 'AI設定を閉じる', exact: true }).click();
  await openSettings(page);
  await expect(key).toHaveValue('');
  await expect(dialog.getByLabel('利用モデル', { exact: true })).toHaveValue('gpt-6-luna');
  await key.fill('sk-unsaved-fixture-will-be-discarded');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await openSettings(page);
  await expect(key).toHaveValue('');
});

test('保存したキーのモデルだけを変更し、削除すると環境設定へ戻る', async ({ page }) => {
  await desktopFixture(page, { saved: true });
  await page.goto('/');
  const dialog = await openSettings(page);
  const model = dialog.getByLabel('利用モデル', { exact: true });
  await expect(model).toHaveValue('gpt-6-luna');
  await model.selectOption('gpt-6-sol');
  await dialog.getByRole('button', { name: 'この端末に保存', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('利用モデルを保存しました');
  await expect(dialog.getByLabel('OpenAI APIキー', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => (window as unknown as { aiSettingsTest: { modelOnlySaves: number } }).aiSettingsTest.modelOnlySaves)).toBe(1);
  await dialog.getByRole('button', { name: '保存したAI設定を削除', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('既存の環境設定に戻しました');
  await expect(model).toHaveValue('gpt-6-sol');
  await expect(dialog.getByLabel('OpenAI APIキー', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '保存したAI設定を削除', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { aiSettingsTest: { removeCalls: number } }).aiSettingsTest.removeCalls)).toBe(1);
});

test('環境設定のキーを使いながらモデルの選択だけを保存できる', async ({ page }) => {
  await desktopFixture(page);
  await page.goto('/');
  const dialog = await openSettings(page);
  await dialog.getByLabel('利用モデル', { exact: true }).selectOption('gpt-6-luna');
  await dialog.getByRole('button', { name: 'この端末に保存', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('利用モデルを保存しました');
  await expect(dialog).toContainText('既存の環境設定');
  await expect(dialog.getByRole('button', { name: '保存したAI設定を削除', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '保存したAI設定を削除', exact: true }).click();
  await expect(dialog.getByLabel('利用モデル', { exact: true })).toHaveValue('gpt-6-sol');
});

test('OSの暗号化を利用できない環境ではキーの登録を無効にする', async ({ page }) => {
  await desktopFixture(page, { canStore: false });
  await page.goto('/');
  const dialog = await openSettings(page);
  await expect(dialog).toContainText('この環境ではAI設定を安全に保存できません');
  await expect(dialog.getByLabel('OpenAI APIキー', { exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'この端末に保存', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { aiSettingsTest: { saveCalls: number } }).aiSettingsTest.saveCalls)).toBe(0);
});

test('保存エラーで機密を含み得る内部エラーを表示せず設定状態を維持する', async ({ page }) => {
  await desktopFixture(page, { failSave: true });
  await page.goto('/');
  const dialog = await openSettings(page);
  await dialog.getByLabel('OpenAI APIキー', { exact: true }).fill(FAKE_KEY);
  await dialog.getByRole('button', { name: 'この端末に保存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('保存できませんでした');
  expect(await dialog.innerText()).not.toContain(FAKE_KEY);
  expect(await dialog.innerText()).not.toContain('Raw backend diagnostic');
  await expect(dialog).toContainText('既存の環境設定');
  await expect(dialog.getByRole('button', { name: '保存したAI設定を削除', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'AI設定を閉じる', exact: true })).toBeEnabled();
});

test('暗号化された保存設定を読み込めない場合でも端末から削除できる', async ({ page }) => {
  await desktopFixture(page, { corrupt: true, canStore: false });
  await page.goto('/');
  const dialog = await openSettings(page);
  await expect(dialog).toContainText('保存したAI設定を読み込めませんでした');
  await expect(dialog.getByLabel('OpenAI APIキー', { exact: true })).toBeDisabled();
  const remove = dialog.getByRole('button', { name: '保存したAI設定を削除', exact: true });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(dialog.getByRole('status')).toContainText('既存の環境設定に戻しました');
  await expect(dialog).not.toContainText('保存したAI設定を読み込めませんでした');
  await expect(remove).toBeDisabled();
});

test('ブラウザー版はキー入力を表示せずデスクトップ版での設定を案内する', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  await expect(dialog).toContainText('APIキーの登録はデスクトップ版で行えます');
  await expect(dialog.getByLabel('OpenAI APIキー', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'この端末に保存', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'AI設定を閉じる', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
