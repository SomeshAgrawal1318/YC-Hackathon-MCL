const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set(['hands', 'trace:export', 'trace:screen-source', 'shell:open-url', 'kb:get', 'kb:sync', 'kb:ask', 'kb:ingest-recording', 'kb:reset', 'vm:status', 'vm:start', 'vm:release', 'actors']);

contextBridge.exposeInMainWorld('mclBridge', {
  isElectron: true,
  send: (msg) => ipcRenderer.send('bus', msg),
  onMessage: (cb) => {
    ipcRenderer.on('bus', (_event, msg) => cb(msg));
  },
  /** Request/response calls into the main process (workflow hands, exports). */
  invoke: (channel, ...args) => {
    if (!INVOKE.has(channel)) return Promise.reject(new Error(`Not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
});
