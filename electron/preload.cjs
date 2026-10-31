const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mclBridge', {
  isElectron: true,
  send: (msg) => ipcRenderer.send('bus', msg),
  onMessage: (cb) => {
    ipcRenderer.on('bus', (_event, msg) => cb(msg));
  },
});
