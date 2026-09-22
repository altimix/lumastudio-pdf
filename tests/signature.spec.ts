import { expect, test } from '@playwright/test';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

test('証明書の確認を済ませるまで署名できず、閉じるとパスワードが残らない', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  await page.addInitScript(() => {
    const state = { inspectCount: 0, signCount: 0, passwordAccepted: false, pdfHeader: false, reason: '', location: '' };
    Object.defineProperty(window, 'signatureTest', { value: state });
    Object.defineProperty(window, 'lumaDesktop', { value: {
      onOpenPdf: () => () => {},
      getAiStatus: async () => ({ available: false, model: 'test' }),
      chooseCertificate: async () => ({ name: 'test-signature.p12' }),
      inspectCertificate: async (password: string) => {
        state.inspectCount++;
        if (password !== 'test-only-password') throw new Error('test incorrect password');
        return { subject: 'CN=Test Signer', issuer: 'CN=Test Signer', validFrom: '2026-01-01T00:00:00Z', validTo: '2028-01-01T00:00:00Z', fingerprint: 'AA:BB:CC:DD', selfSigned: true };
      },
      signAndSavePdf: async (bytes: number[], _name: string, options: { password: string; reason: string; location: string }) => {
        state.signCount++;
        state.passwordAccepted = options.password === 'test-only-password';
        state.pdfHeader = String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
        state.reason = options.reason; state.location = options.location;
        return true;
      },
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルの書類で試す' }).click();
  await page.getByTestId('pdf-surface').waitFor();
  await page.getByRole('button', { name: '署名して保存', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '電子署名して保存', exact: true });
  await expect(dialog).toContainText('印影のコピー自体を防ぐ機能ではありません');
  await expect(dialog.getByRole('button', { name: '電子署名してPDFを保存', exact: true })).toBeDisabled();
  await expect(dialog.locator('.signature-details')).toHaveCount(0);
  await dialog.getByRole('button', { name: '証明書ファイルを選ぶ', exact: true }).click();
  await dialog.getByLabel('証明書のパスワード', { exact: true }).fill('incorrect-test-value');
  await dialog.getByRole('button', { name: '証明書を確認', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('証明書を確認できませんでした');
  await expect(dialog.getByRole('button', { name: '電子署名してPDFを保存', exact: true })).toBeDisabled();
  await dialog.getByLabel('証明書のパスワード', { exact: true }).fill('test-only-password');
  await dialog.getByRole('button', { name: '証明書を確認', exact: true }).click();
  await expect(dialog.locator('.signature-details')).toContainText('CN=Test Signer');
  await expect(dialog).toContainText('受信側の信頼設定が必要');
  await expect(dialog.getByRole('button', { name: '電子署名してPDFを保存', exact: true })).toBeEnabled();
  // Editing the password must invalidate a successful inspection.
  await dialog.getByLabel('証明書のパスワード', { exact: true }).fill('new-test-value');
  await expect(dialog.getByRole('button', { name: '電子署名してPDFを保存', exact: true })).toBeDisabled();
  await dialog.getByLabel('証明書のパスワード', { exact: true }).fill('test-only-password');
  await dialog.getByRole('button', { name: '証明書を確認', exact: true }).click();
  await dialog.getByRole('textbox', { name: /署名の理由/ }).fill('内容確認のテスト');
  await dialog.getByRole('textbox', { name: /署名地/ }).fill('東京');
  await dialog.getByRole('button', { name: '電子署名してPDFを保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const state = await page.evaluate(() => (window as unknown as { signatureTest: Record<string, unknown> }).signatureTest);
  expect(state).toEqual({ inspectCount: 3, signCount: 1, passwordAccepted: true, pdfHeader: true, reason: '内容確認のテスト', location: '東京' });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-only-password');
  await page.getByRole('button', { name: '署名して保存', exact: true }).click();
  await expect(dialog.locator('.signature-details')).toHaveCount(0);
  await dialog.getByRole('button', { name: '証明書ファイルを選ぶ', exact: true }).click();
  await expect(dialog.getByLabel('証明書のパスワード', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '電子署名を閉じる', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('署名データのあるPDFは閲覧のみで開き、変更と再保存を無効にする', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 500]).drawText('SIGNED PDF READ-ONLY TEST', { x: 30, y: 430, size: 14 });
  const value = pdf.context.register(pdf.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', ByteRange: [0, 100, 200, 30], Contents: PDFHexString.of('010203') }));
  const field = pdf.context.register(pdf.context.obj({ FT: 'Sig', T: PDFString.of('TestSignature'), V: value }));
  pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.obj({ Fields: [field] }));
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'signed-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.signed-badge')).toHaveText('署名付きPDF・未検証');
  await expect(page.getByTestId('pdf-surface')).toBeVisible();
  await expect(page.getByRole('button', { name: '文字を記入', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '印鑑', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'AI自動記入', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'ページを右に回転', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '印刷', exact: true })).toBeEnabled();
  await expect(page.locator('.toast')).toContainText('有効性は未検証');
  await expect(page.locator('.toast')).toContainText('Acrobatなどで確認してください');
});
