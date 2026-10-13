// Игровой сервер «Пустошь»: WebSocket + раздача клиента по HTTP
// Запуск:  node server/server.js --port 7777 --password секрет
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const hashKey = s => crypto.createHash('sha256').update('poostosh:' + String(s || '')).digest('hex');
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
  const serverName = String(opts.name || 'Пустошь').slice(0, 40);
  const motd = String(opts.motd || '').slice(0, 300);
  const maxPlayers = +opts.max || 8;
  const invFirst = opts.invFirst != null ? +opts.invFirst : 24 * 60;   // минут игрового времени до первого вторжения
  const invEvery = +opts.invEvery || 48;                                 // в среднем часов между вторжениями (0 — выключить)
  const log = opts.log || console.log;
  const dataFile = opts.dataDir ? path.join(opts.dataDir, 'world.json') : path.join(__dirname, '..', 'data', 'world.json');
  const version = readVersion();
  const started = Date.now();
  const logLines = [];
  const say = (...a) => { const s = `[${new Date().toLocaleTimeString()}] ` + a.join(' '); logLines.push(s); if (logLines.length > 200) logLines.shift(); log(s); };

  // ---------- состояние мира ----------
  let world = { locStates: {} };
  try { world = JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (e) { /* новый мир */ }
  if (world.time == null) world.time = 8 * 60;
  // персонажи хранятся на сервере: имя + пароль персонажа
  const charsFile = path.join(path.dirname(dataFile), 'chars.json');
  let chars = {};
  try { chars = JSON.parse(fs.readFileSync(charsFile, 'utf8')); } catch (e) { /* пусто */ }
  let dirty = false, dirtyChars = false;
  const saveWorld = () => {
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      if (dirty) { fs.writeFileSync(dataFile, JSON.stringify(world)); dirty = false; }
      if (dirtyChars) { fs.writeFileSync(charsFile, JSON.stringify(chars)); dirtyChars = false; }
    } catch (e) { say('Ошибка сохранения мира:', e.message); }
  };
  // общее игровое время: 1 игровая минута за 2 секунды
  if (!world.defense) world.defense = {};
  if (!world.stats) world.stats = {};
  const leaders = () => Object.values(world.stats).sort((a, b) => (b.invasions || 0) * 10 + (b.contracts || 0) * 5 + (b.caravans || 0) * 3 + (b.kills || 0) * 0.1
    - ((a.invasions || 0) * 10 + (a.contracts || 0) * 5 + (a.caravans || 0) * 3 + (a.kills || 0) * 0.1)).slice(0, 20);
  // вторжения на поселения — общие для всех игроков сервера
  const INV_LOCS = ['camp', 'rassvet'];
  function tickInvasion() {
    const online = [...players.values()].some(p => p.ready);
    const inv = world.invasion;
    if (inv && !inv.done && world.time > inv.until) { inv.done = 'lost'; dirty = true; toAll({ t: 'invasion', inv }); say('Вторжение не отбито:', inv.loc); }
    if (!online || (inv && !inv.done)) return;
    if (!invEvery) return;
    if (world.nextInv == null) world.nextInv = world.time + invFirst;
    if (world.time < world.nextInv) return;
    world.invCount = (world.invCount || 0) + 1;
    world.invasion = { id: Date.now(), loc: INV_LOCS[Math.floor(Math.random() * INV_LOCS.length)], kind: Math.random() < 0.5 ? 'infected' : 'column', until: world.time + 24 * 60, done: false, n: world.invCount };
    world.nextInv = world.time + Math.round(invEvery * (0.75 + Math.random() * 0.5) * 60);
    dirty = true;
    toAll({ t: 'invasion', inv: world.invasion });
    say('Вторжение:', world.invasion.kind, '→', world.invasion.loc);
  }
  const clock = setInterval(() => { world.time++; dirty = true; if (world.time % 10 === 0) tickInvasion(); }, 2000);
  const clockBroadcast = setInterval(() => toAll({ t: 'time', time: world.time }), 10000);
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
      res.end(JSON.stringify({ name: serverName, motd, max: maxPlayers, version, players: playerList(), uptime: Math.round((Date.now() - started) / 1000), log: logLines.slice(-60), addresses: localAddresses(), port, locked: !!password, leaders: leaders().slice(0, 10) }));
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
        if (playerList().length >= maxPlayers) { send(p, { t: 'error', code: 'full', text: `Сервер заполнен (${maxPlayers} игроков)` }); setTimeout(() => ws.close(), 100); return; }
        if (password && m.password !== password) { send(p, { t: 'error', code: 'password', text: 'Неверный пароль' }); say('Отказ (пароль):', p.ip); setTimeout(() => ws.close(), 100); return; }
        const name = String(m.name || 'Странник').slice(0, 18).trim() || 'Странник';
        const nameKey = name.toLowerCase();
        if (playerList().some(x => x.name.toLowerCase() === nameKey)) { send(p, { t: 'error', code: 'online', text: `Персонаж «${name}» уже в игре` }); setTimeout(() => ws.close(), 100); return; }
        const stored = chars[nameKey];
        const h = hashKey(m.charKey);
        if (stored && stored.hash !== h) { send(p, { t: 'error', code: 'charpass', text: `Неверный пароль персонажа «${name}». Если это не ваш персонаж — выберите другое имя.` }); setTimeout(() => ws.close(), 100); return; }
        p.name = name; p.nameKey = nameKey; p.charHash = h; p.ready = true;
        clearTimeout(kick);
        send(p, { t: 'welcome', id: p.id, name, version, players: playerList(), serverName, motd, time: world.time, char: stored ? stored.data : null, invasion: world.invasion || null, defense: world.defense });
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
          if (m.to) { const t = players.get(m.to); if (t && (t.loc === p.loc || /^(trade|party)/.test(String(m.kind)))) send(t, { ...m, from: p.id, fromName: p.name }); }
          else if (p.loc) toRoom(p.loc, { ...m, from: p.id }, p.id);
          break;
        case 'chat': {
          const text = String(m.text || '').slice(0, 300).trim();
          if (text) { toAll({ t: 'chat', id: p.id, name: p.name, text }); say(`${p.name}: ${text}`); }
          break;
        }
        case 'ping': send(p, { t: 'pong', at: m.at }); break;
        case 'stat': {
          const k = ['invasions', 'contracts', 'kills', 'caravans', 'caravansLost'].includes(m.k) ? m.k : null;
          if (!k) break;
          const st = world.stats[p.nameKey] = world.stats[p.nameKey] || { name: p.name };
          st[k] = (st[k] || 0) + 1; dirty = true;
          break;
        }
        case 'leaders': send(p, { t: 'leaders', list: leaders() }); break;
        case 'invdone':
          if (world.invasion && world.invasion.id === m.id && !world.invasion.done) {
            world.invasion.done = 'won'; dirty = true; toAll({ t: 'invasion', inv: world.invasion }); say('Вторжение отбито:', world.invasion.loc, '—', p.name);
          }
          break;
        case 'defense': {
          const loc = String(m.loc), kind = m.kind === 'walls' ? 'walls' : 'turrets';
          if (!INV_LOCS.includes(loc)) break;
          const d = world.defense[loc] = world.defense[loc] || { walls: 0, turrets: 0 };
          if ((d[kind] || 0) < 3) { d[kind] = (d[kind] || 0) + 1; dirty = true; toAll({ t: 'defense', defense: world.defense }); say(p.name, 'укрепил', loc, kind, d[kind]); }
          break;
        }
        case 'savechar': {
          const js = JSON.stringify(m.data || null);
          if (m.data && js.length < 400000) { chars[p.nameKey] = { hash: p.charHash, name: p.name, saved: Date.now(), data: m.data }; dirtyChars = true; }
          break;
        }
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
    say(`Сервер «${serverName}» ${version} запущен. Порт ${port}${password ? ', с паролем' : ', без пароля'}, до ${maxPlayers} игроков.`);
    say('Адреса для подключения:', [...localAddresses(), '127.0.0.1'].join(', '));
  });

  return {
    port, version, addresses: localAddresses(),
    close() { clearInterval(saveTimer); clearInterval(clock); clearInterval(clockBroadcast); dirty = true; saveWorld(); for (const p of players.values()) p.ws.close(); wss.close(); httpServer.close(); say('Сервер остановлен.'); },
  };
}

module.exports = { createServer, localAddresses };

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
  const env = process.env;
  const srv = createServer({
    port: arg('port', env.PORT || 7777), password: arg('password', env.PASSWORD || ''), dataDir: arg('data', env.DATA_DIR || null),
    name: arg('name', env.SERVER_NAME || 'Пустошь'), motd: arg('motd', env.MOTD || ''), max: arg('max', env.MAX_PLAYERS || 8),
    invFirst: arg('inv-first', env.INVASION_FIRST_MIN ?? null), invEvery: arg('inv-every', env.INVASION_EVERY_H || 48),
  });
  const stop = () => { srv.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
