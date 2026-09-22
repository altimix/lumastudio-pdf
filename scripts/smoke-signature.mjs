import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { expect } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import forge from 'node-forge';

// Uses a newly generated, clearly labeled TEST ONLY RSA identity. No personal
// certificates, no trust-chain assertion, no network, and no OpenAI API calls.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await fs.access(path.join(repo, 'dist', 'index.html'));
await fs.mkdir(path.join(repo, 'tmp'), { recursive: true });
const output = await fs.mkdtemp(path.join(repo, 'tmp', 'signature-smoke-'));
const userData = path.join(output, 'user-data');
const documents = path.join(output, 'documents');
await Promise.all([fs.mkdir(userData), fs.mkdir(documents)]);
const certificatePath = path.join(output, 'integration-TEST-ONLY.p12');
const signedPath = path.join(output, 'synthetic-signed-TEST-ONLY.pdf');
const bootstrapPath = path.join(output, 'bootstrap.cjs');
const password = 'local-integration-test-only';
const keys = forge.pki.rsa.generateKeyPair(2048);
const certificate = forge.pki.createCertificate();
certificate.publicKey = keys.publicKey;
certificate.serialNumber = '019001';
certificate.validity.notBefore = new Date(Date.now() - 3_600_000);
certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
certificate.setSubject([{ name: 'commonName', value: 'LumaStudio Integration TEST ONLY' }]);
certificate.setIssuer(certificate.subject.attributes);
certificate.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, nonRepudiation: true }]);
certificate.sign(keys.privateKey, forge.md.sha256.create());
const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], password, { algorithm: 'aes256', count: 2048, generateLocalKeyId: true });
await fs.writeFile(certificatePath, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));

await fs.writeFile(bootstrapPath, `
const { app, dialog } = require('electron');
app.setPath('userData', ${JSON.stringify(userData)});
app.setPath('documents', ${JSON.stringify(documents)});
dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [
  options.filters[0].extensions.includes('p12') ? ${JSON.stringify(certificatePath)} : ${JSON.stringify(signedPath)}
] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(signedPath)} });
dialog.showMessageBoxSync = () => 1;
require(${JSON.stringify(path.join(repo, 'electron', 'main.cjs'))});
`, 'utf8');

function verifySignedPdf(bytes) {
  const match = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/u.exec(bytes.toString('latin1'));
  assert.ok(match, 'the exported PDF has a signature ByteRange');
  const [start, firstLength, secondStart, secondLength] = match.slice(1).map(Number);
  assert.equal(start, 0); assert.equal(secondStart + secondLength, bytes.length);
  assert.ok(firstLength < secondStart);
  const signedBytes = Buffer.concat([bytes.subarray(0, firstLength), bytes.subarray(secondStart)]);
  const raw = Buffer.from(bytes.subarray(firstLength + 1, secondStart - 1).toString('ascii'), 'hex');
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(raw.toString('binary')), { strict: true, parseAllBytes: false });
  const signerInfo = asn1.value[1].value[0].value.at(-1).value[0];
  const attributes = signerInfo.value[3];
  const messageDigest = attributes.value.find((attribute) => forge.asn1.derToOid(attribute.value[0].value) === forge.pki.oids.messageDigest);
  assert.ok(messageDigest);
  assert.ok(createHash('sha256').update(signedBytes).digest().equals(Buffer.from(messageDigest.value[1].value[0].value, 'binary')), 'PDF bytes match the authenticated digest');
  const attributeDer = Buffer.from(forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attributes.value)).getBytes(), 'binary');
  const signature = Buffer.from(signerInfo.value[5].value, 'binary');
  assert.equal(verify('RSA-SHA256', attributeDer, forge.pki.publicKeyToPem(keys.publicKey), signature), true, 'CMS signature matches the generated test certificate');
  return { completeByteRange: true, sha256DigestValid: true, cmsSignatureValid: true, trustChainVerified: false };
}

