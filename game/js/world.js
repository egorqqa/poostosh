// Логика локаций: загрузка, движение, взаимодействие, скрытность, кража, взлом, диалоги
window.WORLD_API = (function () {
  const { LOCATIONS, ITEMS, DIALOGS, NPCS } = DATA;
  const W = {};

  // ---------- построение локации ----------
  function buildObjects(def) {
    return def.objects.map(([sprite, x, y, o = {}], i) => {
      const im = ENG.img[sprite];
      const auto = Math.max(1, Math.round((im ? im.width : 64) / 64 * 0.7));
      return {
        uid: i, sprite, x, y, fw: o.fw || auto, fh: o.fh || auto, oy: o.oy != null ? o.oy : 4,
        block: o.block !== false, desc: o.desc || null, gate: o.gate || null, showIf: o.showIf || null, interact: o.container ? null : DATA.INTERACT[o.interact || sprite] || null,
        name: o.name || (o.container ? 'Ящик' : DATA.INTERACT[o.interact || sprite] ? DATA.INTERACT[o.interact || sprite].name : null),
        container: !!o.container, lock: o.lock || 0, owner: o.owner || null, caps: o.caps || 0,
        inv: (o.items || []).map(([id, n]) => ({ id, n })), jammed: false,
      };
    });
  }

  function buildGrids(L) {
    L.blocked = new Uint8Array(L.w * L.h);
    L.sight = new Uint8Array(L.w * L.h);
    const rv = L.def.river;
    if (rv) for (let y = rv.y0; y <= rv.y1; y++) for (let x = 0; x < L.w; x++) if (x < rv.bx0 || x > rv.bx1) L.blocked[y * L.w + x] = 1;
    for (const o of L.objects) {
      if (o.gate) o.hidden = !!(window.G && G.flags && G.flags[o.gate]);
      if (o.showIf) o.hidden = !(window.G && G.flags && G.flags[o.showIf]);
      if (!o.block || o.hidden) continue;
      for (let y = o.y; y < o.y + o.fh; y++) for (let x = o.x; x < o.x + o.fw; x++) {
        if (x < 0 || y < 0 || x >= L.w || y >= L.h) continue;
        L.blocked[y * L.w + x] = 1;
        if (o.fw * o.fh >= 6) L.sight[y * L.w + x] = 1;
      }
    }
  }

  W.refreshGates = function (G) {
    if (!G.loc) return;
    buildGrids(G.loc);
    if (window.MINI) MINI.cache = null;
  };
  W.exitRect = (L, x, y) => L && L.def.exits ? L.def.exits.find(r => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) || null : null;
  // уйти через выход: на карту мира или в соседнюю локацию (интерьеры)
  W.useExit = function (G, rect) {
    if (rect && rect.to) {
      if (G.combat) {
        if (!(G.combat.canFlee && G.combat.isPlayerTurn())) { G.log('Нельзя уйти во время боя!', 'bad'); return; }
        if (G.combat.mirror) G.combat = null; else COMBAT.end(G, 'Вы уходите с поля боя.');
      }
      leaveCurrent(G);
      W.goLocation(G, rect.to, { at: rect.at });
      return;
    }
    W.leaveToWorld(G, rect && rect.world);
  };
  function leaveCurrent(G) {
    if (NET.active) NET.leave(G.loc.id, NET.isAuth && !G.loc.def.temp ? W.serializeLocation(G) : null);
    else W.saveLocationState(G);
    G.loc = null;
  }
  // укрепления: стены и турели поверх обычных объектов
  function defenseObjects(G, id) {
    const d = G.defense ? G.defense(id) : { walls: 0, turrets: 0 };
    const LAY = {
      camp: { walls: [[['mil_sandwall', 9, 37, { fw: 4, fh: 1 }], ['mil_sandwall', 30, 37, { fw: 4, fh: 1 }]], [['mil_barrier', 14, 36, {}], ['mil_barrier2', 28, 36, {}], ['hedgehog', 6, 36, {}]], [['mil_sandwall', 2, 34, { fw: 4, fh: 1 }], ['mil_sandwall', 36, 34, { fw: 4, fh: 1 }], ['hedgehog', 34, 37, {}]]],
        turrets: [['mil_mg_bunker', 15, 33, { fw: 3, fh: 2, oy: 6, name: 'Турель' }], ['mil_mg_bunker', 28, 32, { fw: 3, fh: 2, oy: 6, name: 'Турель' }], ['mil_mg_bunker', 5, 30, { fw: 3, fh: 2, oy: 6, name: 'Турель' }]] },
      rassvet: { walls: [[['mil_sandwall', 8, 33, { fw: 4, fh: 1 }], ['mil_sandwall', 28, 33, { fw: 4, fh: 1 }]], [['mil_barrier', 13, 34, {}], ['mil_barrier2', 26, 34, {}], ['hedgehog', 4, 32, {}]], [['mil_sandwall', 2, 28, { fw: 4, fh: 1 }], ['mil_sandwall', 33, 28, { fw: 4, fh: 1 }], ['hedgehog', 36, 31, {}]]],
        turrets: [['mil_mg_bunker', 11, 29, { fw: 3, fh: 2, oy: 6, name: 'Турель' }], ['mil_mg_bunker', 27, 29, { fw: 3, fh: 2, oy: 6, name: 'Турель' }], ['mil_mg_bunker', 19, 28, { fw: 3, fh: 2, oy: 6, name: 'Турель' }]] },
    }[id];
    if (!LAY) return [];
    const out = [];
    for (let i = 0; i < d.walls; i++) out.push(...LAY.walls[i]);
    for (let i = 0; i < d.turrets; i++) out.push(LAY.turrets[i]);
    return out;
  }
  W.isExit = (L, x, y) => {
    if (!L) return false;
    if (L.def.exits) return L.def.exits.some(r => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
    return x <= 0 || y <= 0 || x >= L.w - 1 || y >= L.h - 1;
  };

  // случайная встреча: локация генерируется на лету
  function wildDef(seed, kind) {
    const r = ENG.seeded(seed);
    const props = ['tree_dead', 'tree_dead2', 'rocks', 'rocks2', 'rocks_big', 'bush_dry', 'stump', 'log', 'log2', 'wrecked_cars', 'bus', 'tires', 'barrels', 'pole', 'tree_small', 'stump_big', 'hedgehog', 'jersey_red', 'wrecked_car', 'bus2', 'barrels_crates', 'crate_pile', 'sign_quarantine', 'concrete_blocks'];
    const deco = ['grass1', 'grass2', 'grass3', 'grass4', 'weeds', 'flowers', 'bush_low'];
    const objects = [];
    for (let i = 0; i < 22; i++) {
      const s = props[Math.floor(r() * props.length)];
      const x = 2 + Math.floor(r() * 30), y = 2 + Math.floor(r() * 30);
      if (Math.abs(x - 17) < 3 && y > 26) continue;
      objects.push([s, x, y, {}]);
    }
    for (let i = 0; i < 26; i++) objects.push([deco[Math.floor(r() * deco.length)], 1 + Math.floor(r() * 32), 1 + Math.floor(r() * 32), { block: false }]);
    if (r() < 0.7) objects.push(['ammo_box', 10 + Math.floor(r() * 14), 8 + Math.floor(r() * 10), { name: 'Тайник', container: true, lock: r() < 0.5 ? 30 : 0, items: [['ammo9', 8 + Math.floor(r() * 10)], ['bandage', 1], ['junk', 2]] }]);
    const npcs = [];
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const tpl = kind === 'nomads' ? 'nomad_raider' : kind === 'roaches' ? 'roach' : kind === 'wolves' ? 'wolf' : kind === 'rats' ? 'rat' : kind === 'raiders' ? (r() < 0.5 ? 'raider' : 'raider_melee') : (r() < 0.4 ? 'wild_gun' : 'wild');
      npcs.push([tpl, 12 + Math.floor(r() * 10), 6 + Math.floor(r() * 8), { wander: 3 }]);
    }
    if (kind === 'roaches') npcs.push(['roach', 15, 9, { wander: 3 }], ['roach', 19, 12, { wander: 3 }], ['roach', 13, 13, { wander: 3 }]);
    if (kind === 'wolves') { for (let i = 0; i < 6; i++) objects.push([['tree_pine', 'tree_spruce', 'tree_oak', 'tree_dead'][Math.floor(r() * 4)], 2 + Math.floor(r() * 30), 2 + Math.floor(r() * 24), {}]); if (r() < 0.3) npcs.push(['wolf_alpha', 16, 6, { wander: 2 }]); }
    if (kind === 'rats') { npcs.push(['rat', 14, 9, { wander: 3 }], ['rat', 18, 11, { wander: 3 }]); if (r() < 0.35) npcs.push(['rat_big', 16, 7, { wander: 2 }]); }
    return { name: 'Пустошь', w: 34, h: 34, exits: [{ x0: 12, y0: 32, x1: 22, y1: 33 }], ground: ['dirt_tracks', 'overgrown_grassland', 'rubble_ground', 'cracked_road'], groundW: [3, 3, 1, 1], base: '#5b4c35', entry: { x: 17, y: 30 }, objects, npcs, temp: true, desc: 'Безымянный клочок пустоши.' };
  }

  W.loadLocation = function (G, id, opts = {}) {
    let def = LOCATIONS[id] || (id.startsWith('apartment_') ? LOCATIONS.apartment : null);
    if (def && def.objects) def = { ...def, objects: def.objects.concat(defenseObjects(G, id)) };
    if (!def && id.startsWith('wild')) def = wildDef(id, opts.kind || 'wild');
    const saved = G.locStates[id];
    const L = { id, def, w: def.w, h: def.h, seed: opts.seed || '' };
    L.objects = buildObjects(def);
    if (saved) {
      for (const so of saved.objects) Object.assign(L.objects[so.uid], so);
      L.actors = saved.actors;
      // NPC, добавленные в новых версиях игры
      def.npcs.forEach(([tpl, x, y, o], i) => {
        const nid = `${id}_${i}`;
        if (!L.actors.some(a => a.id === nid)) { const a = R.makeNpc(tpl, x, y, o || {}); a.id = nid; L.actors.push(a); }
      });
    } else {
      L.actors = def.npcs.map(([tpl, x, y, o], i) => { const a = R.makeNpc(tpl, x, y, o || {}); a.id = `${id}_${i}`; return a; });
    }
    const p = G.player;
    const e = opts.at || (def.entryEast && G.world && G.world.prevC > 18 + (DATA.WORLD.westShift || 0) ? def.entryEast : def.entry);
    p.x = e.x; p.y = e.y;
    L.actors = L.actors.filter(a => !a.isPlayer && !a.isRemote && !a.isCompanion);
    L.actors.unshift(p);
    if (G.companion && !G.companion.dead) {
      const c = G.companion;
      c.x = e.x; c.y = e.y;
      L.actors.push(c);
    }
    for (const a of L.actors) { a.rx = a.x; a.ry = a.y; a.path = []; a.moving = false; a.walkPhase = 0; a.aimT = 0; a.hitFlash = 0; a.bubble = null; a.alerted = !!a.isCompanion; a.deathAt = a.dead ? -1e9 : null; }
    buildGrids(L);
    if (L.blocked[p.y * L.w + p.x]) { const f = W.freeTile(L, p.x, p.y, p); if (f) { p.x = p.rx = f.x; p.y = p.ry = f.y; } }
    for (const a of L.actors) {
      if (a.isCompanion) { const f = W.freeTile(L, p.x, p.y, a); if (f) { a.x = a.rx = f.x; a.y = a.ry = f.y; } a.waiting = false; continue; }
      if (a.dead || a.gone || !L.blocked[a.y * L.w + a.x]) continue;
      const f = W.freeTile(L, a.x, a.y, a);
      if (f) { a.x = a.rx = f.x; a.y = a.ry = f.y; if (!a.isPlayer) { a.homeX = f.x; a.homeY = f.y; } }
    }
    ENG.buildGround(L);
    G.loc = L;
    G.scene = 'local';
    if (G.combat) { G.combat = null; SND.setCombat(false); }
    G.sneaking = false;
    G.detectT = 0;
    G.grace = 0;
    const c = ENG.tileCenter(p.x, p.y);
    ENG.cam.x = c.x; ENG.cam.y = c.y - 40;
    G.log(`— ${def.name} —`, 'sys');
    SND.setScene(LOCATIONS[id] ? id : 'wild');
    if (id === 'rassvet') { const l = L.actors.find(a => a.tpl === 'lada'); if (l && !G.flags.ladaFree) l.gone = true; }
    const inv = G.flags.invasion;
    if (inv && !inv.done && inv.loc === id && inv.kind === 'horde') W.spawnHorde(G, inv.wave || [], true);
    else if (inv && !inv.done && inv.loc === id) {
      const k = Math.max(1, Math.min(4, inv.n || 1) + 2 - (G.defense(id).walls || 0)) - 2;
      const tpls = inv.kind === 'column' ? ['col_soldier', 'col_soldier', 'col_soldier', 'col_soldier', 'col_soldier'] : ['infected', 'infected', 'z_soldier', 'infected', 'infected_brute'];
      const ex = L.def.exits[0], cx = Math.round((ex.x0 + ex.x1) / 2), cy = Math.min(ex.y0, ex.y1) - 5;
      for (let i = 0; i < Math.max(1, 2 + k); i++) {
        const a = R.makeNpc(tpls[i % tpls.length], cx, cy, {});
        a.id = 'inv_' + i; a.invader = true; a.hostile = true; a.alerted = true; a.faction = 'invaders';
        a.name = (inv.kind === 'column' ? 'Штурмовик Колонны' : a.name);
        const f = W.freeTile(L, cx + R.rnd(-4, 4), cy + R.rnd(-3, 3), a) || { x: cx, y: cy };
        a.x = a.rx = f.x; a.y = a.ry = f.y; a.homeX = f.x; a.homeY = f.y;
        a.path = []; a.moving = false; a.walkPhase = 0; a.aimT = 0; a.hitFlash = 0; a.deathAt = null;
        L.actors.push(a);
      }
      G.log(`⚠ ${inv.kind === 'column' ? 'Штурмовики Колонны' : 'Обращённые'} уже здесь! Защитите поселение.`, 'bad');
    }
    if (id === 'camp' && G.q('finale') === 2 && !NET.active) W.spawnFinale(G);
    if (id === 'observatory' || id === 'obs_dome') {
      const friendly = G.flags.columnEnd === 'joined' || G.flags.granitYield || G.flags.obsDone;
      for (const a of L.actors) {
        if (a.faction === 'column' && !a.dead) { a.hostile = !friendly; if (G.flags.granitYield || G.flags.obsDone) a.gone = true; }
        if (a.tpl === 'lada' && G.flags.ladaFree) a.gone = true;
        if (a.tpl === 'granit_obs' && G.flags.granitDead) a.name = 'Майор Сталь';
      }
    }
    if (id === 'fort' && G.flags.southDone) L.actors.forEach(a => { if (a.faction === 'remnant') { if (G.flags.southDone === 'command') a.hostile = false; else a.gone = true; } });
    if (id === 'hive' && G.flags.southDone) L.actors.forEach(a => { if (a.faction === 'infected') a.gone = true; });
    if (id === 'rassvet' && G.flags.southDone === 'disband') for (let i = 0; i < 2; i++) { const a = R.makeNpc('rem_soldier', 22 + i * 3, 30, {}); a.id = 'rem_guard_' + i; a.name = 'Бывший боец Колонны'; a.faction = 'rassvet'; a.hostile = false; a.dialog = 'rguard'; Object.assign(a, { rx: a.x, ry: a.y, path: [], moving: false, walkPhase: 0, aimT: 0, hitFlash: 0 }); L.actors.push(a); }
    if (id === 'solar' && G.flags.westEnd === 'deal') L.actors.forEach(a => { if (a.faction === 'nomads') a.hostile = false; });
    if (id === 'solar' && (G.flags.westEnd === 'storm' || G.flags.westEnd === 'stolen')) L.actors.forEach(a => { if (a.faction === 'nomads' && G.flags.westEnd === 'storm') a.gone = true; });
    if (id === 'mine' && G.flags.minersFree) L.actors.forEach(a => { if (a.faction === 'miners') a.gone = true; });
    if ((id === 'bastion' || id === 'bastion_hall' || id === 'mine') && (G.flags.northEnd === 'peace' || G.flags.northEnd === 'heir' || G.flags.columnEnd === 'joined')) L.actors.forEach(a => { if (a.faction === 'bastion') a.hostile = false; });
    if (id === 'city') {
      const k = L.actors.find(a => a.tpl === 'klyk_city');
      if (k && G.flags.klykDead) k.name = 'Шрам';
      if (G.flags.klykSurrender || G.flags.klykFled) L.actors.forEach(a => { if (a.tpl === 'klyk_city' || a.tpl === 'klyk_man') a.gone = true; });
      if (G.q('column') === 9) L.actors.forEach(a => { if (a.faction === 'column') a.gone = true; });
    }
    if (id === 'camp' && !NET.active && G.rep() <= -50) {
      for (const a of L.actors) if (a.guard && !a.dead) { a.hostile = true; a.alerted = false; }
      G.log('Охрана Ручья узнаёт вас. Здесь вам не рады.', 'bad');
    }
    TUT.mark('location');
    if (def.desc) G.log(def.desc, 'sys');
    UI.refresh();
  };

  W.serializeLocation = function (G) {
    const L = G.loc;
    return {
      objects: L.objects.filter(o => o.container).map(o => ({ uid: o.uid, inv: o.inv, lock: o.lock, caps: o.caps, jammed: o.jammed })),
      actors: L.actors.filter(a => !a.isPlayer && !a.isRemote && !a.isCompanion && !a.gone && !a.invader).map(a => {
        const c = { ...a };
        delete c.path; delete c.onArrive; delete c.stepCb; delete c.bubble;
        return c;
      }),
    };
  };
  W.freeTile = function (L, x, y, ignore) {
    for (let r = 1; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (ENG.passable(L, nx, ny, ignore) && !W.isExit(L, nx, ny)) return { x: nx, y: ny };
      }
    }
    return null;
  };

  W.spawnFinale = function (G) {
    const wave = G.finaleWave();
    if (!W.spawnHorde(G, wave.list, false)) return;
    for (const h of wave.help) G.log(h, 'good');
  };
  // орда «Пепел» у входа в локацию; invader — общая сетевая орда (не сохраняется в состоянии локации)
  W.spawnHorde = function (G, list, invader) {
    const L = G.loc;
    if (!L || L.actors.some(a => a.finalWave)) return false;
    const ex = L.def.exits[0], cx = Math.round((ex.x0 + ex.x1) / 2), cy = Math.min(ex.y0, ex.y1) - 5;
    list.slice(0, 12).forEach(([tpl, name], i) => {
      if (!DATA.NPCS[tpl]) return;
      const a = R.makeNpc(tpl, cx, cy, {});
      a.id = 'ash_' + i; a.finalWave = true; a.invader = !!invader; a.hostile = true; a.alerted = true; a.faction = 'horde'; a.name = String(name).slice(0, 40);
      const f = W.freeTile(L, cx + R.rnd(-4, 4), cy + R.rnd(-3, 3), a) || { x: cx, y: cy };
      a.x = a.rx = f.x; a.y = a.ry = f.y; a.homeX = f.x; a.homeY = f.y;
      a.path = []; a.moving = false; a.walkPhase = 0; a.aimT = 0; a.hitFlash = 0; a.deathAt = null;
      L.actors.push(a); NET.syncEnt(a);
    });
    G.log('⚠ Орда «Пепел» штурмует Ржавый Ручей!', 'bad');
    SND.play('alert');
    return true;
  };
  W.saveLocationState = function (G) {
    const L = G.loc;
    if (!L || L.def.temp) return;
    G.locStates[L.id] = W.serializeLocation(G);
  };

  // переход в локацию (в сетевой игре — с получением состояния от сервера)
  W.goLocation = async function (G, id, opts = {}) {
    if (NET.active && id === 'apartment') id = 'apartment_' + NET.name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '_'); // своя квартира у каждого игрока
    if (G.world) { G.world.visited = G.world.visited || {}; G.world.visited[id] = true; if (G.world.target === id) G.world.target = null; }
    if (id === 'zarya_lab' && G.q('zarya') >= 1 && G.q('zarya') < 3) G.setQuest('zarya', 3);
    if (id === 'object9' && G.q('thread') === 2) G.setQuest('thread', 3);
    if ((id === 'hive' || id === 'fort') && G.q('south') === 1) G.setQuest('south', 2);
    if (id === 'mine' && G.q('north') === 1) G.setQuest('north', 2);
    if (id === 'oasis' && G.q('west') === 1) G.log('Вы добрались до Оазиса. Найдите Хранительницу Ясну.', 'good');
    if (id === 'city' && G.q('column') === 1) G.setQuest('column', 2);
    if (id === 'observatory' && G.q('obs') === 1) G.setQuest('obs', 2);
    if (!NET.active) { W.loadLocation(G, id, opts); setTimeout(() => G.autosave(), 300); return; }
    const res = await NET.enter(id);
    if (res.state) G.locStates[id] = res.state; else delete G.locStates[id];
    NET.isAuth = !!res.authority;
    W.loadLocation(G, id, opts);
    for (const pl of res.players || []) if (pl.state) NET.applyPstate(pl.id, pl.name, pl.state);
    // не появляться на клетке другого игрока
    const p = G.player, L = G.loc;
    if (L.actors.some(a => a.isRemote && a.x === p.x && a.y === p.y)) {
      for (let r = 1; r < 5; r++) {
        const cells = [];
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) cells.push([p.x + dx, p.y + dy]);
        const c = cells.find(([x, y]) => ENG.passable(L, x, y, p) && !W.isExit(L, x, y));
        if (c) { p.x = p.rx = c[0]; p.y = p.ry = c[1]; break; }
      }
    }
    setTimeout(() => G.autosave(), 300);
  };

  W.leaveToWorld = function (G, worldAt) {
    const cv = G.flags && G.flags.caravan;
    if (cv && cv.escort && G.loc && cv.inFight === G.loc.id && G.loc.actors.some(a => a.hostile && !a.dead && !a.gone)) setTimeout(() => G.caravanDone(false, 'Вы бросили караван!'), 0);
    if (G.loc && G.loc.def.interior) {
      const r = W.exitRect(G.loc, G.player.x, G.player.y);
      if (r) { W.useExit(G, r); return; }
      G.log('Вы в помещении — выйдите через зелёную зону выхода.', 'warn');
      return;
    }
    if (G.combat) {
      if (!(G.combat.canFlee && G.combat.isPlayerTurn())) { G.log('Нельзя уйти во время боя! Встаньте в зелёную зону выхода и переждите ход врагов без ранений.', 'bad'); return; }
      if (G.combat.mirror) G.combat = null; else COMBAT.end(G, 'Вы уходите с поля боя.');
    }
    if (NET.active) {
      const st = NET.isAuth && !G.loc.def.temp ? W.serializeLocation(G) : null;
      NET.leave(G.loc.id, st);
    } else W.saveLocationState(G);
    G.loc = null;
    if (worldAt && G.world) { G.world.c = worldAt.c; G.world.r = worldAt.r; }
    WMAP.enter(G);
    if (G.saveMP) G.saveMP(true);
  };

  // ---------- движение ----------
  W.moveTo = function (G, a, path, onArrive) {
    a.path = path.slice();
    a.onArrive = onArrive || null;
    if (!path.length && onArrive) { a.onArrive = null; onArrive(); }
  };

  W.walkPlayer = function (G, tx, ty, opts = {}) {
    const p = G.player;
    if (R.overloaded(p)) { G.log('Перегруз! Вы не можете двигаться. Выбросьте лишнее.', 'bad'); return false; }
    const path = ENG.findPath(G.loc, p.x, p.y, tx, ty, opts);
    if (!path) { G.hint('Туда не пройти'); return false; }
    W.moveTo(G, p, path, opts.onArrive);
    TUT.mark('moved');
    return true;
  };

  function speedOf(G, a) {
    if (G.combat) return 5;
    if (a.isPlayer) return G.sneaking ? 2.4 : 4.4;
    if (a.isRemote) return a.sneaking ? 2.6 : 4.8;
    if (a.isCompanion) return G.sneaking ? 2.6 : 4.6;
    return a.hurry ? 4 : 2.2;
  }

  W.update = function (G, dt) {
    const L = G.loc;
    for (const a of L.actors) {
      if (a.dead || a.gone) continue;
      if (a.aimT > 0) a.aimT -= dt;
      if (a.reloadT > 0) a.reloadT -= dt;
      if (a.knockT > 0) a.knockT -= dt;
      if (a.workT > 0) a.workT -= dt;
      if (a.recoilT > 0) a.recoilT -= dt;
      if (a.shakeT > 0) a.shakeT -= dt;
      if (a.hitFlash > 0) a.hitFlash -= dt;
      if (a.bubble) { a.bubble.t -= dt; if (a.bubble.t <= 0) a.bubble = null; }
      if (a.moving) {
        const tx = a.x, ty = a.y;
        const dx = tx - a.rx, dy = ty - a.ry;
        const d = Math.hypot(dx, dy);
        const step = speedOf(G, a) * dt;
        a.walkPhase = (a.walkPhase + dt * (G.sneaking && a.isPlayer ? 0.9 : 1.6)) % 1;
        if (d <= step) {
          a.rx = tx; a.ry = ty; a.moving = false;
          if (a.isPlayer) { SND.play('step', { sneak: G.sneaking }); onPlayerStep(G); }
          else if (G.combat || ENG.dist(a, G.player) < 8) SND.at('step', a.x, a.y, { sneak: true });
          if (a.stepCb) { const cb = a.stepCb; a.stepCb = null; cb(); }
        } else { a.rx += dx / d * step; a.ry += dy / d * step; }
      }
      if (!a.moving && a.path && a.path.length) {
        if (G.mode === 'dialog' && a.isPlayer) { a.path = []; continue; }
        const n = a.path[0];
        if (!ENG.passable(L, n.x, n.y, a)) {
          // клетка занята — перестраиваем путь к конечной точке
          const last = a.path[a.path.length - 1];
          const np = ENG.findPath(L, a.x, a.y, last.x, last.y, { ignore: a });
          if (!np || !np.length || G.combat) { a.path = []; finishPath(a); continue; }
          a.path = np;
          continue;
        }
        a.path.shift();
        a.dir = ENG.dirFromDelta(n.x - a.x, n.y - a.y);
        a.dir8 = ENG.dir8FromDelta(n.x - a.x, n.y - a.y);
        a.x = n.x; a.y = n.y; a.moving = true;
        if (!a.path.length) a.stepCb = () => finishPath(a);
      }
    }
    if (G.loc !== L) return; // игрок вышел из локации в этом кадре
    if (G.loc !== L) return;
    if (!G.combat) updateCompanion(G);
    if (!G.combat && NET.sim()) {
      updateWander(G, dt);
      updateDetection(G, dt);
    } else if (!G.combat) {
      G.risk = Math.max(0, ...L.actors.filter(a => a.hostile && !a.dead && !a.gone && !a.isRemote).map(a => W.sneakRisk(G, a, G.player)));
    }
    if (G.grace > 0) G.grace -= dt;
    // камера
    const p = G.player;
    const c = ENG.tileCenter(p.rx, p.ry);
    ENG.cam.x += (c.x - ENG.cam.x) * Math.min(1, dt * 4);
    ENG.cam.y += (c.y - 40 - ENG.cam.y) * Math.min(1, dt * 4);
  };

  function finishPath(a) {
    const cb = a.onArrive;
    a.onArrive = null;
    if (cb) cb();
  }

  function onPlayerStep(G) {
    const p = G.player, L = G.loc;
    if (!G.combat && W.isExit(L, p.x, p.y) && (!p.path || !p.path.length)) {
      W.useExit(G, W.exitRect(L, p.x, p.y));
    }
  }

  // напарник идёт следом
  function updateCompanion(G) {
    const c = G.companion, p = G.player, L = G.loc;
    if (!c || c.dead || c.waiting || c.moving || (c.path && c.path.length) || !L.actors.includes(c)) return;
    const d = ENG.dist(c, p);
    if (d <= 2) return;
    const path = ENG.findPath(L, c.x, c.y, p.x, p.y, { adjacent: true, ignore: c, maxLen: 60 });
    if (path && path.length) W.moveTo(G, c, path.slice(0, Math.max(1, path.length - 1)));
    else if (d > 14) { const f = W.freeTile(L, p.x, p.y, c); if (f) { c.x = c.rx = f.x; c.y = c.ry = f.y; } }
  }

  function updateWander(G, dt) {
    const L = G.loc;
    for (const a of L.actors) {
      if (a.isPlayer || a.dead || a.gone || !a.wander || a.moving || (a.path && a.path.length)) continue;
      a.wanderT = (a.wanderT || Math.random() * 4) - dt;
      if (a.wanderT > 0) continue;
      a.wanderT = 3 + Math.random() * 5;
      const tx = a.homeX + R.rnd(-a.wander, a.wander), ty = a.homeY + R.rnd(-a.wander, a.wander);
      const path = ENG.findPath(L, a.x, a.y, tx, ty, { ignore: a, maxLen: 12 });
      if (path) W.moveTo(G, a, path);
    }
    // уходящие рейдеры
    for (const a of L.actors) {
      if (a.leaving && !a.gone && !a.moving && (!a.path || !a.path.length)) {
        if (W.isExit(L, a.x, a.y) || a.leaveTries > 3) { a.gone = true; continue; }
        a.leaveTries = (a.leaveTries || 0) + 1;
        a.hurry = true;
        const path = ENG.findPath(L, a.x, a.y, a.x, L.h - 1, { ignore: a, goal: (x, y) => y >= L.h - 1 });
        if (path) W.moveTo(G, a, path); else a.gone = true;
      }
    }
  }

  // ---------- скрытность ----------
  // ночью враги видят хуже: радиус обнаружения до −40%
  W.detectRadius = a => Math.max(3, Math.round((a.stats.per * 2 + 2 + (a.sentry ? 4 : 0)) * (1 - 0.4 * (window.G ? G.nightK() : 0))));
  W.sneakRisk = function (G, a, pl = G.player) {
    if (!pl || pl.dead) return 0;
    const d = ENG.dist(a, pl), R0 = W.detectRadius(a);
    if (d > R0 || !ENG.los(G.loc, a.x, a.y, pl.x, pl.y)) return 0;
    const sneaking = pl.isRemote ? pl.sneaking : G.sneaking;
    if (!sneaking) return 100;
    return R.clamp(Math.round((8 + a.stats.per * 4 - R.skill(pl, 'sneak') * 0.45 + (R0 - d) * 4) * 0.7), 2, 95);
  };

  function updateDetection(G, dt) {
    G.detectT -= dt;
    if (G.detectT > 0) return;
    G.detectT = 1;
    const L = G.loc;
    const pls = [G.player, ...L.actors.filter(a => a.isRemote && !a.dead)];
    let maxRisk = 0;
    for (const pl of pls) {
      const local = pl === G.player;
      if (local && (G.mode === 'dialog' || UI.modalOpen())) continue;
      const graced = local ? G.grace > 0 : pl.graceUntil > Date.now();
      for (const a of L.actors) {
        if (a.isPlayer || a.isRemote || a.dead || a.gone || !a.hostile || a.leaving) continue;
        const risk = W.sneakRisk(G, a, pl);
        if (local) maxRisk = Math.max(maxRisk, risk);
        if (risk && !graced && Math.random() * 100 < risk) {
          a.alerted = true;
          a.bubble = { text: '!', t: 1.5, color: '#ff5a3c' };
          G.log(local ? `${a.name} замечает вас!` : `${a.name} замечает: ${pl.name}!`, 'bad');
          if (local) SND.play('alert');
          onDetected(G, a, pl);
          return;
        }
      }
    }
    G.risk = maxRisk;
  }

  function onDetected(G, spotter, pl) {
    const boss = G.loc.actors.find(a => a.tpl === 'klyk' && !a.dead);
    if (spotter.faction === 'raiders' && boss) {
      if (pl.isRemote && !pl.klykTalked) {
        pl.klykTalked = true; pl.graceUntil = Date.now() + 25000;
        boss.bubble = { text: 'Стоять!', t: 2.5, color: '#ff5a3c' };
        NET.event(pl.pid, { kind: 'dialog', npc: boss.id });
        return;
      }
      if (!pl.isRemote && !G.flags.klykTalked) {
        boss.bubble = { text: 'Стоять!', t: 2.5, color: '#ff5a3c' };
        W.startDialog(G, boss);
        return;
      }
    }
    COMBAT.start(G, spotter, false);
  }

  // свидетели преступления (кража, взлом чужого)
  W.witnesses = function (G, ownerId) {
    const L = G.loc, p = G.player;
    const res = [];
    for (const a of L.actors) {
      if (a.isPlayer || a.dead || a.gone || a.hostile) continue;
      if (a.faction !== 'town' && a.tpl !== ownerId) continue;
      const d = ENG.dist(a, p);
      if (d > W.detectRadius(a) || !ENG.los(L, a.x, a.y, p.x, p.y)) continue;
      const chance = G.sneaking ? R.clamp(25 + a.stats.per * 5 - R.skill(p, 'sneak') * 0.6 - d * 2, 5, 95) : 95 - d * 2;
      if (Math.random() * 100 < chance) res.push(a);
    }
    return res;
  };

  W.crime = function (G, victim, text) {
    const L = G.loc;
    const angry = L.actors.filter(a => !a.dead && !a.gone && !a.isPlayer && (a === victim || (a.guard && a.faction === victim.faction)));
    for (const a of angry) { a.hostile = true; a.alerted = true; NET.syncEnt(a); }
    victim.bubble = { text: text || 'Вор!', t: 2.5, color: '#ff5a3c' };
    G.log(`${victim.name}: «${text || 'Держи вора!'}»`, 'bad');
    if (victim.faction === 'town') G.addRep(-25, 'пойман на воровстве');
    COMBAT.start(G, victim, false);
  };

  // ---------- взаимодействие ----------
  W.objectAt = function (L, x, y) {
    let best = null;
    for (const o of L.objects) {
      if (x >= o.x && x < o.x + o.fw && y >= o.y && y < o.y + o.fh) {
        if (!best || o.container || o.fw * o.fh < best.fw * best.fh) best = o;
      }
    }
    return best;
  };

  // наведение мыши: персонаж (по прямоугольнику спрайта) или объект
  W.pick = function (G, wx, wy) {
    const L = G.loc;
    let actor = null, best = 1e9;
    for (const a of L.actors) {
      if (a.isPlayer || a.gone) continue;
      const sx = (a.rx - a.ry) * 32, sy = (a.rx + a.ry) * 16 + 16;
      const k = a.scale || 1;
      const inside = a.dead ? Math.abs(wx - sx) < (a.model ? 22 * k : 40) && wy > sy - 30 && wy < sy + 6
        : a.model ? Math.abs(wx - sx) < 24 * k && wy > sy - 40 * k && wy < sy + 6 : Math.abs(wx - sx) < 20 && wy > sy - 84 && wy < sy + 4;
      if (inside) { const d = Math.abs(wy - (sy - 40)); if (d < best) { best = d; actor = a; } }
    }
    let obj = null;
    if (!actor) {
      for (const o of L.objects) {
        if (!o.container) continue;
        const r = ENG.objectRect(o);
        if (wx > r.x && wx < r.x + r.w && wy > r.y && wy < r.y + r.h) obj = o;
      }
      if (!obj) {
        const t = ENG.fromIso(wx, wy);
        const o = W.objectAt(L, Math.floor(t.x), Math.floor(t.y));
        if (o && (o.name || o.container)) obj = o;
      }
    }
    return { actor, obj };
  };

  const adjToObj = o => (x, y) => x >= o.x - 1 && x <= o.x + o.fw && y >= o.y - 1 && y <= o.y + o.fh && !(x >= o.x && x < o.x + o.fw && y >= o.y && y < o.y + o.fh);
  const nearObj = (p, o) => adjToObj(o)(p.x, p.y);
  const nearActor = (p, a) => ENG.dist(p, a) <= 1;

  function goThen(G, target, fn) {
    const p = G.player;
    const isObj = target.fw != null;
    if (isObj ? nearObj(p, target) : nearActor(p, target)) { faceTo(p, target); fn(); return; }
    if (G.combat) {
      const path = isObj ? ENG.findPath(G.loc, p.x, p.y, target.x, target.y, { goal: adjToObj(target) }) : ENG.findPath(G.loc, p.x, p.y, target.x, target.y, { adjacent: true });
      if (!path) { G.hint('Не подойти'); return; }
      COMBAT.playerWalk(G, path, () => { if (isObj ? nearObj(p, target) : nearActor(p, target)) fn(); });
      return;
    }
    const ok = isObj ? W.walkPlayer(G, target.x, target.y, { goal: adjToObj(target), onArrive: () => { faceTo(p, target); fn(); } })
      : W.walkPlayer(G, target.x, target.y, { adjacent: true, onArrive: () => { if (nearActor(p, target)) { faceTo(p, target); fn(); } } });
    return ok;
  }
  function faceTo(a, t) {
    const tx = t.fw != null ? t.x + t.fw / 2 : t.x, ty = t.fh != null ? t.y + t.fh / 2 : t.y;
    if (tx !== a.x || ty !== a.y) a.dir = ENG.dirFromDelta(tx - a.x, ty - a.y);
  }

  W.click = function (G, tile, hover) {
    const p = G.player;
    if (G.combat && !G.combat.isPlayerTurn()) return;
    if (G.combat && G.combat.busy) return;
    const mode = G.ui.mode;
    const a = hover.actor, o = hover.obj;

    if (mode === 'look') {
      if (!a && o && o.interact) { W.lookObject(G, o); UI.setMode('move'); return; }
      if (a) G.log(a.dead ? `Труп: ${a.name}.` : `${a.name}. ${describeActor(G, a)}`);
      else if (o) G.log(`${o.name || 'Объект'}${o.desc ? '. ' + o.desc : ''}${o.container && o.lock ? ' Заперто.' : ''}`);
      else G.log('Ничего интересного.', 'sys');
      UI.setMode('move');
      return;
    }
    if (mode === 'throw') {
      const id = G.ui.throwItem, t = a && !a.dead ? { x: a.x, y: a.y } : tile;
      if (!id || !t) { UI.setMode('move'); return; }
      COMBAT.playerThrow(G, t.x, t.y, id).then(err => { if (err) G.log(err, 'warn'); });
      if (!R.count(p, id) || !G.combat) UI.setMode('move');
      return;
    }
    if (mode === 'attack') {
      if (a && !a.dead) COMBAT.playerAttack(G, a);
      else G.hint('Выберите цель');
      return;
    }
    if (mode === 'steal') {
      if (!a || a.dead) { G.hint('Выберите персонажа'); return; }
      if (a.hostile && a.alerted) { G.log('Он вас видит — украсть не выйдет.', 'warn'); return; }
      if (G.combat) { G.log('В бою не до краж.', 'warn'); return; }
      goThen(G, a, () => UI.openSteal(a));
      UI.setMode('move');
      return;
    }
    if (mode === 'lockpick') {
      if (!o || !o.container) { G.hint('Выберите запертый контейнер'); return; }
      goThen(G, o, () => W.lockpick(G, o));
      UI.setMode('move');
      return;
    }
    // обычный режим
    if (a && a.isRemote) {
      if (a.dead) G.log(`${a.name} тяжело ранен.`, 'warn');
      else if (G.combat) G.log(`Игрок ${a.name}, уровень ${a.level || 1}.`, 'sys');
      else SOC.playerMenu(G, a);
      return;
    }
    if (a) {
      if (a.dead) { goThen(G, a, () => UI.openLoot(a)); return; }
      if (a.hostile) { COMBAT.playerAttack(G, a); return; }
      if (a.isCompanion && G.combat) { G.log(`${a.name}: «Прикрываю!»`, 'sys'); return; }
      if (G.combat) { G.log('Сейчас не время для разговоров.', 'warn'); return; }
      goThen(G, a, () => W.startDialog(G, a));
      return;
    }
    if (o && o.container) { goThen(G, o, () => W.openContainer(G, o)); return; }
    if (o && o.interact && !G.combat) { goThen(G, o, () => W.startObjectDialog(G, o)); return; }
    if (tile) {
      if (G.combat && G.combat.canFlee && W.isExit(G.loc, tile.x, tile.y)) { W.useExit(G, W.exitRect(G.loc, G.player.x, G.player.y) || W.exitRect(G.loc, tile.x, tile.y)); return; }
      if (G.combat) {
        const path = ENG.findPath(G.loc, p.x, p.y, tile.x, tile.y);
        if (path) COMBAT.playerWalk(G, path);
        return;
      }
      W.walkPlayer(G, tile.x, tile.y);
    }
  };

  function describeActor(G, a) {
    const hp = a.hp / R.maxHP(a);
    const st = hp > 0.8 ? 'Выглядит здоровым.' : hp > 0.4 ? 'Ранен.' : 'Тяжело ранен.';
    const w = a.weapon ? ` В руках: ${ITEMS[a.weapon].name}.` : '';
    return st + w + (a.hostile ? ' Враждебен.' : '');
  }

  W.openContainer = function (G, o) {
    if (o.lock > 0) { G.log(`${o.name}: заперто. Используйте «Взлом» (сложность ${o.lock}).`, 'warn'); return; }
    if (o.owner && !o.ownerOk) {
      const owner = G.loc.actors.find(a => a.tpl === o.owner && !a.dead);
      if (owner && !owner.hostile) {
        const w = W.witnesses(G, o.owner);
        if (w.length) { W.crime(G, owner, 'А ну руки прочь от моего добра!'); return; }
      }
    }
    UI.openLoot(o);
  };

  // ---------- интерактивные объекты: осмотр, обыск, особые действия ----------
  const objKey = (G, o, what) => `obj_${G.loc.id}_${o.uid}_${what}`;
  function rollLoot(G, def) {
    const p = G.player, got = [];
    const scav = R.has(p, 'scav');
    const bonus = R.skill(p, 'survival') / 4 + p.stats.luck + (scav ? 25 : 0);
    for (const [id, a, b, ch] of def.loot || []) {
      if (R.rnd(1, 100) > Math.min(100, ch + bonus)) continue;
      const n = R.rnd(a, b) + (scav ? 1 : 0);
      R.addItem(p, id, n);
      got.push(`${DATA.ITEMS[id].name}${n > 1 ? ' ×' + n : ''}`);
    }
    if (def.caps && def.caps[1] > 0) {
      const c = R.rnd(def.caps[0], def.caps[1]);
      if (c > 0) { p.caps += c; got.push(`${c} крышек`); }
    }
    return got;
  }

  W.lookObject = function (G, o) {
    const it = o.interact;
    const k = objKey(G, o, 'look');
    G.log(`${it.name}: ${it.look}`, 'sys');
    if (!G.flags[k]) { G.flags[k] = true; if (it.lookXp) G.giveXP(it.lookXp); }
    return it.look;
  };

  W.searchObject = function (G, o) {
    const it = o.interact, s = it.search;
    const k = objKey(G, o, 'search');
    // квестовый предмет выдаётся, даже если объект обыскали раньше, чем взяли задание
    const qi = s.questItem;
    const qiPending = qi && G.q(qi.quest) === 1 && !G.hasItem(qi.item) && !G.flags['qiGot_' + qi.quest];
    if (G.flags[k] && qiPending) {
      G.flags['qiGot_' + qi.quest] = true;
      R.addItem(G.player, qi.item, 1); G.passTime(10); SND.play('pickup'); UI.refresh();
      G.log(`Найдено: ${DATA.ITEMS[qi.item].name}.`, 'good');
      return `Теперь, зная, что искать, вы находите: ${DATA.ITEMS[qi.item].name}.`;
    }
    if (G.flags[k]) return 'Здесь вы уже всё перерыли.';
    G.flags[k] = true;
    G.passTime(10);
    SND.play('search');
    const got = rollLoot(G, s);
    if (qiPending) {
      G.flags['qiGot_' + qi.quest] = true;
      R.addItem(G.player, s.questItem.item, 1);
      got.unshift(DATA.ITEMS[s.questItem.item].name);
    }
    G.giveXP(5);
    UI.refresh();
    if (!got.length) { G.log(`Обыск: ${it.name} — ничего полезного.`, 'sys'); return 'Вы тщательно всё перерыли, но ничего полезного не нашлось.'; }
    G.log(`Найдено: ${got.join(', ')}.`, 'good');
    setTimeout(() => SND.play('pickup'), 450);
    return 'Вы находите: ' + got.join(', ') + '.';
  };

  W.checkObject = function (G, o) {
    const it = o.interact, c = it.check;
    const k = objKey(G, o, 'check');
    if (G.flags[k]) return 'Больше здесь ничего не сделать.';
    const v = c.stat ? G.player.stats[c.stat] : R.skill(G.player, c.skill);
    const nm = c.stat ? DATA.SPECIAL.find(s => s.id === c.stat).name : DATA.SKILLS.find(s => s.id === c.skill).name;
    if (v < c.diff) { G.log(`Проверка: ${nm} ${v} против ${c.diff} — провал.`, 'warn'); return `Не выходит. Нужно больше: ${nm} ${c.diff}.`; }
    G.flags[k] = true;
    G.passTime(10);
    G.log(`Проверка: ${nm} ${v} против ${c.diff} — успех.`, 'good');
    const got = rollLoot(G, c);
    if (got.length) G.log(`Найдено: ${got.join(', ')}.`, 'good');
    if (c.xp) G.giveXP(c.xp);
    if (c.effect === 'zaryaLog') G.zaryaFound();
    UI.refresh();
    return c.text + (got.length ? ' Найдено: ' + got.join(', ') + '.' : '');
  };

  W.tryEnter = function (G, o) {
    const e = o.interact.enter, p = G.player, k = objKey(G, o, 'open');
    const go = msg => {
      if (msg) G.log(msg, 'good');
      G.flags[k] = true;
      W.endDialog(G);
      leaveCurrent(G);
      W.goLocation(G, e.to, { at: e.at });
      return null;
    };
    if (G.combat) return 'Сейчас не до того — идёт бой.';
    if (e.flag && !G.flags[e.flag]) return e.text;
    if (G.flags[k] || e.open || e.flag) return go();
    if (e.code && G.flags[e.code]) { SND.play('lock_open'); return go(e.codeMsg || 'Вы набираете код 4-1-7. Замок щёлкает.'); }
    if (e.key && G.hasItem(e.key)) { SND.play('lock_open'); return go(`Вы открываете дверь: ${DATA.ITEMS[e.key].name}.`); }
    if (e.lock) {
      const v = R.skill(p, 'lockpick') + (R.count(p, 'lockpicks') ? 20 : 0);
      if (v >= e.lock) { SND.play('lock_open'); G.giveXP(25); return go(`Взлом ${v} против ${e.lock}: дверь поддалась.`); }
    }
    if (e.stat && p.stats[e.stat[0]] >= e.stat[1]) { SND.play('hit'); G.giveXP(25); return go('Вы отгибаете лист железа и протискиваетесь внутрь.'); }
    SND.play('lock_fail');
    return e.text;
  };

  W.startObjectDialog = function (G, o) {
    const it = o.interact;
    TUT.mark('object');
    G.player.path = [];
    const build = text => {
      const opts = [{ t: 'Осмотреть' + (G.flags[objKey(G, o, 'look')] ? '' : it.lookXp ? ` <span class="chk">(+${it.lookXp} опыта)</span>` : ''), act: () => node(W.lookObject(G, o)) }];
      const qiOpen = it.search && it.search.questItem && G.q(it.search.questItem.quest) === 1 && !G.hasItem(it.search.questItem.item) && !G.flags['qiGot_' + it.search.questItem.quest];
      if (it.search) opts.push({ t: G.flags[objKey(G, o, 'search')] && !qiOpen ? '<span class="muted">Обыскать (уже обыскано)</span>' : 'Обыскать', act: () => node(W.searchObject(G, o)) });
      if (it.enter) opts.unshift({ t: `<b>${it.enter.label}</b>`, act: () => { const r = W.tryEnter(G, o); if (r) node(r); } });
      if (it.check) {
        const c = it.check;
        const nm = c.stat ? DATA.SPECIAL.find(s => s.id === c.stat).name : DATA.SKILLS.find(s => s.id === c.skill).name;
        opts.push({ t: G.flags[objKey(G, o, 'check')] ? `<span class="muted">${c.label} (сделано)</span>` : `<span class="chk">[${nm} ${c.diff}]</span> ${c.label}`, act: () => node(W.checkObject(G, o)) });
      }
      for (const ac of it.actions || []) if (!ac.if || ac.if(G, o)) opts.push({ t: ac.label, act: () => { const r = ac.act(G, o); if (r != null && G.dialog) node(r); } });
      opts.push({ t: 'Отойти', end: true });
      return { text, opts };
    };
    const node = text => { G.dialog.dlg.nodes.main = build(text); W.dialogGo(G, 'main'); };
    G.mode = 'dialog';
    G.dialog = { npc: o, dlg: { nodes: { main: build(o.desc || it.look.split('.')[0] + '.') } }, seen: {} };
    W.dialogGo(G, 'main');
  };

  W.lockpick = function (G, o) {
    const p = G.player;
    if (!o.lock) { G.log('Тут не заперто.', 'sys'); W.openContainer(G, o); return; }
    if (o.jammed && G.time < o.jammed) { G.log(`Замок заклинило. Механизм остынет через ${o.jammed - G.time} мин. (Отдых или прогулка помогут.)`, 'bad'); return; }
    o.jammed = 0;
    if (G.combat && !G.combat.spend(3)) { G.log('Нужно 3 ОД.', 'warn'); return; }
    const picks = R.count(p, 'lockpicks') > 0;
    SND.play('lock_try');
    const chance = R.skill(p, 'lockpick') + (picks ? 20 : 0) - o.lock;
    const res = R.check(chance, p.stats.luck);
    G.passTime(5);
    // взлом чужого — тоже преступление
    if (o.owner) {
      const owner = G.loc.actors.find(a => a.tpl === o.owner && !a.dead && !a.hostile);
      if (owner && W.witnesses(G, o.owner).length) { W.crime(G, owner, 'Ты что творишь с моим замком?!'); return; }
    }
    if (res.ok) {
      const diff = o.lock;
      o.lock = 0;
      G.log(`Взлом: успех (${res.chance}%). Замок открыт.`, 'good');
      SND.play('lock_open');
      ENG.floater(p.x, p.y, 'Открыто!', '#9dff8a');
      G.giveXP(10 + Math.floor(diff / 3));
      NET.syncObj(o);
      W.openContainer(G, o);
    } else {
      G.log(`Взлом: неудача (${res.chance}%).`, 'warn');
      SND.play('lock_fail');
      if (res.crit) { o.jammed = G.time + 60; G.log('Критическая неудача! Замок заклинило на час.', 'bad'); }
      if (picks && Math.random() < 0.3) { R.removeItem(p, 'lockpicks', 1); G.log('Отмычка сломалась.', 'bad'); }
      if (res.crit) NET.syncObj(o);
    }
    UI.refresh();
  };

  // ---------- кража ----------
  W.stealChance = function (G, npc, itemId, n = 1) {
    const p = G.player;
    const it = itemId === 'caps' ? { weight: 0, value: n } : ITEMS[itemId];
    const behind = npc.dir === ENG.dirFromDelta(npc.x - p.x, npc.y - p.y);
    return R.clamp(Math.round(R.skill(p, 'steal') + 25 + (G.sneaking ? 20 : 0) + (behind ? 15 : 0)
      - it.weight * n * 3 - (it.value * n) / 25 - npc.stats.per * 3 - npc.stealTries * 8), 3, 95);
  };
  W.steal = function (G, npc, itemId) {
    const p = G.player;
    const stack = itemId === 'caps' ? null : npc.inv.find(s => s.id === itemId);
    const n = itemId === 'caps' ? npc.caps : itemId.startsWith('ammo') || itemId === 'shells' ? stack.n : 1;
    const chance = W.stealChance(G, npc, itemId, itemId === 'caps' ? n : n);
    const res = R.check(chance, p.stats.luck);
    npc.stealTries = (npc.stealTries || 0) + 1;
    if (res.ok) {
      if (itemId === 'caps') { p.caps += npc.caps; G.log(`Украдено: ${npc.caps} крышек.`, 'good'); npc.caps = 0; }
      else { R.removeItem(npc, itemId, n); R.addItem(p, itemId, n); G.log(`Украдено: ${ITEMS[itemId].name}${n > 1 ? ' ×' + n : ''} (${res.chance}%).`, 'good'); }
      G.giveXP(10);
      NET.syncEnt(npc);
      return true;
    }
    G.log(`Кража не удалась (${res.chance}%). ${npc.name} заметил!`, 'bad');
    UI.closeModal();
    if (npc.hostile) { npc.alerted = true; NET.syncEnt(npc); COMBAT.start(G, npc, false); }
    else W.crime(G, npc, 'Ах ты крыса! Вор!');
    return false;
  };

  // ---------- диалоги ----------
  W.startDialog = function (G, npc) {
    const dlg = DIALOGS[npc.dialog];
    if (!dlg) {
      const lines = npc.hostile ? ['Сдохни!'] : ['Чего надо?', 'Иди своей дорогой.', 'Не мешай.'];
      npc.bubble = { text: lines[R.rnd(0, lines.length - 1)], t: 2.5, color: '#d9cfb5' };
      return;
    }
    G.player.path = [];
    G.mode = 'dialog';
    G.dialog = { npc, dlg, node: null, seen: {} };
    TUT.mark('dialog');
    faceTo(npc, G.player);
    W.dialogGo(G, dlg.start(G));
  };

  W.dialogGo = function (G, nodeId) {
    const D = G.dialog;
    const node = D.dlg.nodes[nodeId];
    D.node = node; D.nodeId = nodeId;
    if (node.onEnter) node.onEnter(G);
    const opts = node.opts.filter(o => (!o.if || o.if(G)) && !(o.once && G.flags['once_' + o.once]));
    D.opts = opts;
    let text = typeof node.text === 'function' ? node.text(G) : node.text;
    if (!D.greeted) { D.greeted = true; text = G.repGreeting(D.npc) + text; }
    UI.showDialog(D.npc, text, opts.map(o => {
      let t = typeof o.t === 'function' ? o.t(G) : o.t;
      if (o.check) {
        const sk = o.check.stat ? DATA.SPECIAL.find(s => s.id === o.check.stat) : DATA.SKILLS.find(s => s.id === o.check.skill);
        t = `<span class="chk">[${sk.name} ${o.check.diff}]</span> ` + t;
      }
      return t;
    }));
  };

  W.dialogChoose = function (G, i) {
    const D = G.dialog;
    if (!D) return;
    const o = D.opts[i];
    if (!o) return;
    if (o.once) G.flags['once_' + o.once] = true;
    if (o.act) {
      const before = G.dialog && G.dialog.node;
      if (typeof o.act === 'function') o.act(G);
      else if (ACTIONS[o.act]) ACTIONS[o.act](G, D.npc);
      if (!o.end && !o.go && !o.check && G.dialog && G.dialog.node !== before) return;
    }
    if (o.check) {
      const v = o.check.stat ? G.player.stats[o.check.stat] : R.skill(G.player, o.check.skill);
      const ok = v >= o.check.diff;
      const sk = o.check.stat ? DATA.SPECIAL.find(s => s.id === o.check.stat) : DATA.SKILLS.find(s => s.id === o.check.skill);
      G.log(`Проверка: ${sk.name} ${v} против ${o.check.diff} — ${ok ? 'успех' : 'провал'}.`, ok ? 'good' : 'warn');
      if (ok) G.giveXP(20);
      if (G.dialog) W.dialogGo(G, ok ? o.ok : o.fail);
      return;
    }
    if (o.end || !o.go) { W.endDialog(G); return; }
    if (G.dialog) W.dialogGo(G, o.go);
  };

  W.endDialog = function (G) {
    G.dialog = null;
    TUT.mark('dialogClosed');
    if (G.mode === 'dialog') G.mode = 'play';
    UI.hideDialog();
  };

  const ACTIONS = {
    trade(G, npc) {
      if (npc.faction === 'town' && G.rep() <= -50) { G.log(`${npc.name}: «С тобой я дел не веду. Проваливай.»`, 'bad'); return; }
      setTimeout(() => UI.openTrade(npc), 0);
    },
    craft(G, npc) { setTimeout(() => UI.openCraft(npc), 0); },
    gunsmith(G, npc) { setTimeout(() => UI.openGunsmith(npc), 0); },
    takeQuest(G) {
      if (G.quests.meds === 0) {
        G.quests.meds = 1;
        G.world.sites.post.known = true;
        G.log('Новое задание: «Лекарства для Ручья». Блокпост 17 отмечен на карте.', 'good');
      }
    },
    finishQuest(G) {
      R.removeItem(G.player, 'meds', 1);
      const reward = G.flags.medsReward || 150;
      G.player.caps += reward;
      G.quests.meds = 3;
      G.log(`Задание выполнено! +${reward} крышек.`, 'good');
      G.giveXP(250);
      G.addRep(25, 'медикаменты для Ручья');
    },
    healPaid(G) {
      const p = G.player;
      const price = G.rep() >= 50 ? 0 : 30;
      if (p.caps < price) { G.log('Не хватает крышек.', 'bad'); return; }
      p.caps -= price; p.hp = R.maxHP(p);
      if (!price) G.log('Ирина: «Для тебя — бесплатно.»', 'good');
      G.log('Ирина обработала раны. Здоровье восстановлено.', 'good');
    },
    fight(G, npc) {
      W.endDialog(G);
      if (!npc.hostile) { npc.hostile = true; NET.syncEnt(npc); }
      for (const a of G.loc.actors) if (a.faction === npc.faction && !a.dead) { a.alerted = true; if (npc.guard || a.guard) { a.hostile = true; NET.syncEnt(a); } }
      COMBAT.start(G, npc, true);
    },
    klykBuy(G, npc) {
      G.player.caps -= 100;
      npc.caps += 100;
      giveMeds(G);
      G.quests.meds = Math.max(G.quests.meds, 2);
      G.flags.klykDeal = true;
      raidersCalm(G, false);
    },
    klykGive(G) {
      giveMeds(G);
      G.flags.klykDeal = true;
      raidersCalm(G, true);
    },
    grace(G) { G.grace = 10; if (NET.active && !NET.isAuth) NET.req({ act: 'grace' }); },
  };
  W.ACTIONS = ACTIONS;

  function giveMeds(G) {
    const locker = G.loc.objects.find(o => o.inv.some(s => s.id === 'meds'));
    if (locker) { R.removeItem(locker, 'meds', 1); NET.syncObj(locker); }
    R.addItem(G.player, 'meds', 1);
    G.log('Получено: Ящик медикаментов.', 'good');
  }
  function raidersCalm(G, leave) {
    for (const a of G.loc.actors) {
      if (a.faction !== 'raiders' || a.dead) continue;
      a.hostile = false; a.alerted = false;
      if (leave) { a.leaving = true; a.wander = 0; }
      NET.syncEnt(a);
    }
    if (leave) G.log('Рейдеры собирают пожитки и уходят с блокпоста.', 'good');
  }

  return W;
})();
