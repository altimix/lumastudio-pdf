const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const NO_HARDLINK = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']);
const existingFileError = () => Object.assign(new Error('既存のファイルは上書きできません。別の名前で保存してください。'), { code: 'EEXIST' });

async function saveWithoutHardlink(target, bytes) {
  let handle;
  let identity;
  try {
    handle = await fs.open(target, 'wx', 0o600);
    const stat = await handle.stat();
    identity = { dev: stat.dev, ino: stat.ino };
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
      handle = null;
      const current = await fs.lstat(target).catch(() => null);
      if (current && identity && current.dev === identity.dev && current.ino === identity.ino) {
        await fs.unlink(target).catch(() => {});
      }
    }
    if (error.code === 'EEXIST') throw existingFileError();
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}

/** Publish a completed file without replacing any existing file. */
async function saveNewFile(target, bytes, { link = fs.link } = {}) {
  const temporary = path.join(path.dirname(target), `.lumastudio-pdf-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(temporary, target);
    } catch (error) {
      if (error.code === 'EEXIST') throw existingFileError();
      if (!NO_HARDLINK.has(error.code)) throw error;
      // Some external and removable volumes cannot hardlink. Exclusive create
      // still protects existing files; remove our incomplete target on failure.
      await saveWithoutHardlink(target, bytes);
    }
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temporary).catch(() => {});
  }
}

/** Replace an existing editable project only after its complete replacement is on disk. */
async function saveReplaceFile(target, bytes) {
  const temporary = path.join(path.dirname(target), `.lumastudio-pdf-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, target);
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temporary).catch(() => {});
  }
}

module.exports = { saveNewFile, saveReplaceFile };
