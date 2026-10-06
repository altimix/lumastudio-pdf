import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

async function installDraftDesktop(page: Page) {
  await page.route('**/api/**', route => route.abort());
  await page.route('https://api.openai.com/**', route => route.abort());
  await page.addInitScript(() => {
    const state = { signOutcome: 'saved', projectOutcome: 'saved', signCount: 0, project: [] as number[], closeResults: [] as boolean[] };
    Object.defineProperty(window, 'draftTest', { value: state });
    Object.defineProperty(window, 'lumaDesktop', { value: {
      onOpenPdf: () => () => {},
      getAiStatus: async () => ({ available: false, model: 'test' }),
      chooseCertificate: async () => ({ name: 'draft-TEST-ONLY.p12' }),
      inspectCertificate: async () => ({ subject: 'CN=Draft TEST ONLY', issuer: 'CN=Draft TEST ONLY', validFrom: '2026-01-01T00:00:00Z', validTo: '2028-01-01T00:00:00Z', fingerprint: 'TEST', selfSigned: true }),
      signAndSavePdf: async () => {
        if (state.signOutcome === 'failed') throw new Error('署名テストの保存失敗');
        if (state.signOutcome === 'canceled') return false;
        state.signCount++;
        return true;
      },
      saveProject: async (bytes: Uint8Array) => {
        if (state.projectOutcome === 'failed') throw new Error('原稿テストの保存失敗');
        if (state.projectOutcome === 'canceled') return false;
        state.project = Array.from(bytes);
        return true;
      },
      savePdf: async () => true,
      onSaveAndClose: (callback: unknown) => {
        Object.assign(window, { draftSaveAndClose: callback });
        return () => {};
      },
      finishCloseSave: async (saved: boolean) => { state.closeResults.push(saved); return saved; },
    } });
  });
}

async function writeDraft(page: Page, text = '署名前の編集用原稿') {
  await page.getByRole('button', { name: 'サンプルの書類で試す' }).click();
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('記入する文字').fill(text);
  await page.getByTestId('pdf-surface').click({ position: { x: 160, y: 230 } });
  await expect(page.getByRole('button', { name: `文字: ${text}`, exact: true })).toBeVisible();
}

async function signDraft(page: Page) {
  await page.getByRole('button', { name: '署名して保存', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '電子署名して保存', exact: true });
  await dialog.getByRole('button', { name: '証明書ファイルを選ぶ', exact: true }).click();
  await dialog.getByLabel('証明書のパスワード', { exact: true }).fill('TEST-ONLY');
  await dialog.getByRole('button', { name: '証明書を確認', exact: true }).click();
  await dialog.getByRole('button', { name: '電子署名してPDFを保存', exact: true }).click();
  return dialog;
}

async function setDraftOutcome(page: Page, key: string, outcome: string) {
  await page.evaluate(({ key, outcome }) => {
    const state = (window as unknown as { draftTest: Record<string, unknown> }).draftTest;
    state[key] = outcome;
  }, { key, outcome });
}

test('署名後も未保存原稿を保護し、原稿保存のキャンセル・失敗を経ても再開できる', async ({ page }, info) => {
  await installDraftDesktop(page);
  await page.goto('/');
  await writeDraft(page);
  await expect(await signDraft(page)).not.toBeVisible();
  await expect(page.locator('.unsaved')).toHaveCount(1);
  const notice = page.getByRole('status', { name: '編集用原稿の保存', exact: true });
  await expect(notice).toContainText('編集用原稿は未保存');
  await page.screenshot({ path: info.outputPath('signed-draft-unsaved.png') });
  await page.getByRole('button', { name: '文字: 署名前の編集用原稿', exact: true }).click();
  await page.getByRole('button', { name: '文字: 署名前の編集用原稿', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(notice).toBeVisible();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  const other = await PDFDocument.create(); other.addPage();
  const dialogs: string[] = [];
  page.once('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.getByTestId('pdf-input').setInputFiles({ name: 'next.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await other.save()) });
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('保存していない変更');
  await expect(page.getByRole('button', { name: '文字: 署名前の編集用原稿', exact: true })).toBeVisible();
  await notice.getByRole('button', { name: '編集用原稿を保存', exact: true }).click();
  const project = page.getByRole('dialog', { name: '編集の続きを保存・再開', exact: true });
  const save = project.getByRole('button', { name: '作業データを保存', exact: true });
  await setDraftOutcome(page, 'projectOutcome', 'canceled');
  await save.click(); await expect(project).toBeVisible();
  await expect(page.locator('.unsaved')).toHaveCount(1);
  await setDraftOutcome(page, 'projectOutcome', 'failed');
  await save.click(); await expect(project).toContainText('原稿テストの保存失敗');
  await expect(page.locator('.unsaved')).toHaveCount(1);
  await setDraftOutcome(page, 'projectOutcome', 'saved');
  await save.click(); await expect(project).not.toBeVisible();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  const saved = await page.evaluate(() => (window as unknown as { draftTest: { project: number[]; signCount: number } }).draftTest);
  expect(saved.signCount).toBe(1);
  await page.reload();
  await page.getByTestId('project-input').setInputFiles({ name: 'signed-draft.lumapdf', mimeType: 'application/json', buffer: Buffer.from(saved.project) });
  const annotation = page.getByRole('button', { name: '文字: 署名前の編集用原稿', exact: true });
  await expect(annotation).toBeVisible({ timeout: 30_000 });
  await annotation.dblclick();
  await page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true }).fill('再開後に修正した原稿');
  await page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true }).press('ControlOrMeta+Enter');
  await expect(page.getByRole('button', { name: '文字: 再開後に修正した原稿', exact: true })).toBeVisible();
});

