import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function openPages(page: Page) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const title of ['FIRST', 'SECOND', 'THIRD']) {
    const sheet = pdf.addPage([500, 700]);
    sheet.drawText(title, { x: 40, y: 640, font, size: 20 });
  }
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({
    name: 'page-controls.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByTestId('pdf-surface')).toBeVisible();
}

test('ページ操作をPDFの上に出し、不要な右案内をページ情報へ置き換える', async ({ page }) => {
  await openPages(page);
  const controls = page.getByRole('group', { name: 'このページの操作' });
  await expect(controls).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ページ情報' })).toBeVisible();
  await expect(page.getByText('必要事項を記入')).toHaveCount(0);
  await expect(page.getByText('保存して返送')).toHaveCount(0);
  await expect(controls.getByRole('button', { name: 'ページを前へ' })).toBeDisabled();
  await controls.getByRole('button', { name: 'ページを後ろへ' }).click();
  await expect(controls.getByRole('button', { name: 'ページを前へ' })).toBeEnabled();
  const before = await page.getByTestId('pdf-surface').boundingBox();
  await controls.getByRole('button', { name: 'ページを右に回転' }).click();
  const after = await page.getByTestId('pdf-surface').boundingBox();
  expect(before && after && Math.abs(after.width - before.width) > 50).toBe(true);
  await controls.getByRole('button', { name: 'ページを削除' }).click();
  await expect(page.getByRole('heading', { name: 'ページ 2' })).toBeVisible();
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(page.getByRole('heading', { name: 'ページ 3' })).toBeVisible();
  const unchangedPosition = await page.getByTestId('pdf-surface').boundingBox();
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文字を記入' })).toBeVisible();
  const afterTool = await page.getByTestId('pdf-surface').boundingBox();
  expect(unchangedPosition && afterTool && Math.abs(unchangedPosition.x - afterTool.x) < 1).toBe(true);
  await page.getByRole('button', { name: '選択・移動', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ページ情報' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI自動記入', exact: true })).toBeEnabled();
});

test('狭い画面でもページ操作が用紙の上で折り返して使える', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPages(page);
  const controls = page.getByRole('group', { name: 'このページの操作' });
  await expect(controls.getByRole('button', { name: 'ページを右に回転' })).toBeVisible();
  const deleteButton = controls.getByRole('button', { name: 'ページを削除' });
  await expect(deleteButton).toBeVisible();
  const bounds = await deleteButton.boundingBox();
  expect(bounds && bounds.x + bounds.width <= 390).toBe(true);
});
