'use strict';

// Node / Electron main process only. No network, file writes, or credential logs.
const crypto = require('node:crypto');
const forge = require('node-forge');
const { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber } = require('pdf-lib');
const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');
const { P12Signer } = require('@signpdf/signer-p12');
const { SignPdf } = require('@signpdf/signpdf');

const MAX_CERTIFICATE_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 100 * 1024 * 1024;

class SignatureError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SignatureError';
    this.code = code;
  }
}

function fail(message, code) { throw new SignatureError(message, code); }

function byteBuffer(value, limit, label) {
  if (!(value instanceof Uint8Array) || value.length === 0 || value.length > limit) {
    fail(`${label}の形式またはサイズが正しくありません。`, 'INVALID_INPUT');
  }
  return Buffer.from(value); // Do not mutate the caller's buffer during cleanup.
}

function safeMetadata(value, limit = 2000) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, limit).trim();
}

function readBundle(p12Bytes, password) {
  if (typeof password !== 'string' || password.length > 1024) fail('証明書のパスワードを確認してください。', 'INVALID_PASSWORD');
  const bytes = byteBuffer(p12Bytes, MAX_CERTIFICATE_BYTES, '証明書');
  try {
    let bundle;
    try {
      const asn1 = forge.asn1.fromDer(bytes.toString('binary'), true);
      try { bundle = forge.pkcs12.pkcs12FromAsn1(asn1, true, password); }
      catch (error) {
        // PKCS#12 distinguishes an absent password from an empty password.
        // Only an explicitly empty user input may try the absent-password form.
        if (password !== '') throw error;
        bundle = forge.pkcs12.pkcs12FromAsn1(asn1, true, null);
      }
    } catch {
      fail('証明書を開けませんでした。P12/PFXファイルとパスワードを確認してください。RSA形式の証明書に対応しています。', 'CERTIFICATE_OPEN_FAILED');
    }
    const certBags = bundle.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    const keyBags = [
      ...(bundle.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
      ...(bundle.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
    ];
    if (!certBags.length || certBags.length > 32) fail('証明書の構成を読み取れません。証明書と秘密鍵を含むP12/PFXを選択してください。', 'CERTIFICATE_CONTENT_INVALID');
    if (!keyBags.length || !keyBags[0].key) fail('署名に使う秘密鍵が証明書ファイルに含まれていません。', 'PRIVATE_KEY_MISSING');
    if (keyBags.length !== 1) fail('秘密鍵が複数含まれています。署名に使う証明書を1つだけ含むP12/PFXを選択してください。', 'MULTIPLE_PRIVATE_KEYS');
    const privateKey = keyBags[0].key;
    if (!privateKey.n || !privateKey.e || !privateKey.d) fail('現在はRSA形式の証明書に対応しています。', 'UNSUPPORTED_KEY');
    if (privateKey.n.bitLength() < 2048) fail('RSA 2048ビット以上の証明書を使用してください。', 'WEAK_KEY');
    const certificates = [];
    const fingerprints = new Set();
    for (const bag of certBags) {
      if (!bag.cert) fail('証明書の形式に対応していません。RSA形式のP12/PFXを選択してください。', 'UNSUPPORTED_CERTIFICATE');
      const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(bag.cert)).getBytes(), 'binary');
      const fingerprint = crypto.createHash('sha256').update(der).digest('hex');
      if (!fingerprints.has(fingerprint)) { certificates.push(bag.cert); fingerprints.add(fingerprint); }
    }
    const matches = certificates.filter((certificate) => certificate.publicKey.n && certificate.publicKey.e
      && privateKey.n.compareTo(certificate.publicKey.n) === 0 && privateKey.e.compareTo(certificate.publicKey.e) === 0);
    if (!matches.length) fail('証明書と秘密鍵が一致しません。正しい組み合わせのP12/PFXを選択してください。', 'KEY_CERTIFICATE_MISMATCH');
    if (matches.length !== 1) fail('同じ秘密鍵に対応する証明書が複数あります。署名に使う証明書を1つに絞ってください。', 'AMBIGUOUS_CERTIFICATE');
    const certificate = matches[0];
    const now = Date.now();
    if (!Number.isFinite(certificate.validity.notBefore.getTime()) || !Number.isFinite(certificate.validity.notAfter.getTime())) {
      fail('証明書の有効期間を読み取れません。', 'CERTIFICATE_CONTENT_INVALID');
    }
    if (certificate.validity.notBefore.getTime() > now) fail('この証明書は、まだ有効期間に入っていません。', 'CERTIFICATE_NOT_YET_VALID');
    if (certificate.validity.notAfter.getTime() <= now) fail('この証明書は有効期限が切れています。更新した証明書を使用してください。', 'CERTIFICATE_EXPIRED');
    const usage = certificate.getExtension('keyUsage');
    if (usage && !usage.digitalSignature && !usage.nonRepudiation) fail('この証明書は電子署名に使用できる用途が許可されていません。', 'CERTIFICATE_KEY_USAGE');
    if (certificate.getExtension('basicConstraints')?.cA) fail('認証局用の証明書は使用できません。利用者の署名用証明書を選択してください。', 'CA_CERTIFICATE_NOT_ALLOWED');
    // Check the decrypted private key actually produces a signature verifiable
    // with the selected certificate, rather than comparing only public numbers.
    const challenge = forge.md.sha256.create();
    challenge.update(crypto.randomBytes(32).toString('binary'));
    let verified = false;
    try { verified = certificate.publicKey.verify(challenge.digest().bytes(), privateKey.sign(challenge)); } catch { /* sanitized below */ }
    if (!verified) fail('証明書と秘密鍵の検証に失敗しました。', 'KEY_CERTIFICATE_MISMATCH');
    const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(), 'binary');
    const x509 = new crypto.X509Certificate(der);
    let selfSigned = false;
    try { selfSigned = x509.subject === x509.issuer && x509.verify(x509.publicKey); } catch { /* unknown trust stays false */ }
    const metadata = {
      subject: safeMetadata(x509.subject),
      issuer: safeMetadata(x509.issuer),
      validFrom: certificate.validity.notBefore.toISOString(),
      validTo: certificate.validity.notAfter.toISOString(),
      fingerprint: x509.fingerprint256,
      selfSigned,
    };
    return { privateKey, certificate, certificates, metadata };
  } catch (error) {
    if (error instanceof SignatureError) throw error;
    fail('証明書を読み取れませんでした。ファイル形式とパスワードを確認してください。', 'CERTIFICATE_OPEN_FAILED');
  } finally { bytes.fill(0); }
}

