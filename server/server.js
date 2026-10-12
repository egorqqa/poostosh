// Игровой сервер «Пустошь»: WebSocket + раздача клиента по HTTP
// Запуск:  node server/server.js --port 7777 --password секрет
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const GAME_DIR = path.join(__dirname, '..', 'game');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

function readVersion() {
  try { return /GAME_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(GAME_DIR, 'js', 'version.js'), 'utf8'))[1]; } catch (e) { return '?'; }
}

function localAddresses() {
  const res = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) res.push(n.address);
  return res;
}

function createServer(opts = {}) {
  const port = +opts.port || 7777;
  const password = String(opts.password || '');
  const log = opts.log || console.log;
  const dataFile = opts.dataDir ? path.join(opts.dataDir, 'world.json') : path.join(__dirname, '..', 'data', 'world.json');
  const version = readVersion();
  const started = Date.now();
  const logLines = [];
  const say = (...a) => { const s = `[${new Date().toLocaleTimeString()}] ` + a.join(' '); logLines.push(s); if (logLines.length > 200) logLines.shift(); log(s); };

  // ---------- состояние мира ----------
  let world = { locStates: {} };
  try { world = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (e) { /* новый мир */ }
  let dirty = false;
  const saveWorld = () => {
    if (!dirty) return;
    try { fs.mkdirSync(path.dirname(dataFile), { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify(world)); dirty = false; } catch (e) { say('Ошибка сохранения мира:', e.message); }
  };
  const saveTimer = setInterval(saveWorld, 20000);
  const persistent = loc => loc && !String(loc).startsWith('wild');

  const players = new Map(); // id → { ws, name, loc, state }
  const authority = {}; // loc → id
  let nextId = 1;

  const send = (p, msg) => { if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); };
  const room = loc => [...players.values()].filter(p => p.loc === loc && p.ready);
  const toRoom = (loc, msg, exceptId) => { for (const p of room(loc)) if (p.id !== exceptId) send(p, msg); };
  const toAll = (msg, exceptId) => { for (const p of players.values()) if (p.ready && p.id !== exceptId) send(p, msg); };
  const playerList = () => [...players.values()].filter(p => p.ready).map(p => ({ id: p.id, name: p.name, loc: p.loc }));

  function leaveRoom(p, state) {
    const loc = p.loc;
    if (!loc) return;
    if (state && authority[loc] === p.id && persistent(loc)) { world.locStates[loc] = state; dirty = true; }
    p.loc = null;
    toRoom(loc, { t: 'pleft', id: p.id, loc });
    if (authority[loc] === p.id) {
      const next = room(loc)[0];
      if (next) { authority[loc] = next.id; send(next, { t: 'auth', loc, authority: true }); toRoom(loc, { t: 'authority', loc, id: next.id }); }
      else delete authority[loc];
    }
  }

  function patchState(loc, op) {
    const st = world.locStates[loc];
    if (!st || !op || !op.set) return;
    if (op.kind === 'ent') { const a = st.actors.find(x => x.id === op.id); if (a) Object.assign(a, op.set); }
    if (op.kind === 'obj') { const o = st.objects.find(x => x.uid === op.uid); if (o) Object.assign(o, op.set); }
    dirty = true;
  }

  // ---------- HTTP ----------
  const httpServer = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/info') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ name: 'Пустошь', version, players: playerList(), uptime: Math.round((Date.now() - started) / 1000), log: logLines.slice(-60), addresses: localAddresses(), port, locked: !!password }));
      return;
    }
    if (url === '/server') { serveFile(path.join(__dirname, 'status.html'), res); return; }
    const file = path.normalize(path.join(GAME_DIR, url === '/' ? 'index.html' : url));
    if (!file.startsWith(GAME_DIR)) { res.writeHead(403); res.end(); return; }
    serveFile(file, res);
  });
  function serveFile(file, res) {
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 4 * 1024 * 1024 });
  wss.on('connection', (ws, req) => {
    const p = { id: nextId++, ws, name: '?', loc: null, state: null, ready: false, ip: req.socket.remoteAddress };
    players.set(p.id, p);
    const kick = setTimeout(() => { if (!p.ready) ws.close(); }, 10000);

    ws.on('message', raw => {
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      if (!p.ready) {
        if (m.t !== 'hello') return;
        if (password && m.password !== password) { send(p, { t: 'error', code: 'password', text: 'Неверный пароль' }); say('Отказ (пароль):', p.ip); setTimeout(() => ws.close(), 100); return; }
        let name = String(m.name || 'Странник').slice(0, 18).trim() || 'Странник';
        const taken = new Set(playerList().map(x => x.name));
        for (let i = 2; taken.has(name); i++) name = `${String(m.name).slice(0, 15)} ${i}`;
        p.name = name; p.ready = true;
        clearTimeout(kick);
        send(p, { t: 'welcome', id: p.id, name, version, players: playerList() });
        toAll({ t: 'players', players: playerList() });
        toAll({ t: 'chat', system: true, text: `${name} заходит на сервер.` }, p.id);
        say('Вошёл:', name, `(${p.ip})`, m.version !== version ? `— версия клиента ${m.version}, сервера ${version}` : '');
        return;
      }
      switch (m.t) {
        case 'enter': {
          leaveRoom(p, null);
          p.loc = String(m.loc);
          p.state = null;
          const isAuth = !authority[p.loc];
          if (isAuth) authority[p.loc] = p.id;
          const others = room(p.loc).filter(x => x.id !== p.id).map(x => ({ id: x.id, name: x.name, state: x.state }));
          send(p, { t: 'locstate', req: m.req, loc: p.loc, state: world.locStates[p.loc] || null, authority: isAuth, authorityId: authority[p.loc], players: others });
          toAll({ t: 'players', players: playerList() });
          break;
        }
        case 'leave':
          leaveRoom(p, m.state);
          toAll({ t: 'players', players: playerList() });
          break;
        case 'upload':
          if (p.loc === m.loc && authority[p.loc] === p.id && persistent(p.loc) && m.state) { world.locStates[p.loc] = m.state; dirty = true; }
          break;
        case 'pstate':
          p.state = m.s;
          if (p.loc) toRoom(p.loc, { t: 'pstate', id: p.id, name: p.name, s: m.s }, p.id);
          break;
        case 'snap':
          if (p.loc && authority[p.loc] === p.id) toRoom(p.loc, m, p.id);
          break;
        case 'op':
          if (!p.loc) break;
          patchState(p.loc, m);
          toRoom(p.loc, m, p.id);
          break;
        case 'req': {
          const a = players.get(authority[p.loc]);
          if (a && a.id !== p.id) send(a, { ...m, from: p.id });
          break;
        }
        case 'ev':
          if (m.to) { const t = players.get(m.to); if (t && t.loc === p.loc) send(t, { ...m, from: p.id }); }
          else if (p.loc) toRoom(p.loc, { ...m, from: p.id }, p.id);
          break;
        case 'chat': {
          const text = String(m.text || '').slice(0, 300).trim();
          if (text) { toAll({ t: 'chat', id: p.id, name: p.name, text }); say(`${p.name}: ${text}`); }
          break;
        }
        case 'ping': send(p, { t: 'pong', at: m.at }); break;
      }
    });

    ws.on('close', () => {
      clearTimeout(kick);
      if (p.ready) {
        leaveRoom(p, null);
        players.delete(p.id);
        toAll({ t: 'players', players: playerList() });
        toAll({ t: 'chat', system: true, text: `${p.name} покидает сервер.` });
        say('Вышел:', p.name);
      } else players.delete(p.id);
    });
  });

  httpServer.on('error', e => say('Ошибка сервера:', e.message));
  httpServer.listen(port, () => {
    say(`Сервер «Пустошь» ${version} запущен. Порт ${port}${password ? ', с паролем' : ', без пароля'}.`);
    say('Адреса для подключения:', [...localAddresses(), '127.0.0.1'].join(', '));
  });

  return {
    port, version, addresses: localAddresses(),
    close() { clearInterval(saveTimer); dirty = true; saveWorld(); for (const p of players.values()) p.ws.close(); wss.close(); httpServer.close(); say('Сервер остановлен.'); },
  };
}

module.exports = { createServer, localAddresses };

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
  const srv = createServer({ port: arg('port', 7777), password: arg('password', ''), dataDir: arg('data', null) });
  const stop = () => { srv.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
