const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumaPrint', {
  getJob: () => ipcRenderer.invoke('luma:print-job'),
  ready: (pageSize) => ipcRenderer.send('luma:print-ready', pageSize),
  failed: (message) => ipcRenderer.send('luma:print-failed', String(message).slice(0, 500)),
});
