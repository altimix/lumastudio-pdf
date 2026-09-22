const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_PDF_BYTES = 80 * 1024 * 1024;

function validatePdfBytes(data) {
  if (!(Array.isArray(data) || Buffer.isBuffer(data) || data instanceof Uint8Array)) {
    throw new Error('PDFデータの形式が正しくありません。');
  }
  if (data.length < 5 || data.length > MAX_PDF_BYTES) {
    throw new Error('PDFは80MB以下のファイルを選択してください。');
  }
  if (Array.isArray(data) && data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('PDFデータが破損しています。');
  }
  const bytes = Buffer.from(data);
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    throw new Error('PDFファイルを選択してください。');
  }
  return bytes;
}

async function readPdf(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.pdf') throw new Error('PDFファイルを選択してください。');
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_PDF_BYTES) throw new Error('PDFは80MB以下のファイルを選択してください。');
  const bytes = validatePdfBytes(await fs.readFile(filePath));
  return { name: path.basename(filePath), data: Array.from(bytes) };
}

function fingerprint(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Polling is intentional: local printer ports can rewrite the same file without
// reliable fs.watch events. Never modify or remove files in the user's inbox.
function watchPrintInbox(inboxPath, onPdf, { intervalMs = 800, stableMs = 1800, onError = () => {} } = {}) {
  const observations = new Map();
  const delivered = new Map();
  let busy = false;
  let stopped = false;

  async function scan() {
    if (stopped || busy) return;
    busy = true;
    try {
      const entries = await fs.readdir(inboxPath, { withFileTypes: true });
      for (const entry of entries) {
        if (stopped) break;
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.pdf') continue;
        const filePath = path.join(inboxPath, entry.name);
        try {
          const stat = await fs.stat(filePath);
          if (!stat.size || stat.size > MAX_PDF_BYTES) continue;
          const signature = `${stat.size}:${stat.mtimeMs}`;
          const prior = observations.get(filePath);
          if (!prior || prior.signature !== signature) {
            observations.set(filePath, { signature, since: Date.now() });
            continue;
          }
          if (Date.now() - prior.since < stableMs || delivered.get(filePath)?.signature === signature) continue;
          const bytes = validatePdfBytes(await fs.readFile(filePath));
          // Drivers may pause while writing. Require a complete PDF trailer too.
          if (!bytes.subarray(Math.max(0, bytes.length - 2048)).includes(Buffer.from('%%EOF'))) continue;
          const after = await fs.stat(filePath);
          if (`${after.size}:${after.mtimeMs}` !== signature) continue;
          const hash = fingerprint(bytes);
          if (delivered.get(filePath)?.hash === hash) {
            delivered.set(filePath, { signature, hash });
            continue;
          }
          delivered.set(filePath, { signature, hash });
          onPdf({ name: entry.name, data: Array.from(bytes) });
        } catch (error) {
          // Locked or unfinished printer output is retried on the next scan.
          if (!['ENOENT', 'EBUSY', 'EACCES', 'EPERM'].includes(error.code)) onError(error);
        }
      }
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(scan, intervalMs);
  timer.unref?.();
  void scan();
  return {
    stop() { stopped = true; clearInterval(timer); },
    async markSaved(filePath, bytes) {
      if (path.resolve(path.dirname(filePath)) !== path.resolve(inboxPath)) return;
      const stat = await fs.stat(filePath);
      delivered.set(filePath, { signature: `${stat.size}:${stat.mtimeMs}`, hash: fingerprint(bytes) });
    },
  };
}

module.exports = { MAX_PDF_BYTES, validatePdfBytes, readPdf, watchPrintInbox };
