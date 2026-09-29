import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

test('以前の50MB上限を超えるPDFを画面で開ける', async ({ page }, testInfo) => {
  const document = await PDFDocument.create();
  document.addPage([595, 842]);
  const source = Buffer.from(await document.save());
  const large = Buffer.concat([source, Buffer.alloc(51 * 1024 * 1024, 32), Buffer.from('\n%%EOF\n')]);
  const file = testInfo.outputPath('51mb.pdf');
  await writeFile(file, large);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles(file);
  await expect(page.locator('.document-name')).toContainText('51mb.pdf', { timeout: 30_000 });
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled();
});