const env = { ...process.env, LUMA_ENV_PATH: path.join(output, 'no-ai-key.env') };
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL; delete env.OPENAI_API_KEY;
let application;
const pageErrors = [];
const consoleErrors = [];
try {
  application = await _electron.launch({ args: [bootstrapPath], cwd: repo, env, timeout: 60_000 });
  const window = await application.firstWindow({ timeout: 60_000 });
  window.on('pageerror', (error) => pageErrors.push(error.message));
  window.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await window.getByRole('button', { name: 'サンプルの書類で試す' }).click();
  const surface = window.getByTestId('pdf-surface');
  await expect(surface).toBeVisible({ timeout: 30_000 });
  await expect(window.locator('.busy-indicator')).toHaveCount(0);
  await window.getByRole('button', { name: '文字を記入', exact: true }).click();
  await window.getByLabel('記入する文字').fill('架空の署名テスト');
  await surface.click({ position: { x: 180, y: 230 } });
  await expect(window.getByRole('button', { name: '文字: 架空の署名テスト', exact: true })).toBeVisible();
  await window.getByRole('button', { name: '署名して保存', exact: true }).click();
  const signatureDialog = window.getByRole('dialog', { name: '電子署名して保存', exact: true });
  await expect(signatureDialog).toBeVisible();
  await signatureDialog.getByRole('button', { name: '証明書ファイルを選ぶ', exact: true }).click();
  await expect(signatureDialog.getByText('integration-TEST-ONLY.p12', { exact: true })).toBeVisible();
  await signatureDialog.getByLabel('証明書のパスワード', { exact: true }).fill('wrong-test-password');
  await signatureDialog.getByRole('button', { name: '証明書を確認', exact: true }).click();
  await expect(signatureDialog.getByRole('alert')).toContainText('証明書を確認できませんでした');
  await expect(signatureDialog.getByRole('button', { name: '電子署名してPDFを保存', exact: true })).toBeDisabled();
  await signatureDialog.getByLabel('証明書のパスワード', { exact: true }).fill(password);
  await signatureDialog.getByRole('button', { name: '証明書を確認', exact: true }).click();
  await expect(signatureDialog.getByText('証明書を読み込みました', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(signatureDialog.locator('.signature-details')).toContainText('LumaStudio Integration TEST ONLY');
  await expect(signatureDialog.locator('.signature-self-signed')).toContainText('自己署名証明書');
  await signatureDialog.getByLabel('署名の理由', { exact: false }).fill('デスクトップ統合テスト');
  await signatureDialog.getByLabel('署名地', { exact: false }).fill('架空のテスト環境');
  await window.screenshot({ path: path.join(output, 'certificate-dialog-TEST-ONLY.png'), fullPage: true });
  await signatureDialog.getByRole('button', { name: '電子署名してPDFを保存', exact: true }).click();
  await expect(signatureDialog).toHaveCount(0, { timeout: 30_000 });
  await expect(window.locator('.toast')).toContainText('電子署名済みPDFを保存しました');
  const signed = await fs.readFile(signedPath);
  const cryptography = verifySignedPdf(signed);
  const parsed = await PDFDocument.load(signed);
  assert.equal(parsed.getPageCount(), 1);
  const field = parsed.getForm().getFields().find((item) => item.constructor.name === 'PDFSignature');
  assert.ok(field);
  const dictionary = field.acroField.dict.lookup(PDFName.of('V'), PDFDict);
  assert.equal(dictionary.lookup(PDFName.of('Reason')).decodeText(), 'デスクトップ統合テスト');
  assert.equal(dictionary.lookup(PDFName.of('Location')).decodeText(), '架空のテスト環境');

  await window.getByRole('button', { name: '開く', exact: true }).click();
  await expect(window.locator('.document-name')).toContainText('synthetic-signed-TEST-ONLY.pdf');
  await expect(window.getByText('署名付きPDF・未検証', { exact: true })).toBeVisible();
  for (const label of ['文字を記入', '印鑑', 'AI自動記入', 'PDFを保存', '署名して保存']) {
    await expect(window.getByRole('button', { name: label, exact: true })).toBeDisabled();
  }
  await expect(window.getByRole('button', { name: '印刷', exact: true })).toBeEnabled();
  await window.waitForFunction(() => {
    const canvas = document.querySelector('.pdf-canvas');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 100) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let n = 0; n < pixels.length; n += 4) if (pixels[n] < 200) ink += 1;
    return ink > 500;
  });
  await window.screenshot({ path: path.join(output, 'signed-readonly-TEST-ONLY.png'), fullPage: true });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  const storage = await window.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.ok(!storage.includes(password) && !storage.includes('PRIVATE KEY'));
  const summary = {
    result: 'passed', platform: process.platform, identity: 'Generated self-signed TEST ONLY RSA-2048 certificate',
    dialogSelectionMocked: true, cryptoBackendMocked: false,
    verified: ['certificate selection IPC', 'wrong password rejection', 'validity metadata and self-signed hint', 'Japanese signing metadata', 'signed file save', 'signed PDF readonly UI and canvas', 'no credential localStorage persistence'],
    cryptography, externalApiCalls: 0, signedPdf: signedPath,
    screenshots: [path.join(output, 'certificate-dialog-TEST-ONLY.png'), path.join(output, 'signed-readonly-TEST-ONLY.png')],
  };
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(JSON.stringify({ output, pageErrors, consoleErrors }));
  if (application) {
    const page = application.windows()[0];
    if (page) {
      console.error(JSON.stringify({ alerts: await page.locator('[role="alert"]').allTextContents() }));
      await page.screenshot({ path: path.join(output, 'failure.png') });
    }
  }
  throw error;
} finally {
  if (application) await application.close();
  await fs.unlink(certificatePath).catch(() => {});
}
