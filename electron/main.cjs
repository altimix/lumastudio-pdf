const { app, BrowserWindow, dialog, ipcMain, Menu, shell, session, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { validatePdfBytes, readPdf, watchPrintInbox } = require('./pdf-files.cjs');

app.setName('LumaStudio PDF');
app.setAppUserModelId('jp.altimix.lumastudio-pdf');

let mainWindow;
let printInbox;
let inboxWatcher;
let rendererReady = false;
let receiving = false;
let aiService;
let aiSettings;
let selectedCertificate;
const pendingPdfs = [];
const pendingPaths = [];
const printJobs = new Map();
const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
const printPath = path.join(__dirname, 'print.html');

function rendererUrl() {
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('VITE_DEV_SERVER_URL はローカル開発サーバーを指定してください。');
    }
    return url.href;
  }
  return pathToFileURL(indexPath).href;
}

function assertMainSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('この操作はアプリのメイン画面から実行してください。');
  }
  const current = new URL(event.senderFrame.url);
  const expected = new URL(rendererUrl());
  if (current.origin !== expected.origin || current.pathname !== expected.pathname) {
    throw new Error('許可されていない画面です。');
  }
}

function lockWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function focusMain() {
  if (!mainWindow && app.isReady()) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function flushPdfs() {
  if (!rendererReady || receiving || !pendingPdfs.length || !mainWindow || mainWindow.isDestroyed()) return;
  receiving = true;
  mainWindow.webContents.send('luma:incoming-pdf', pendingPdfs.shift());
  focusMain();
}

function enqueuePdf(pdf) {
  // Single-document MVP: cap queued bytes rather than consuming unlimited RAM.
  const total = pendingPdfs.reduce((sum, item) => sum + item.data.length, 0);
  if (pendingPdfs.length >= 10 || total + pdf.data.length > 160 * 1024 * 1024) {
    dialog.showErrorBox('印刷受信箱を確認してください', '受信したPDFが多いため、自動で開く処理を停止しました。受信箱からPDFを選んで開いてください。ファイルは削除していません。');
    return;
  }
  pendingPdfs.push(pdf);
  flushPdfs();
}

async function openFilePath(filePath) {
  try {
    enqueuePdf(await readPdf(path.resolve(filePath)));
  } catch (error) {
    dialog.showErrorBox('PDFを開けませんでした', error.message);
  }
}

function acceptArguments(argv, workingDirectory = process.cwd()) {
  for (const argument of argv) {
    if (typeof argument !== 'string' || argument.startsWith('-') || !argument.toLowerCase().endsWith('.pdf')) continue;
    const filePath = path.resolve(workingDirectory, argument);
    if (app.isReady()) void openFilePath(filePath);
    else pendingPaths.push(filePath);
  }
}

async function choosePdf() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'PDFを開く', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'],
  });
  return result.canceled || !result.filePaths[0] ? null : readPdf(result.filePaths[0]);
}

async function choosePdfs() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '結合するPDFを選ぶ', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || !result.filePaths.length) return [];
  if (result.filePaths.length > 30) throw new Error('一度に選べるPDFは30個までです。');
  const files = [];
  let total = 0;
  for (const filePath of result.filePaths) {
    const stat = await fs.stat(filePath);
    total += stat.size;
    if (total > 50 * 1024 * 1024) throw new Error('結合するPDFは合計50MBまで選択できます。');
    files.push(await readPdf(filePath));
  }
  return files;
}

