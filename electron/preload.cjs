const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumaDesktop', {
  getWindowState: () => ipcRenderer.invoke('luma:window-state'),
  restoreWindow: () => ipcRenderer.invoke('luma:restore-window'),
  onWindowStateChange: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('luma:window-state', listener);
    return () => ipcRenderer.removeListener('luma:window-state', listener);
  },
  onMenuAction: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    const listener = (_event, action) => {
      if (typeof action === 'string') callback(action);
    };
    ipcRenderer.on('luma:menu-action', listener);
    return () => ipcRenderer.removeListener('luma:menu-action', listener);
  },
  onSaveAndClose: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    const listener = (_event, format) => {
      if (format !== 'pdf' && format !== 'project') return;
      Promise.resolve().then(() => callback(format)).catch(() => {
        void ipcRenderer.invoke('luma:finish-close-save', false).catch(() => {});
      });
    };
    ipcRenderer.on('luma:save-and-close', listener);
    return () => ipcRenderer.removeListener('luma:save-and-close', listener);
  },
  finishCloseSave: (saved) => ipcRenderer.invoke('luma:finish-close-save', saved),
  openPdf: () => ipcRenderer.invoke('luma:open-pdf'),
  openPdfs: () => ipcRenderer.invoke('luma:open-pdfs'),
  openProject: () => ipcRenderer.invoke('luma:open-project'),
  saveProject: (data, suggestedName) => ipcRenderer.invoke('luma:save-project', data, suggestedName),
  savePdf: (data, suggestedName) => ipcRenderer.invoke('luma:save-pdf', data, suggestedName),
  printPdf: (data) => ipcRenderer.invoke('luma:print-pdf', data),
  getPrintInbox: () => ipcRenderer.invoke('luma:get-print-inbox'),
  openPrintInbox: () => ipcRenderer.invoke('luma:open-print-inbox'),
  getAiStatus: () => ipcRenderer.invoke('luma:ai-status'),
  getAiSettings: () => ipcRenderer.invoke('luma:ai-settings'),
  saveAiSettings: (input) => ipcRenderer.invoke('luma:save-ai-settings', input),
  removeAiSettings: () => ipcRenderer.invoke('luma:remove-ai-settings'),
  openHelpLink: (id) => ipcRenderer.invoke('luma:open-help-link', id),
  autofill: (payload) => ipcRenderer.invoke('luma:autofill', payload),
  chooseCertificate: () => ipcRenderer.invoke('luma:choose-certificate'),
  inspectCertificate: (password) => ipcRenderer.invoke('luma:inspect-certificate', password),
  signAndSavePdf: (data, suggestedName, options) => ipcRenderer.invoke('luma:sign-and-save-pdf', data, suggestedName, options),
  onOpenPdf: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    const listener = (_event, pdf) => {
      Promise.resolve().then(() => callback(pdf)).catch(() => {}).finally(() => {
        ipcRenderer.send('luma:open-received');
      });
    };
    ipcRenderer.on('luma:incoming-pdf', listener);
    ipcRenderer.send('luma:renderer-ready');
    return () => {
      ipcRenderer.removeListener('luma:incoming-pdf', listener);
      ipcRenderer.send('luma:renderer-unready');
    };
  },
});
