const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SavedEdits, sha256 } = require('./saved-edits.cjs');
const { saveNewFile } = require('./safe-save.cjs');

test('only an exact locally saved PDF hash retrieves its editing data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-saved-edits-'));
  try {
    const saved = new SavedEdits(root);
    const pdf = Buffer.from('%PDF-1.7\nexample\n%%EOF\n');
    const project = Buffer.from(JSON.stringify({ app: 'LumaStudio PDF', version: 3, filename: 'source.pdf', original: pdf.toString('base64'), annotations: [] }));
    assert.equal(await saved.read(sha256(pdf)), null);
    assert.equal(await saved.record(pdf, project), sha256(pdf));
    assert.deepEqual(JSON.parse((await saved.read(sha256(pdf))).toString()), JSON.parse(project.toString()));
    assert.equal(await saved.read(sha256(Buffer.concat([pdf, Buffer.from('changed')]))), null);
    assert.equal(await saved.read('../secrets'), null);
    await saved.record(Buffer.concat([pdf, Buffer.from('second')]), project);
    assert.equal((await fs.readdir(path.join(root, 'editable-pdfs', 'sources'))).length, 1);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('editable source is recorded when app data is on a hardlink-free volume', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-saved-no-hardlink-'));
  const unavailableLink = async () => { const error = new Error('hardlinks unavailable'); error.code = 'EPERM'; throw error; };
  try {
    const saved = new SavedEdits(root, {
      saveSource: (target, bytes) => saveNewFile(target, bytes, { link: unavailableLink }),
    });
    const original = Buffer.from('%PDF-1.7\noriginal\n%%EOF');
    const output = Buffer.from('%PDF-1.7\noutput\n%%EOF');
    const project = Buffer.from(JSON.stringify({ app: 'LumaStudio PDF', version: 3, original: original.toString('base64') }));
    await saved.record(output, project);
    assert.equal(JSON.parse((await saved.read(sha256(output))).toString()).original, original.toString('base64'));
    assert.equal((await fs.readdir(path.join(root, 'editable-pdfs', 'sources'))).length, 1);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
