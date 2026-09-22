import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, verify } from 'node:crypto';
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';

const require = createRequire(import.meta.url);
const forge = require('node-forge');
const { inspectCertificate, signPdf, SignatureError } = require('./signature.cjs');
const PASSWORD = 'test-only-not-a-user-secret';
let keys: any;
let alternateKeys: any;
let certificate: any;
let p12: Buffer;
let pdf: Buffer;

function makeCertificate(options: Record<string, any> = {}) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = options.serialNumber ?? '01';
  cert.validity.notBefore = options.notBefore ?? new Date(Date.now() - 86400000);
  cert.validity.notAfter = options.notAfter ?? new Date(Date.now() + 86400000 * 30);
  cert.setSubject([{ name: 'commonName', value: 'LumaStudio TEST ONLY' }, { name: 'organizationName', value: 'Fictional test fixture' }]);
  cert.setIssuer(options.issuer?.subject.attributes ?? cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: options.digitalSignature !== false, nonRepudiation: options.digitalSignature !== false, keyEncipherment: true },
  ]);
  cert.sign(options.issuerKey ?? keys.privateKey, forge.md.sha256.create());
  return cert;
}

function makeP12(cert = certificate, key = keys.privateKey, password: string | null = PASSWORD) {
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(key, Array.isArray(cert) ? cert : [cert], password, {
    algorithm: 'aes256', count: 2048, generateLocalKeyId: true,
  })).getBytes(), 'binary');
}

/** Independent verifier: recompute PDF ByteRange digest and verify CMS signed attributes with Node crypto. */
function verifyDetachedPdf(bytes: Buffer) {
  const match = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/u.exec(bytes.toString('latin1'));
  if (!match) return { digestValid: false, signatureValid: false, complete: false };
  const [start, firstLength, secondStart, secondLength] = match.slice(1).map(Number);
  const complete = start === 0 && secondStart + secondLength === bytes.length && firstLength < secondStart;
  const range = Buffer.concat([bytes.subarray(start, start + firstLength), bytes.subarray(secondStart, secondStart + secondLength)]);
  const signatureHex = bytes.subarray(firstLength + 1, secondStart - 1).toString('ascii');
  const raw = Buffer.from(signatureHex, 'hex');
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(raw.toString('binary')), { strict: true, parseAllBytes: false });
  const signedData = asn1.value[1].value[0];
  const signerInfo = signedData.value.at(-1).value[0];
  const authenticated = signerInfo.value[3];
  const digestAttr = authenticated.value.find((attr: any) => forge.asn1.derToOid(attr.value[0].value) === forge.pki.oids.messageDigest);
  const expectedDigest = Buffer.from(digestAttr.value[1].value[0].value, 'binary');
  const digestValid = createHash('sha256').update(range).digest().equals(expectedDigest);
  const attributesDer = Buffer.from(forge.asn1.toDer(forge.asn1.create(
    forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, authenticated.value,
  )).getBytes(), 'binary');
  const signature = Buffer.from(signerInfo.value[5].value, 'binary');
  const cms = forge.pkcs7.messageFromAsn1(asn1);
  const serial = forge.util.bytesToHex(signerInfo.value[1].value[1].value);
  const signingCertificate = cms.certificates.find((cert: any) => cert.serialNumber.replace(/^0+/u, '') === serial.replace(/^0+/u, ''));
  const publicKey = forge.pki.publicKeyToPem(signingCertificate.publicKey);
  const signatureValid = verify('RSA-SHA256', attributesDer, publicKey, signature);
  return { digestValid, signatureValid, complete, asn1, firstLength, secondStart };
}

beforeAll(async () => {
  keys = forge.pki.rsa.generateKeyPair(2048);
  alternateKeys = forge.pki.rsa.generateKeyPair(2048);
  certificate = makeCertificate();
  p12 = makeP12();
  const document = await PDFDocument.create();
  document.addPage([595, 842]).drawText('FICTITIOUS TEST DOCUMENT - NOT FOR USE');
  document.setSubject('tamper-target-only-test');
  pdf = Buffer.from(await document.save({ useObjectStreams: false }));
}, 30000);

