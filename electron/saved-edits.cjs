const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const DIGEST = /^[a-f0-9]{64}$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

class SavedEdits {
  constructor(userData) {
    this.directory = path.join(userData, 'editable-pdfs');
    this.sources = path.join(this.directory, 'sources');
  }

  async read(digest) {
    if (typeof digest !== 'string' || !DIGEST.test(digest)) return null;
    const file = path.join(this.directory, `${digest}.json`);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat?.isFile() || !stat.size) return null;
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!DIGEST.test(manifest.sourceHash) || typeof manifest.project !== 'object' || !manifest.project || Array.isArray(manifest.project)) {
      throw new Error('保存PDFの編集情報が破損しています。');
    }
    const sourceFile = path.join(this.sources, `${manifest.sourceHash}.pdf`);
    const sourceStat = await fs.lstat(sourceFile).catch(() => null);
    if (!sourceStat?.isFile()) throw new Error('保存PDFの元データが見つかりません。');
    const original = await fs.readFile(sourceFile);
    if (sha256(original) !== manifest.sourceHash) throw new Error('保存PDFの元データが破損しています。');
    return Buffer.from(JSON.stringify({ ...manifest.project, original: original.toString('base64') }));
  }

  async record(pdfBytes, projectBytes) {
    if (!Buffer.isBuffer(pdfBytes) || !Buffer.isBuffer(projectBytes) || !projectBytes.length) {
      throw new Error('再編集情報の形式が正しくありません。');
    }
    let project;
    try { project = JSON.parse(projectBytes.toString('utf8')); } catch { throw new Error('再編集情報の形式が正しくありません。'); }
    if (typeof project.original !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(project.original)) {
      throw new Error('再編集情報の元PDFが不正です。');
    }
    const original = Buffer.from(project.original, 'base64');
    if (!original.length || original.toString('base64') !== project.original) throw new Error('再編集情報の元PDFが不正です。');
    const sourceHash = sha256(original);
    const { original: _encoded, ...metadata } = project;
    const digest = sha256(pdfBytes);
    await fs.mkdir(this.sources, { recursive: true });
    const sourceFile = path.join(this.sources, `${sourceHash}.pdf`);
    const sourceStat = await fs.lstat(sourceFile).catch(() => null);
    if (!sourceStat) {
      const sourceTemporary = path.join(this.sources, `${sourceHash}.${randomUUID()}.tmp`);
      try {
        await fs.writeFile(sourceTemporary, original, { flag: 'wx', mode: 0o600 });
        try { await fs.link(sourceTemporary, sourceFile); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      } finally {
        await fs.unlink(sourceTemporary).catch(() => {});
      }
    } else if (!sourceStat.isFile()) throw new Error('保存PDFの元データを記録できません。');
    const temporary = path.join(this.directory, `${digest}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify({ sourceHash, project: metadata }), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, path.join(this.directory, `${digest}.json`));
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    return digest;
  }
}

module.exports = { SavedEdits, sha256 };