function setMenu() {
  const template = [];
  if (process.platform === 'darwin') template.push({ role: 'appMenu' });
  template.push({
    label: 'ファイル',
    submenu: [
      { label: 'PDFを開く…', accelerator: 'CmdOrCtrl+O', click: async () => {
        try { const pdf = await choosePdf(); if (pdf) enqueuePdf(pdf); }
        catch (error) { dialog.showErrorBox('PDFを開けませんでした', error.message); }
      } },
      { label: '印刷受信箱を開く', click: () => void shell.openPath(printInbox) },
      { type: 'separator' },
      process.platform === 'darwin' ? { role: 'close' } : { role: 'quit', label: '終了' },
    ],
  }, { role: 'editMenu', label: '編集' }, {
    label: '表示', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }],
  });
  if (!app.isPackaged) template.push({ label: '開発', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  rendererReady = false;
  receiving = false;
  mainWindow = new BrowserWindow({
    width: 1480, height: 970, minWidth: 980, minHeight: 680,
    title: 'LumaStudio PDF', backgroundColor: '#f5f7fa', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, spellcheck: false,
    },
  });
  lockWindow(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question', title: '編集内容を確認',
      message: '保存していない変更があります。終了しますか？',
      buttons: ['編集を続ける', '変更を破棄して終了'], defaultId: 0, cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  mainWindow.webContents.on('did-start-loading', () => { rendererReady = false; });
  mainWindow.on('closed', () => { mainWindow = undefined; rendererReady = false; receiving = false; });
  void mainWindow.loadURL(rendererUrl()).catch((error) => dialog.showErrorBox('起動できませんでした', error.message));
}

function getPrintJob(event) {
  const job = printJobs.get(event.sender.id);
  if (!job || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== pathToFileURL(printPath).href) {
    throw new Error('印刷ジョブが見つかりません。');
  }
  return job;
}

function printPdf(bytes) {
  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({
      width: 900, height: 760, show: false, parent: mainWindow,
      title: 'LumaStudio PDF — 印刷', backgroundColor: '#e8ecf1',
      webPreferences: {
        preload: path.join(__dirname, 'print-preload.cjs'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
        webSecurity: true, backgroundThrottling: false,
      },
    });
    lockWindow(window);
    window.removeMenu();
    const contentsId = window.webContents.id;
    let finished = false;
    let timer;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      printJobs.delete(contentsId);
      if (!window.isDestroyed()) window.destroy();
      if (error) reject(error); else resolve();
    };
    timer = setTimeout(() => finish(new Error('印刷の準備がタイムアウトしました。PDFを保存してから印刷してください。')), 120_000);
    printJobs.set(contentsId, { window, bytes, finish, ready: false, clearTimer: () => clearTimeout(timer) });
    window.once('closed', () => finish());
    window.webContents.once('render-process-gone', () => finish(new Error('印刷画面を起動し直してください。')));
    void window.loadFile(printPath).catch((error) => finish(error));
  });
}