describe('certificate-backed local PDF signature', () => {
  it('shows certificate metadata without exposing key material or password', () => {
    const metadata = inspectCertificate(p12, PASSWORD);
    expect(metadata.subject).toContain('LumaStudio TEST ONLY');
    expect(metadata.issuer).toContain('LumaStudio TEST ONLY');
    expect(metadata.selfSigned).toBe(true);
    expect(metadata.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/u);
    expect(new Date(metadata.validTo).getTime()).toBeGreaterThan(Date.now());
    expect(Object.keys(metadata).sort()).toEqual(['subject', 'issuer', 'validFrom', 'validTo', 'fingerprint', 'selfSigned'].sort());
    expect(JSON.stringify(metadata)).not.toContain(PASSWORD);
    expect(JSON.stringify(metadata)).not.toContain('PRIVATE KEY');
  });

  it('creates a real SHA-256 detached CMS signature and valid PDF ByteRange', async () => {
    const signed = await signPdf(pdf, p12, PASSWORD, { reason: '内容を確認しました', location: '東京都・テスト用' });
    expect(Buffer.isBuffer(signed)).toBe(true);
    expect(verifyDetachedPdf(signed)).toMatchObject({ digestValid: true, signatureValid: true, complete: true });
    const document = await PDFDocument.load(signed);
    expect(document.getPageCount()).toBe(1);
    const field = document.getForm().getFields().find((item) => item.constructor.name === 'PDFSignature');
    expect(field).toBeDefined();
    const signature = field!.acroField.dict.lookup(PDFName.of('V'), PDFDict);
    expect(signature.lookup(PDFName.of('Reason')).decodeText()).toBe('内容を確認しました');
    expect(signature.lookup(PDFName.of('Location')).decodeText()).toBe('東京都・テスト用');
    expect(signature.lookup(PDFName.of('SubFilter')).toString()).toBe('/adbe.pkcs7.detached');
    // Signing never mutates or wipes the caller-owned buffers.
    expect(inspectCertificate(p12, PASSWORD).selfSigned).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('detects a changed PDF byte and an appended unsigned suffix', async () => {
    const signed = await signPdf(pdf, p12, PASSWORD, {});
    const tampered = Buffer.from(signed);
    const marker = tampered.indexOf(Buffer.from('595'), tampered.indexOf(Buffer.from('/MediaBox')));
    expect(marker).toBeGreaterThan(0);
    tampered[marker] ^= 1;
    expect(verifyDetachedPdf(tampered)).toMatchObject({ digestValid: false, signatureValid: true });
    expect(verifyDetachedPdf(Buffer.concat([signed, Buffer.from('\nextra unsigned bytes')])).complete).toBe(false);
  });

  it('detects a cryptographically altered CMS signature', async () => {
    const signed = await signPdf(pdf, p12, PASSWORD, {});
    const parsed = verifyDetachedPdf(signed);
    const signerInfo = parsed.asn1.value[1].value[0].value.at(-1).value[0];
    const signature = signerInfo.value[5].value;
    signerInfo.value[5].value = String.fromCharCode(signature.charCodeAt(0) ^ 1) + signature.slice(1);
    const alteredDer = Buffer.from(forge.asn1.toDer(parsed.asn1).getBytes(), 'binary');
    const altered = Buffer.from(signed);
    const hexCapacity = parsed.secondStart! - parsed.firstLength! - 2;
    altered.write(alteredDer.toString('hex').padEnd(hexCapacity, '0'), parsed.firstLength! + 1, hexCapacity, 'ascii');
    expect(verifyDetachedPdf(altered)).toMatchObject({ digestValid: true, signatureValid: false });
  });

  it('refuses to rewrite an already signed PDF', async () => {
    const signed = await signPdf(pdf, p12, PASSWORD, {});
    await expect(signPdf(signed, p12, PASSWORD, {})).rejects.toMatchObject({ code: 'PDF_ALREADY_SIGNED' });
  });

  it('escapes parentheses and backslashes in literal signature metadata', async () => {
    const reason = 'Approved (version 2) \\ original';
    const signed = await signPdf(pdf, p12, PASSWORD, { reason });
    const document = await PDFDocument.load(signed, { throwOnInvalidObject: true });
    const field = document.getForm().getFields().find((item) => item.constructor.name === 'PDFSignature');
    const signature = field!.acroField.dict.lookup(PDFName.of('V'), PDFDict);
    expect(signature.lookup(PDFName.of('Reason')).decodeText()).toBe(reason);
    expect(verifyDetachedPdf(signed)).toMatchObject({ digestValid: true, signatureValid: true });
  });

  it('rejects an existing signature field hidden inside compressed objects', async () => {
    const document = await PDFDocument.load(pdf);
    const field = document.context.register(document.context.obj({ FT: 'Sig', Type: 'Annot', Subtype: 'Widget' }));
    document.catalog.set(PDFName.of('AcroForm'), document.context.register(document.context.obj({ Fields: [field] })));
    const compressed = Buffer.from(await document.save({ useObjectStreams: true }));
    expect(compressed.toString('latin1')).not.toMatch(/\/ByteRange\s*\[/u);
    await expect(signPdf(compressed, p12, PASSWORD, {})).rejects.toMatchObject({ code: 'PDF_ALREADY_SIGNED' });
  });

  it('rejects malformed bundles and wrong passwords using safe error messages', () => {
    for (const [bytes, password] of [[p12, 'wrong-super-secret'], [Buffer.from('not-a-p12-sensitive-content'), PASSWORD]]) {
      try { inspectCertificate(bytes, password); throw new Error('Unexpected success'); }
      catch (error: any) {
        expect(error).toBeInstanceOf(SignatureError);
        expect(error.code).toBe('CERTIFICATE_OPEN_FAILED');
        expect(error.message).not.toContain(password);
        expect(error.message).not.toContain('sensitive-content');
      }
    }
  });

  it('rejects expired, future, non-signing, and mismatched certificates', () => {
    const cases = [
      [makeP12(makeCertificate({ notAfter: new Date(Date.now() - 1000) })), 'CERTIFICATE_EXPIRED'],
      [makeP12(makeCertificate({ notBefore: new Date(Date.now() + 86400000) })), 'CERTIFICATE_NOT_YET_VALID'],
      [makeP12(makeCertificate({ digitalSignature: false })), 'CERTIFICATE_KEY_USAGE'],
      [makeP12(certificate, alternateKeys.privateKey), 'KEY_CERTIFICATE_MISMATCH'],
      [makeP12(certificate, null), 'PRIVATE_KEY_MISSING'],
    ];
    for (const [bytes, code] of cases) {
      expect(() => inspectCertificate(bytes, PASSWORD)).toThrowError(SignatureError);
      try { inspectCertificate(bytes, PASSWORD); } catch (error: any) { expect(error.code).toBe(code); }
    }
  });

  it('supports an unencrypted PKCS#12 key bag by normalizing it only in memory', async () => {
    const unencrypted = makeP12(certificate, keys.privateKey, null);
    const signed = await signPdf(pdf, unencrypted, '', {});
    expect(verifyDetachedPdf(signed)).toMatchObject({ digestValid: true, signatureValid: true, complete: true });
  });

  it('keeps existing form fields when the AcroForm Fields array is indirect', async () => {
    const document = await PDFDocument.load(pdf);
    document.getForm().createTextField('existing-field').setText('Still here');
    const acroForm = document.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    const fields = acroForm.lookup(PDFName.of('Fields'), PDFArray);
    acroForm.set(PDFName.of('Fields'), document.context.register(fields));
    const signed = await signPdf(await document.save(), p12, PASSWORD, {});
    const reopened = await PDFDocument.load(signed);
    expect(reopened.getForm().getTextField('existing-field').getText()).toBe('Still here');
    expect(reopened.getForm().getFields()).toHaveLength(2);
    expect(verifyDetachedPdf(signed)).toMatchObject({ digestValid: true, signatureValid: true, complete: true });
  });

  it('identifies a CA-issued leaf separately from a self-signed test certificate', async () => {
    const authority = forge.pki.createCertificate();
    authority.publicKey = alternateKeys.publicKey;
    authority.serialNumber = '02';
    authority.validity.notBefore = new Date(Date.now() - 86400000);
    authority.validity.notAfter = new Date(Date.now() + 86400000 * 30);
    authority.setSubject([{ name: 'commonName', value: 'FICTITIOUS TEST CA' }]);
    authority.setIssuer(authority.subject.attributes);
    authority.setExtensions([{ name: 'basicConstraints', cA: true }]);
    authority.sign(alternateKeys.privateKey, forge.md.sha256.create());
    const leaf = makeCertificate({ serialNumber: '03', issuer: authority, issuerKey: alternateKeys.privateKey });
    const chain = makeP12([leaf, authority]);
    expect(inspectCertificate(chain, PASSWORD)).toMatchObject({ selfSigned: false, issuer: 'CN=FICTITIOUS TEST CA' });
    const signed = await signPdf(pdf, chain, PASSWORD, {});
    expect(verifyDetachedPdf(signed)).toMatchObject({ digestValid: true, signatureValid: true, complete: true });
  });
});
