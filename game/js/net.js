// Сетевая игра: подключение к серверу, синхронизация игроков, NPC и боя
// Модель: в каждой локации один «ведущий» клиент симулирует NPC и бой, остальные получают снимки и шлют запросы.
window.NET = (function () {
  const N = { active: false, id: null, isAuth: false, ws: null, players: [], server: '', name: '' };
  let locWaiter = null, timers = [], lastPstate = '', lastPstateAt = 0, snapAt = 0;

  N.sim = () => !N.active || N.isAuth;
  N.myId = () => 'p' + N.id;
  const now = () => Date.now();

  // ---------- подключение ----------
  N.connect = function (host, port, password, name, charKey) {
    return new Promise((resolve, reject) => {
      let done = false;
      let ws;
      try { ws = new WebSocket(`ws://${host}:${port}/ws`); } catch (e) { reject('Неверный адрес'); return; }
      const fail = text => { if (!done) { done = true; reject(text); try { ws.close(); } catch (e) { /* */ } } };
      const to = setTimeout(() => fail('Сервер не отвечает'), 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, password, charKey, version: window.GAME_VERSION }));
      ws.onerror = () => fail('Не удалось подключиться');
      ws.onclose = () => {
        clearTimeout(to);
        if (!done) { fail('Соединение закрыто сервером'); return; }
        if (N.active) { N.active = false; stopTimers(); G.onDisconnect && G.onDisconnect(); }
      };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!done) {
          if (m.t === 'error') { fail(m.text || 'Отказано'); return; }
          if (m.t === 'welcome') {
            done = true; clearTimeout(to);
            Object.assign(N, { ws, active: true, id: m.id, name: m.name, server: `${host}:${port}`, players: m.players, serverVersion: m.version, serverName: m.serverName || 'Пустошь', motd: m.motd || '', char: m.char || null, serverTime: m.time, defense: m.defense || {}, invasion: m.invasion || null });
            startTimers();
            resolve(m);
          }
          return;
        }
        handle(m);
      };
    });
  };
  N.disconnect = function () { if (N.ws) { N.active = false; stopTimers(); N.ws.close(); } };

  const send = m => { if (N.ws && N.ws.readyState === 1) N.ws.send(JSON.stringify(m)); };
  N.send = send;

  N.enter = function (loc) {
    return new Promise(res => { locWaiter = res; send({ t: 'enter', loc }); });
  };
  N.leave = function (loc, state) { N.isAuth = false; send({ t: 'leave', loc, state: state || null }); sendPstate(true); };
  N.req = o => send({ t: 'req', ...o });
  N.event = (pid, o) => send({ t: 'ev', to: pid, ...o });
  N.fx = o => { if (N.active) send({ t: 'ev', kind: 'fx', ...o }); };
  N.chat = text => send({ t: 'chat', text });

  // ---------- синхронизация изменений мира ----------
  N.syncEnt = function (a) {
    if (!N.active || !G.loc || !a || a.isPlayer || a.isRemote) return;
    send({ t: 'op', kind: 'ent', id: a.id, set: { hostile: !!a.hostile, alerted: !!a.alerted, leaving: !!a.leaving, gone: !!a.gone, dead: !!a.dead, hp: a.hp,
      inv: a.inv, caps: a.caps, weapon: a.weapon, armor: a.armor, loaded: a.loaded, stealTries: a.stealTries || 0, wander: a.wander } });
  };
  N.syncObj = function (o) {
    if (!N.active || !G.loc || !o) return;
    send({ t: 'op', kind: 'obj', uid: o.uid, set: { inv: o.inv, caps: o.caps, lock: o.lock, jammed: o.jammed || 0 } });
  };
  N.touch = x => { if (!x) return; if (x.fw != null) N.syncObj(x); else N.syncEnt(x); };

  // ---------- игроки ----------
  N.resolve = function (id) {
    if (!G.loc || id == null) return null;
    if (G.player && id === G.player.id) return G.player;
    return G.loc.actors.find(a => a.id === id) || null;
  };

  function moveActorTo(a, x, y, dir) {
    if (dir != null) a.dir = dir;
    if (a.x === x && a.y === y) return;
    if (Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) > 2 || a.rx == null) { a.rx = x; a.ry = y; a.moving = false; }
    else a.moving = true;
    a.x = x; a.y = y;
  }
  N.moveActorTo = moveActorTo;

  N.applyPstate = function (pid, name, s) {
    const L = G.loc;
    if (!L || !s || s.loc !== L.id) { removeProxy(pid); return; }
    const id = 'p' + pid;
    let a = L.actors.find(x => x.id === id);
    if (!a) {
      a = { id, pid, isRemote: true, tint: 'remote', faction: 'player', inv: [], caps: 0, tags: [], skillPts: {}, skillBonus: {},
        x: s.x, y: s.y, rx: s.x, ry: s.y, path: [], moving: false, walkPhase: 0, aimT: 0, hitFlash: 0, dir: s.dir || 0 };
      L.actors.push(a);
      G.log(`${name} рядом.`, 'sys');
    }
    a.name = name; a.stats = s.stats; a.skillOverride = s.skills; a.baseHP = s.maxHp; a.level = s.level;
    if (!(N.isAuth && a.hpLock > now())) a.hp = s.hp;
    a.weapon = s.weapon; a.armor = s.armor; a.loaded = s.loaded; a.sneaking = s.sneaking; a.perks = s.perks || [];
    if (!s.dead && a.dead) { a.dead = false; }
    if (s.dead) a.dead = true;
    if (!G.combat) moveActorTo(a, s.x, s.y, s.dir);
    if (s.aim) a.aimT = 0.3;
  };

  function removeProxy(pid) {
    const L = G.loc;
    if (!L) return;
    const i = L.actors.findIndex(x => x.id === 'p' + pid);
    if (i < 0) return;
    const a = L.actors[i];
    a.gone = true;
    L.actors.splice(i, 1);
    if (G.combat && G.combat.list) {
      const k = G.combat.list.indexOf(a);
      if (k >= 0) {
        if (G.combat.current === a) setTimeout(() => COMBAT.endTurnOf(G, a), 0);
        else { G.combat.list.splice(k, 1); if (k <= G.combat.idx) G.combat.idx--; }
      }
    }
  }

  function buildPstate() {
    const p = G.player;
    const inLoc = G.scene === 'local' && G.loc;
    return {
      loc: inLoc ? G.loc.id : null, x: p.x, y: p.y, dir: p.dir, hp: p.hp, maxHp: R.maxHP(p), sneaking: !!G.sneaking,
      stats: p.stats, skills: Object.fromEntries(DATA.SKILLS.map(k => [k.id, R.skill(p, k.id)])),
      weapon: p.weapon, armor: p.armor, loaded: p.loaded, level: p.level, dead: !!p.dead, aim: p.aimT > 0, perks: p.perks || [],
    };
  }
  function sendPstate(force) {
    if (!N.active || !G.player) return;
    const s = buildPstate();
    const js = JSON.stringify(s);
    if (!force && js === lastPstate && now() - lastPstateAt < 2000) return;
    lastPstate = js; lastPstateAt = now();
    send({ t: 'pstate', s });
  }

  // ---------- снимки ведущего ----------
  function hasGuests() { return G.loc && G.loc.actors.some(a => a.isRemote); }
  function sendSnap() {
    const L = G.loc;
    const npcs = [];
    for (const a of L.actors) {
      if (a.isPlayer || a.isRemote) continue;
      const f = (a.hostile ? 1 : 0) | (a.alerted ? 2 : 0) | (a.dead ? 4 : 0) | (a.leaving ? 8 : 0) | (a.gone ? 16 : 0) | (a.aimT > 0 ? 32 : 0);
      npcs.push([a.id, a.x, a.y, a.dir, a.hp, f, a.bubble ? a.bubble.text : 0]);
    }
    const c = G.combat && !G.combat.mirror ? { cur: G.combat.current ? G.combat.current.id : null, round: G.combat.round } : null;
    const pp = L.actors.filter(a => a.isPlayer || a.isRemote).map(a => [a.id, a.x, a.y, a.dir]);
    send({ t: 'snap', loc: L.id, n: npcs, c, pp });
  }
  N.forceSnap = () => { if (N.active && N.isAuth && hasGuests()) sendSnap(); };

  function makeMirror() {
    return {
      mirror: true, current: null, round: 1, busy: true, onAck: null,
      isPlayerTurn() { return this.current === G.player; },
      spend(n) {
        if (!this.isPlayerTurn() || G.player.ap < n) return false;
        G.player.ap -= n; send({ t: 'req', act: 'spend', n }); UI.refresh(); return true;
      },
    };
  }

  function applySnap(m) {
    const L = G.loc;
    if (!L || m.loc !== L.id || N.isAuth) return;
    for (const [id, x, y, dir, hp, f, bubble] of m.n) {
      const a = L.actors.find(z => z.id === id);
      if (!a) continue;
      a.hp = hp; a.hostile = !!(f & 1); a.alerted = !!(f & 2); a.leaving = !!(f & 8); a.gone = !!(f & 16);
      if ((f & 4) && !a.dead) { a.dead = true; a.moving = false; }
      if (f & 32) a.aimT = 0.3;
      if (!a.dead) moveActorTo(a, x, y, dir);
      if (bubble && (!a.bubble || a.bubble.text !== bubble)) a.bubble = { text: bubble, t: 2, color: bubble === '!' || bubble === 'Стоять!' ? '#ff5a3c' : '#f0b43c' };
    }
    if (m.c) {
      if (!G.combat || !G.combat.mirror) {
        G.combat = makeMirror(); G.sneaking = false;
        G.log('=== БОЙ! ===', 'warn');
        SND.setCombat(true); TUT.mark('combat');
        UI.setMode('move');
      }
      const cur = N.resolve(m.c.cur);
      if (cur !== G.player) { G.combat.current = cur || { name: '…' }; }
      G.combat.round = m.c.round;
      for (const [id, x, y, dir] of m.pp) {
        const a = N.resolve(id);
        if (a) moveActorTo(a, x, y, dir);
      }
    } else if (G.combat && G.combat.mirror) {
      G.combat = null;
      G.player.ap = R.maxAP(G.player);
      G.log('Бой окончен.', 'warn');
      SND.setCombat(false);
    }
    UI.refresh();
  }

  function applyOp(m) {
    const L = G.loc;
    if (!L) return;
    if (m.kind === 'ent') {
      const a = L.actors.find(z => z.id === m.id);
      if (a) { Object.assign(a, m.set); if (a.dead) a.moving = false; }
    } else if (m.kind === 'obj') {
      const o = L.objects.find(z => z.uid === m.uid);
      if (o) Object.assign(o, m.set);
    }
    UI.refresh();
  }

  // ---------- запросы к ведущему ----------
  function handleReq(m) {
    if (!N.isAuth || !G.loc) return;
    const pr = N.resolve('p' + m.from);
    if (!pr) return;
    const ack = (msg) => N.event(m.from, { kind: 'ack', ap: pr.ap, x: pr.x, y: pr.y, msg });
    switch (m.act) {
      case 'move':
        if (G.combat && G.combat.current === pr && !G.combat.busy) COMBAT.actorWalk(G, pr, (m.path || []).slice(0, pr.ap)).then(() => ack());
        else ack();
        break;
      case 'attack': {
        const t = N.resolve(m.target);
        if (!t || t.dead) { ack('Цель недоступна.'); break; }
        COMBAT.actorAttack(G, pr, t, m.aim).then(r => ack(typeof r === 'string' ? r : null));
        break;
      }
      case 'end': COMBAT.endTurnOf(G, pr); break;
      case 'spend': pr.ap = Math.max(0, (pr.ap || 0) - (+m.n || 0)); break;
      case 'combat': {
        const npc = N.resolve(m.npc);
        if (npc) { npc.hostile = true; npc.alerted = true; }
        COMBAT.start(G, npc, m.first ? pr : null);
        break;
      }
      case 'grace': pr.graceUntil = now() + 10000; break;
    }
  }

  function handleEv(m) {
    const p = G.player;
    switch (m.kind) {
      case 'fx': if (G.loc) COMBAT.showAttack(G, m); break;
      case 'hit': p.hp = Math.max(0, p.hp - m.dmg); p.hitFlash = 0.15; p.damagedSinceTurn = true; UI.refresh(); break;
      case 'died': if (!p.dead) G.gameOver(); break;
      case 'xp': G.giveXP(m.n); break;
      case 'ammo': p.loaded = Math.max(0, p.loaded - 1); UI.refresh(); break;
      case 'turn':
        if (!G.combat || !G.combat.mirror) G.combat = makeMirror();
        G.combat.current = p; G.combat.busy = false; p.ap = m.ap;
        COMBAT.checkFlee(G);
        G.hint('Ваш ход'); UI.refresh();
        break;
      case 'ack': {
        const c = G.combat;
        p.ap = m.ap;
        if (m.x != null && c) moveActorTo(p, m.x, m.y);
        if (m.msg) G.log(m.msg, 'warn');
        if (c && c.mirror) {
          c.busy = false;
          const cb = c.onAck; c.onAck = null;
          if (cb) cb();
          if (c.isPlayerTurn() && p.ap <= 0) setTimeout(() => COMBAT.endPlayerTurn(G), 350);
        }
        UI.refresh();
        break;
      }
      case 'dialog': { const npc = N.resolve(m.npc); if (npc && G.mode !== 'dialog') { npc.bubble = { text: 'Стоять!', t: 2.5, color: '#ff5a3c' }; WORLD_API.startDialog(G, npc); } break; }
      case 'log': G.log(m.text, m.cls); break;
      default: if (window.SOC) SOC.onEv(m);
    }
  }

  function handle(m) {
    switch (m.t) {
      case 'locstate': if (locWaiter) { const w = locWaiter; locWaiter = null; w(m); } break;
      case 'auth':
        if (G.loc && m.loc === G.loc.id) {
          N.isAuth = !!m.authority;
          if (N.isAuth && G.combat && G.combat.mirror) { G.combat = null; G.log('Ведущий игрок ушёл — бой прерван.', 'warn'); }
          for (const a of G.loc.actors) if (!a.isPlayer && !a.isRemote) a.path = [];
        }
        break;
      case 'pstate': N.applyPstate(m.id, m.name, m.s); break;
      case 'pleft': removeProxy(m.id); break;
      case 'players': N.players = m.players; UI.refresh(); break;
      case 'snap': applySnap(m); break;
      case 'op': applyOp(m); break;
      case 'req': handleReq(m); break;
      case 'ev': handleEv(m); break;
      case 'time': if (G.player) G.time = m.time; break;
      case 'invasion': if (G.player) G.onServerInvasion(m.inv); break;
      case 'leaders': if (N.onLeaders) N.onLeaders(m.list || []); break;
      case 'defense': N.defense = m.defense || {}; UI.refresh(); break;
      case 'chat': G.log(m.system ? m.text : `[${m.name}] ${m.text}`, m.system ? 'sys' : 'chat'); break;
    }
  }

  // ---------- таймеры ----------
  function startTimers() {
    stopTimers();
    timers.push(setInterval(() => {
      sendPstate(false);
      if (N.isAuth && G.loc && G.scene === 'local' && hasGuests() && now() - snapAt >= 180) { snapAt = now(); sendSnap(); }
    }, 90));
    timers.push(setInterval(() => {
      if (N.isAuth && G.loc && G.scene === 'local' && !G.loc.def.temp) send({ t: 'upload', loc: G.loc.id, state: WORLD_API.serializeLocation(G) });
    }, 3000));
    timers.push(setInterval(() => { if (G.saveMP) G.saveMP(true); }, 60000));
  }
  function stopTimers() { timers.forEach(clearInterval); timers = []; }

  return N;
})();