function registerIpc() {
  ipcMain.handle('luma:open-help-link', async(event, id) => {
    assertMainSender(event);
    const url = require('./help-links.cjs').getHelpUrl(id);
    if (!url) throw new Error('この案内リンクは開けません。');
    await shell.openExternal(url);
  });
  ipcMain.handle('luma:ai-settings', async(event) => {assertMainSender(event);return aiSettings.getSettings();});
  ipcMain.handle('luma:save-ai-settings', async(event, input) => {assertMainSender(event);return aiSettings.save(input);});
  ipcMain.handle('luma:remove-ai-settings', async(event) => {assertMainSender(event);return aiSettings.remove();});
  ipcMain.handle('luma:open-project', async (event) => {
    assertMainSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {title:'作業データを開く',filters:[{name:'LumaStudio PDF 作業データ',extensions:['lumapdf']}],properties:['openFile']});
    if(result.canceled || !result.filePaths[0])return null;
    const filePath=result.filePaths[0];
    if(path.extname(filePath).toLowerCase()!=='.lumapdf')throw new Error('拡張子が .lumapdf の作業データを選択してください。');
    const stat=await fs.stat(filePath);
    if(!stat.isFile() || stat.size>100*1024*1024)throw new Error('作業データは100MBまで読み込めます。');
    return {name:path.basename(filePath),data:Array.from(await fs.readFile(filePath))};
  });
  ipcMain.handle('luma:save-project', async (event,data,suggestedName) => {
    assertMainSender(event);
    if(!Array.isArray(data) || !data.length || data.length>100*1024*1024 || !data.every(n=>Number.isInteger(n)&&n>=0&&n<=255))throw new Error('作業データの形式またはサイズが正しくありません。');
    const bytes=Buffer.from(data);let content;
    try{content=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('作業データの形式が正しくありません。');}
    if(content.app!=='LumaStudio PDF' || content.version!==1)throw new Error('対応していない作業データです。');
    const cleanName=path.basename(String(suggestedName || '作業データ.lumapdf')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
    const result=await dialog.showSaveDialog(mainWindow,{title:'編集を再開できる作業データを保存',defaultPath:path.join(app.getPath('documents'),cleanName.endsWith('.lumapdf')?cleanName:`${cleanName}.lumapdf`),filters:[{name:'LumaStudio PDF 作業データ',extensions:['lumapdf']}],properties:['showOverwriteConfirmation','createDirectory']});
    if(result.canceled || !result.filePath)return false;
    if(path.extname(result.filePath).toLowerCase()!=='.lumapdf')throw new Error('元のPDFを上書きしないよう .lumapdf の名前で保存してください。');
    await fs.writeFile(result.filePath,bytes);return true;
  });
  ipcMain.handle('luma:open-pdfs', async (event) => { assertMainSender(event); return choosePdfs(); });
  ipcMain.handle('luma:choose-certificate', async (event) => {
    assertMainSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '署名用の証明書を選ぶ', filters: [{ name: 'PKCS#12 証明書', extensions: ['p12', 'pfx'] }], properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const stat = await fs.stat(filePath);
    if (!/\.(?:p12|pfx)$/iu.test(filePath) || !stat.isFile() || !stat.size || stat.size > 2 * 1024 * 1024) {
      throw new Error('2MB以下の .p12 または .pfx 証明書を選択してください。');
    }
    const bytes = await fs.readFile(filePath);
    if (bytes.length > 2 * 1024 * 1024) throw new Error('証明書ファイルが大きすぎます。');
    selectedCertificate?.fill(0);
    selectedCertificate = bytes;
    return { name: path.basename(filePath) };
  });
  ipcMain.handle('luma:inspect-certificate', async (event, password) => {
    assertMainSender(event);
    if (!selectedCertificate) throw new Error('署名用の証明書を選択してください。');
    if (typeof password !== 'string' || password.length > 1024) throw new Error('証明書のパスワードが正しくありません。');
    const { inspectCertificate } = require('../server/signature.cjs');
    return inspectCertificate(selectedCertificate, password);
  });
  ipcMain.handle('luma:sign-and-save-pdf', async (event, data, suggestedName, options) => {
    assertMainSender(event);
    if (!selectedCertificate) throw new Error('署名用の証明書を選択してください。');
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || typeof options.password !== 'string' || options.password.length > 1024
      || typeof options.reason !== 'string' || options.reason.length > 500
      || typeof options.location !== 'string' || options.location.length > 200) {
      throw new Error('署名の設定が正しくありません。');
    }
    const bytes = validatePdfBytes(data);
    const { signPdf } = require('../server/signature.cjs');
    const signed = await signPdf(bytes, selectedCertificate, options.password, { reason: options.reason, location: options.location });
    const base = path.basename(String(suggestedName || '文書')).replace(/\.pdf$/iu, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const name = /署名済/iu.test(base) ? `${base}.pdf` : `${base}_署名済.pdf`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '署名したPDFを別名で保存', defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return false;
    // Never replace the source or an earlier signed file, even after an OS
    // overwrite prompt. A fresh file keeps both the original and signed copy.
    try { await fs.writeFile(result.filePath, signed, { flag: 'wx' }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('元のPDFを残すため、新しいファイル名で保存してください。');
      throw new Error('署名したPDFを保存できませんでした。保存先を確認してください。');
    }
    await inboxWatcher?.markSaved(result.filePath, signed);
    return true;
  });
  ipcMain.handle('luma:ai-status', async (event) => { assertMainSender(event); return aiService.getAiStatus(); });
  ipcMain.handle('luma:autofill', async (event, payload) => { assertMainSender(event); return aiService.autofill(payload); });
  ipcMain.handle('luma:open-pdf', async (event) => { assertMainSender(event); return choosePdf(); });
  ipcMain.handle('luma:save-pdf', async (event, data, suggestedName) => {
    assertMainSender(event);
    const bytes = validatePdfBytes(data);
    const cleanName = path.basename(String(suggestedName || '記入済み.pdf')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '編集したPDFを保存',
      defaultPath: path.join(app.getPath('documents'), cleanName.toLowerCase().endsWith('.pdf') ? cleanName : `${cleanName}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, bytes);
    await inboxWatcher?.markSaved(result.filePath, bytes);
    return true;
  });
  ipcMain.handle('luma:print-pdf', async (event, data) => {
    assertMainSender(event);
    if (printJobs.size) throw new Error('開いている印刷ダイアログを閉じてから、もう一度お試しください。');
    return printPdf(validatePdfBytes(data));
  });
  ipcMain.handle('luma:get-print-inbox', (event) => { assertMainSender(event); return printInbox; });
  ipcMain.handle('luma:open-print-inbox', async (event) => {
    assertMainSender(event);
    const error = await shell.openPath(printInbox);
    if (error) throw new Error(error);
  });
  ipcMain.on('luma:renderer-ready', (event) => {
    try { assertMainSender(event); rendererReady = true; flushPdfs(); } catch { /* Ignore unrelated frames. */ }
  });
  ipcMain.on('luma:renderer-unready', (event) => {
    try { assertMainSender(event); rendererReady = false; } catch { /* Ignore unrelated frames. */ }
  });
  ipcMain.on('luma:open-received', (event) => {
    try { assertMainSender(event); receiving = false; flushPdfs(); } catch { /* Ignore unrelated frames. */ }
  });
  ipcMain.handle('luma:print-job', (event) => Array.from(getPrintJob(event).bytes));
  ipcMain.on('luma:print-failed', (event, message) => {
    try { getPrintJob(event).finish(new Error(String(message).slice(0, 500))); } catch { /* Ignore unrelated frames. */ }
  });
  ipcMain.on('luma:print-ready', (event, pageSize) => {
    let job;
    try { job = getPrintJob(event); } catch { return; }
    if (job.ready) return;
    job.ready = true;
    job.clearTimer();
    if (!pageSize || !Number.isSafeInteger(pageSize.width) || !Number.isSafeInteger(pageSize.height)
      || pageSize.width < 353 || pageSize.height < 353 || pageSize.width > 5_000_000 || pageSize.height > 5_000_000) {
      job.finish(new Error('印刷用紙のサイズを確認できませんでした。'));
      return;
    }
    job.window.show();
    try {
      job.window.webContents.print({
        silent: false, printBackground: true, margins: { marginType: 'none' }, pageSize,
      }, (success, reason) => {
        job.finish(!success && !/cancel/i.test(reason) ? new Error(`印刷できませんでした: ${reason}`) : undefined);
      });
    } catch (error) {
      job.finish(new Error(`印刷できませんでした: ${error.message}`));
    }
  });
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) void openFilePath(filePath); else pendingPaths.push(filePath);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  acceptArguments(process.argv.slice(app.isPackaged ? 1 : 2));
  app.on('second-instance', (_event, argv, workingDirectory) => { acceptArguments(argv, workingDirectory); focusMain(); });
  app.whenReady().then(async () => {
    const { createAutofill } = require('../server/ai.cjs');
    aiSettings = await require('../server/settings.cjs').createAiSettings({ directory:app.getPath('userData'),safeStorage,createAutofill,envPath: process.env.LUMA_ENV_PATH || (app.isPackaged
      ? path.join(app.getPath('userData'), '.env')
      : path.join(__dirname, '..', '.env')) });
    aiService = aiSettings;
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    printInbox = path.join(app.getPath('documents'), 'LumaStudio PDF', 'Print Inbox');
    await fs.mkdir(printInbox, { recursive: true });
    registerIpc();
    createWindow();
    setMenu();
    inboxWatcher = watchPrintInbox(printInbox, enqueuePdf);
    for (const filePath of pendingPaths.splice(0)) await openFilePath(filePath);
  }).catch((error) => { dialog.showErrorBox('起動できませんでした', error.message); app.quit(); });
  app.on('activate', () => focusMain());
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { inboxWatcher?.stop(); selectedCertificate?.fill(0); selectedCertificate = undefined; });
}