test('保存済み原稿の署名では未保存警告を増やさず、署名のキャンセル・失敗で保存状態を変えない', async ({ page }) => {
  await installDraftDesktop(page); await page.goto('/'); await writeDraft(page);
  await page.getByRole('button', { name: '作業データ', exact: true }).click();
  await page.getByRole('dialog', { name: '編集の続きを保存・再開' }).getByRole('button', { name: '作業データを保存', exact: true }).click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await expect(await signDraft(page)).not.toBeVisible();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await expect(page.getByRole('status', { name: '編集用原稿の保存', exact: true })).toHaveCount(0);
  await setDraftOutcome(page, 'signOutcome', 'canceled');
  const canceled = await signDraft(page);
  await expect(canceled.getByRole('alert')).toContainText('電子署名付きPDFを保存できませんでした');
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await canceled.getByRole('button', { name: '電子署名を閉じる', exact: true }).click();
  await page.getByRole('button', { name: '文字: 署名前の編集用原稿', exact: true }).click();
  await page.getByRole('button', { name: '文字: 署名前の編集用原稿', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.unsaved')).toHaveCount(1);
  await setDraftOutcome(page, 'signOutcome', 'failed');
  const failed = await signDraft(page);
  await expect(failed.getByRole('alert')).toContainText('電子署名付きPDFを保存できませんでした');
  await expect(page.locator('.unsaved')).toHaveCount(1);
  await failed.getByRole('button', { name: '電子署名を閉じる', exact: true }).click();
  await setDraftOutcome(page, 'signOutcome', 'saved');
  await expect(await signDraft(page)).not.toBeVisible();
  await setDraftOutcome(page, 'projectOutcome', 'canceled');
  await page.evaluate(async () => {
    await (window as unknown as { draftSaveAndClose(format: string): Promise<void> }).draftSaveAndClose('project');
  });
  await expect(page.locator('.unsaved')).toHaveCount(1);
  await setDraftOutcome(page, 'projectOutcome', 'saved');
  await page.evaluate(async () => {
    await (window as unknown as { draftSaveAndClose(format: string): Promise<void> }).draftSaveAndClose('project');
  });
  expect(await page.evaluate(() => (window as unknown as { draftTest: { closeResults: boolean[] } }).draftTest.closeResults)).toEqual([false, true]);
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await page.getByRole('button', { name: '文字: 署名前の編集用原稿', exact: true }).click();
  await page.getByRole('button', { name: '文字: 署名前の編集用原稿', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await expect(await signDraft(page)).not.toBeVisible();
  await expect(page.locator('.unsaved')).toHaveCount(0);
  await expect(page.getByRole('status', { name: '編集用原稿の保存', exact: true })).toHaveCount(0);
});

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
  await expect(page.locator('.signed-badge')).toHaveText('署名付きPDF・未検証', { timeout: 30_000 });
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '文字を記入', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '印鑑', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'AI自動記入', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'ページを右に回転', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '印刷', exact: true })).toBeEnabled();
  await expect(page.locator('.toast')).toContainText('有効性は未検証');
  await expect(page.locator('.toast')).toContainText('Acrobatなどで確認してください');
});
