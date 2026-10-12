// Оболочка Windows-сборки
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const args = process.argv.slice(1);
const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };

let server = null;
function startServer(opts) {
  if (server) return { ok: true, port: server.port, addresses: server.addresses, already: true };
  const { createServer } = require('../server/server.js');
  server = createServer({ port: +opts.port || 7777, password: opts.password || '', name: opts.name, motd: opts.motd, max: opts.max, dataDir: app.getPath('userData'), log: console.log });
  return { ok: true, port: server.port, addresses: server.addresses };
}

// Выделенный сервер без окна:  Poostosh.exe --server --port 7777 --password 123
if (args.includes('--server')) {
  app.whenReady().then(() => {
    const port = +arg('port', 7777);
    startServer({ port, password: arg('password', ''), name: arg('name', 'Пустошь'), motd: arg('motd', ''), max: arg('max', 32) });
    const win = new BrowserWindow({ width: 820, height: 560, title: 'Сервер «Пустошь»', autoHideMenuBar: true, icon: path.join(__dirname, 'icon.ico'), backgroundColor: '#0d0b08' });
    win.setMenu(null);
    setTimeout(() => win.loadURL(`http://127.0.0.1:${port}/server`), 400);
  });
  app.on('window-all-closed', () => { if (server) server.close(); app.quit(); });
} else {
  app.whenReady().then(() => {
    const win = new BrowserWindow({
      width: 1366, height: 820, minWidth: 1024, minHeight: 640, backgroundColor: '#000000',
      title: 'Пустошь', autoHideMenuBar: true, icon: path.join(__dirname, 'icon.ico'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
    });
    win.setMenu(null);
    win.maximize();
    win.loadFile(path.join(__dirname, '..', 'game', 'index.html'));
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  });
  app.on('window-all-closed', () => { if (server) server.close(); app.quit(); });
}

ipcMain.handle('open-external', (e, url) => {
  if (typeof url === 'string' && /^https:\/\/(github\.com|objects\.githubusercontent\.com)\//.test(url)) shell.openExternal(url);
});
ipcMain.handle('server-start', (e, opts) => { try { return startServer(opts || {}); } catch (err) { return { ok: false, error: String(err.message || err) }; } });
ipcMain.handle('server-stop', () => { if (server) { server.close(); server = null; } return { ok: true }; });
ipcMain.handle('server-status', () => ({ running: !!server, port: server ? server.port : null }));
ipcMain.handle('quit', () => app.quit());
ipcMain.handle('update-install', async (e, url) => {
  const { installUpdate } = require('./updater.js');
  const send = d => { if (!e.sender.isDestroyed()) e.sender.send('update-progress', d); };
  try { await installUpdate(url, send); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
