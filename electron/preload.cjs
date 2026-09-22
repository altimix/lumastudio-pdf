const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumaDesktop', {
  openPdf: () => ipcRenderer.invoke('luma:open-pdf'),
  openPdfs: () => ipcRenderer.invoke('luma:open-pdfs'),
  openProject: () => ipcRenderer.invoke('luma:open-project'),
  saveProject: (data, suggestedName) => ipcRenderer.invoke('luma:save-project', data, suggestedName),
  savePdf: (data, suggestedName) => ipcRenderer.invoke('luma:save-pdf', data, suggestedName),
  printPdf: (data) => ipcRenderer.invoke('luma:print-pdf', data),
  getPrintInbox: () => ipcRenderer.invoke('luma:get-print-inbox'),
  openPrintInbox: () => ipcRenderer.invoke('luma:open-print-inbox'),
  getAiStatus: () => ipcRenderer.invoke('luma:ai-status'),
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
