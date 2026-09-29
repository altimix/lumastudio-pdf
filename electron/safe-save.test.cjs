const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { saveNewFile, saveReplaceFile } = require('./safe-save.cjs');

test('completed saves never replace existing source files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-safe-save-'));
  try {
    const target = path.join(root, 'existing.pdf');
    const original = Buffer.from('%PDF-1.7\noriginal\n%%EOF');
    await fs.writeFile(target, original);
    await assert.rejects(saveNewFile(target, Buffer.from('replacement')), /上書きできません/);
    assert.deepEqual(await fs.readFile(target), original);
    const fresh = path.join(root, 'saved.pdf');
    await saveNewFile(fresh, Buffer.from('finished'));
    assert.equal((await fs.readFile(fresh)).toString(), 'finished');
    assert.deepEqual((await fs.readdir(root)).sort(), ['existing.pdf', 'saved.pdf']);
  } finally {
    await fs.rm(root, { recursive: true });
  }
});

test('editable project replacement completes before the old file is replaced', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-safe-project-'));
  try {
    const target = path.join(root, 'work.lumapdf');
    await fs.writeFile(target, 'earlier project');
    await saveReplaceFile(target, Buffer.from('updated project'));
    assert.equal(await fs.readFile(target, 'utf8'), 'updated project');
    assert.deepEqual(await fs.readdir(root), ['work.lumapdf']);
    await assert.rejects(saveReplaceFile(path.join(root, 'missing', 'no.lumapdf'), Buffer.from('new')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(target, 'utf8'), 'updated project');
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
