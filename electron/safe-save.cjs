const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

/** Publish a completed file atomically and refuse to replace any existing file. */
async function saveNewFile(target, bytes) {
  const temporary = path.join(path.dirname(target), `.lumastudio-pdf-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fs.link(temporary, target);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('既存のファイルは上書きできません。別の名前で保存してください。');
      throw error;
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