function inspectCertificate(p12Bytes, password) {
  return readBundle(p12Bytes, password).metadata;
}

function optionText(value, limit, label) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label}の入力が正しくありません。`, 'INVALID_INPUT');
  return value.trim();
}

function pdfStringBytes(value) {
  // The placeholder library uses PDFString.of instead of PDFHexString.fromText.
  // Encode Unicode as PDF UTF-16BE explicitly so Japanese metadata remains valid.
  if (/^[\u0020-\u007e]*$/u.test(value)) return value.replace(/[\\()]/gu, '\\$&');
  const utf16 = Buffer.from(value, 'utf16le');
  utf16.swap16();
  // UTF-16 can contain 0x28/0x29/0x5c inside a Japanese character. Octal-escape
  // every byte so those cannot become PDF literal-string delimiters or escapes.
  return [...Buffer.concat([Buffer.from([254, 255]), utf16])].map((byte) => `\\${byte.toString(8).padStart(3, '0')}`).join('');
}

function rejectExistingSignature(document, bytes) {
  if (/\/ByteRange\s*\[/u.test(bytes.toString('latin1')) || document.catalog.has(PDFName.of('Perms'))) {
    fail('すでに署名されたPDFへの追加署名には対応していません。署名前のPDFを使用してください。', 'PDF_ALREADY_SIGNED');
  }
  const visited = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 30 || visited.has(value)) return;
    visited.add(value);
    if (value instanceof PDFDict) {
      const type = value.get(PDFName.of('Type'));
      const fieldType = value.get(PDFName.of('FT'));
      if (value.has(PDFName.of('ByteRange')) || (type instanceof PDFName && type.decodeText() === 'Sig')
        || (fieldType instanceof PDFName && fieldType.decodeText() === 'Sig')) {
        fail('署名または署名欄を含むPDFには追加署名できません。署名前のPDFを使用してください。', 'PDF_ALREADY_SIGNED');
      }
      value.values().forEach((item) => visit(item, depth + 1));
    } else if (value instanceof PDFArray) value.asArray().forEach((item) => visit(item, depth + 1));
  };
  document.context.enumerateIndirectObjects().forEach(([, value]) => visit(value));
}

async function signPdf(pdfBytes, p12Bytes, password, options = {}) {
  const pdf = byteBuffer(pdfBytes, MAX_PDF_BYTES, 'PDF');
  if (!pdf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) fail('PDFファイルを選択してください。', 'INVALID_PDF');
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('署名設定が正しくありません。', 'INVALID_INPUT');
  const reason = optionText(options.reason, 500, '署名の理由');
  const location = optionText(options.location, 200, '署名の場所');
  let normalizedBundle;
  let signer;
  try {
    let document;
    try { document = await PDFDocument.load(pdf, { updateMetadata: false, throwOnInvalidObject: true }); }
    catch { fail('PDFを開けませんでした。暗号化されたPDFや破損したPDFには署名できません。', 'PDF_OPEN_FAILED'); }
    if (!document.getPageCount()) fail('ページのないPDFには署名できません。', 'INVALID_PDF');
    rejectExistingSignature(document, pdf);
    const bundle = readBundle(p12Bytes, password);
    const signingTime = new Date();
    const signerName = safeMetadata(bundle.certificate.subject.getField('CN')?.value || bundle.metadata.subject, 500);
    // Preserve indirect AcroForm.Fields/SigFlags: upstream's helper otherwise
    // replaces an indirect Fields array with a new empty one.
    const acroForm = document.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (acroForm) {
      const fields = acroForm.lookupMaybe(PDFName.of('Fields'), PDFArray);
      if (fields) acroForm.set(PDFName.of('Fields'), fields);
      const flags = acroForm.lookupMaybe(PDFName.of('SigFlags'), PDFNumber);
      if (flags) acroForm.set(PDFName.of('SigFlags'), flags);
    }
    const certificateBytes = bundle.certificates.reduce((size, certificate) => size + forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).length(), 0);
    pdflibAddPlaceholder({
      pdfDoc: document,
      reason: pdfStringBytes(reason), contactInfo: '', location: pdfStringBytes(location),
      name: pdfStringBytes(signerName), signingTime,
      signatureLength: Math.max(32768, (certificateBytes + 8192) * 2),
      subFilter: 'adbe.pkcs7.detached', widgetRect: [0, 0, 0, 0], appName: 'LumaStudioPDF',
    });
    const prepared = Buffer.from(await document.save({ useObjectStreams: false, updateFieldAppearances: false }));
    // Normalize a single validated key + chain into an encrypted in-memory bundle.
    // This also supports unencrypted keyBag P12 files, which P12Signer itself does
    // not handle. The one-use password is never exposed outside this call.
    const ephemeralPassword = crypto.randomBytes(32).toString('hex');
    const normalizedAsn1 = forge.pkcs12.toPkcs12Asn1(bundle.privateKey, bundle.certificates, ephemeralPassword, {
      algorithm: 'aes256', count: 2048, generateLocalKeyId: true,
    });
    normalizedBundle = Buffer.from(forge.asn1.toDer(normalizedAsn1).getBytes(), 'binary');
    signer = new P12Signer(normalizedBundle, { passphrase: ephemeralPassword, asn1StrictParsing: true });
    // A separate instance avoids shared lastSignature state between requests.
    return await new SignPdf().sign(prepared, signer, signingTime);
  } catch (error) {
    if (error instanceof SignatureError) throw error;
    fail('電子署名を作成できませんでした。証明書とPDFの形式をご確認ください。', 'SIGNING_FAILED');
  } finally {
    normalizedBundle?.fill(0);
    if (signer) { signer.options.passphrase = ''; signer.cert.clear(); }
    pdf.fill(0);
  }
}

module.exports = { inspectCertificate, signPdf, SignatureError, MAX_CERTIFICATE_BYTES, MAX_PDF_BYTES };
