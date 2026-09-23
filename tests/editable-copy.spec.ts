import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from '@playwright/test';

const fixture = (name: string) => path.join(process.cwd(), 'tests', 'fixtures', name);

test.beforeEach(async ({ context }) => {
  await context.route('https://api.openai.com/**', route => route.abort());
});

test('開くパスワードの誤入力を拒み、正しい入力から署名なしの編集用コピーを保存する', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(fixture('locked-open-password.pdf'));
  const dialog = page.getByRole('dialog', { name: '編集用コピーを作成' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('元の文字検索・リンク・フォーム欄・暗号化・電子署名は引き継がれません');
  const password = dialog.getByLabel('PDFを開くパスワード');
  await password.fill('wrong-test-only');
  await dialog.getByRole('button', { name: '編集用コピーを作成' }).click();
  await expect(dialog.getByRole('alert')).toContainText('パスワードが違います');
  await expect(password).toHaveValue('');
  await expect(page.getByTestId('pdf-surface')).toHaveCount(0);
  await password.fill('test-only-open');
  await dialog.getByRole('button', { name: '編集用コピーを作成' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('pdf-surface')).toBeVisible();
  await expect(page.getByText('locked-open-password_編集用コピー.pdf')).toBeVisible();
  await expect(page.getByRole('button', { name: '文字を記入', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-only-open');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const saved = await PDFDocument.load(await readFile(await (await download).path()));
  expect(saved.getPageCount()).toBe(1);
  expect(saved.getForm().getFields()).toHaveLength(0);
});

test('閲覧可能な編集制限PDFから原本を変えずに編集できるコピーを作る', async ({ page }) => {
  const file = fixture('locked-no-edit-permission.pdf');
  const before = await readFile(file);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(file);
  const dialog = page.getByRole('dialog', { name: '編集用コピーを作成' });
  await expect(dialog).toContainText('編集・保存の制限');
  await expect(dialog.getByLabel('PDFを開くパスワード')).toHaveCount(0);
  await dialog.getByRole('button', { name: '編集用コピーを作成' }).click();
  await expect(page.getByTestId('pdf-surface')).toBeVisible();
  await expect(page.getByText('locked-no-edit-permission_編集用コピー.pdf')).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled();
  expect(await readFile(file)).toEqual(before);
});

test('2ページと元の回転表示を編集用コピーのページ寸法に保持する', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(fixture('locked-rotated-two-pages.pdf'));
  const dialog = page.getByRole('dialog', { name: '編集用コピーを作成' });
  await dialog.getByRole('button', { name: '編集用コピーを作成' }).click();
  await expect(page.getByRole('button', { name: '2ページ目', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const saved = await PDFDocument.load(await readFile(await (await download).path()));
  expect(saved.getPageCount()).toBe(2);
  expect(saved.getPage(0).getSize().width).toBeCloseTo(595.28, 0);
  expect(saved.getPage(0).getSize().height).toBeCloseTo(841.89, 0);
  expect(saved.getPage(1).getSize().width).toBeCloseTo(841.89, 0);
  expect(saved.getPage(1).getSize().height).toBeCloseTo(595.28, 0);
});

test('署名情報付きPDFは閲覧専用を保ち、明示操作で署名なしのコピーにする', async ({ page }) => {
  const file = fixture('signed-test-only.pdf');
  const before = await readFile(file);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(file);
  await expect(page.getByText('署名付きPDF・未検証')).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '編集用コピー', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '編集用コピーを作成' });
  await expect(dialog).toContainText('署名を保持したまま編集することはできません');
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByText('署名付きPDF・未検証')).toBeVisible();
  await page.getByRole('button', { name: '編集用コピー', exact: true }).click();
  await dialog.getByRole('button', { name: '編集用コピーを作成' }).click();
  await expect(page.getByText('署名付きPDF・未検証')).toHaveCount(0);
  await expect(page.getByText('signed-test-only_編集用コピー.pdf')).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const saved = await PDFDocument.load(await readFile(await (await download).path()));
  expect(saved.getPageCount()).toBe(1);
  expect(saved.getForm().getFields()).toHaveLength(0);
  expect(await readFile(file)).toEqual(before);
});

test('編集用コピーの確認中に背後のPDFを保存・印刷・Undo・削除しない', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([500, 700]);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'editing.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByTestId('pdf-surface')).toBeVisible();
  await page.getByRole('button', { name: 'チェック', exact: true }).click();
  await page.getByTestId('pdf-surface').click({ position: { x: 150, y: 180 } });
  await expect(page.locator('.annotation')).toHaveCount(1);
  page.on('dialog', dialog => dialog.accept());
  await page.getByTestId('pdf-input').setInputFiles(fixture('locked-no-edit-permission.pdf'));
  const dialog = page.getByRole('dialog', { name: '編集用コピーを作成' });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => { window.print = () => { document.body.dataset.printCalled = 'yes'; }; });
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await dialog.getByRole('button', { name: '編集用コピーを作成' }).focus();
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.press('ControlOrMeta+p');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('Delete');
  await expect(dialog).toBeVisible();
  await expect(page.locator('.annotation')).toHaveCount(1);
  await expect(page.locator('body')).not.toHaveAttribute('data-print-called', 'yes');
  await page.waitForTimeout(200);
  expect(downloads).toBe(0);
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.locator('.annotation')).toHaveCount(1);
});
