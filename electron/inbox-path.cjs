'use strict';
const path = require('node:path');
function getPrintInboxPath(documents, override, paths = path) {
  if (override === undefined || override === '') return paths.join(documents, 'LumaStudio PDF', 'Print Inbox');
  if (typeof override !== 'string' || override.length > 4096 || override.includes('\0') || !paths.isAbsolute(override) || /^[\\/]{2}/.test(override)) {
    throw new Error('印刷受信箱の設定には、この端末の絶対パスを指定してください。');
  }
  return paths.normalize(override);
}
module.exports = {getPrintInboxPath};
