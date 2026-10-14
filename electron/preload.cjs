const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('setup', {
  chooseServer: () => ipcRenderer.invoke('setup:server'),
  chooseClient: (address) => ipcRenderer.invoke('setup:client', address),
});
// Lets the app save a receipt as a PDF straight into the Downloads folder.
contextBridge.exposeInMainWorld('desktop', {
  savePdf: (html, filename, format) => ipcRenderer.invoke('receipt:save-pdf', html, filename, format),
});
