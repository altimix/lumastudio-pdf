const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {getPrintInboxPath} = require('./inbox-path.cjs');
test('print inbox keeps default documents location or isolated absolute override',()=>{
  assert.equal(getPrintInboxPath('C:\\Documents',undefined,path.win32),'C:\\Documents\\LumaStudio PDF\\Print Inbox');
  assert.equal(getPrintInboxPath('/Users/example/Documents',undefined,path.posix),'/Users/example/Documents/LumaStudio PDF/Print Inbox');
  assert.equal(getPrintInboxPath('C:\\Documents','C:\\test-profile\\print-inbox',path.win32),'C:\\test-profile\\print-inbox');
});
test('print inbox rejects relative or network paths',()=>{
  for(const input of ['..\\documents','\\\\server\\share','//host/path','https://example.com','C:\\x\0y'])assert.throws(()=>getPrintInboxPath('C:\\Documents',input,path.win32));
});
