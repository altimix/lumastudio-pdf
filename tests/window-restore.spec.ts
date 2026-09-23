import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('最大化と全画面表示で戻すボタンを出し、Escとクリックで通常サイズに戻す', async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = new Set<(state: { maximized: boolean; fullScreen: boolean }) => void>();
    const state = { maximized: false, fullScreen: false, restores: 0 };
    const emit = () => listeners.forEach(callback => callback({ maximized: state.maximized, fullScreen: state.fullScreen }));
    Object.defineProperty(window, 'windowStateTest', { value: {
      set(maximized: boolean, fullScreen: boolean) { state.maximized = maximized; state.fullScreen = fullScreen; emit(); },
      get restores() { return state.restores; },
    } });
    Object.defineProperty(window, 'lumaDesktop', { value: {
      onOpenPdf: () => () => {},
      getAiStatus: async () => ({ available: false, model: 'gpt-6-sol' }),
      getWindowState: async () => ({ maximized: state.maximized, fullScreen: state.fullScreen }),
      onWindowStateChange: (callback: (value: { maximized: boolean; fullScreen: boolean }) => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      restoreWindow: async () => { state.restores++; state.maximized = false; state.fullScreen = false; emit(); },
    } });
  });
  await page.goto('/');
  const restore = page.getByRole('button', { name: '元のサイズに戻す' });
  await expect(restore).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & { windowStateTest: { set(maximized: boolean, fullScreen: boolean): void } }).windowStateTest.set(true, false));
  await expect(restore).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('window-restore-control.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(restore).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & { windowStateTest: { set(maximized: boolean, fullScreen: boolean): void } }).windowStateTest.set(false, true));
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(restore).toHaveCount(0);
  const pdf = await PDFDocument.create();
  pdf.addPage([500, 700]);
  await page.getByTestId('pdf-input').setInputFiles({ name: 'window-state.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByTestId('pdf-surface')).toBeVisible();
  await page.evaluate(() => (window as typeof window & { windowStateTest: { set(maximized: boolean, fullScreen: boolean): void } }).windowStateTest.set(true, false));
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByTestId('pdf-surface').click({ position: { x: 100, y: 150 } });
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await input.fill('入力中');
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(restore).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(restore).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { windowStateTest: { restores: number } }).windowStateTest.restores)).toBe(3);
});
