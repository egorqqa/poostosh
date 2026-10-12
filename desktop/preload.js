const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  openExternal: url => ipcRenderer.invoke('open-external', url),
  startServer: opts => ipcRenderer.invoke('server-start', opts),
  stopServer: () => ipcRenderer.invoke('server-stop'),
  serverStatus: () => ipcRenderer.invoke('server-status'),
  quit: () => ipcRenderer.invoke('quit'),
  canAutoUpdate: true,
  installUpdate: url => ipcRenderer.invoke('update-install', url),
  onUpdateProgress: cb => ipcRenderer.on('update-progress', (e, d) => cb(d)),
});
