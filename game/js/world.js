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
        block: o.block !== false, name: o.name || (o.container ? 'Ящик' : null), desc: o.desc || null,
        container: !!o.container, lock: o.lock || 0, owner: o.owner || null, caps: o.caps || 0,
        inv: (o.items || []).map(([id, n]) => ({ id, n })), jammed: false,
      };
    });
  }

  function buildGrids(L) {
    L.blocked = new Uint8Array(L.w * L.h);
    L.sight = new Uint8Array(L.w * L.h);
    for (const o of L.objects) {
      if (!o.block) continue;
      for (let y = o.y; y < o.y + o.fh; y++) for (let x = o.x; x < o.x + o.fw; x++) {
        if (x < 0 || y < 0 || x >= L.w || y >= L.h) continue;
        L.blocked[y * L.w + x] = 1;
        if (o.fw * o.fh >= 6) L.sight[y * L.w + x] = 1;
      }
    }
  }

  W.isExit = (L, x, y) => L && (x <= 0 || y <= 0 || x >= L.w - 1 || y >= L.h - 1);

  // случайная встреча: локация генерируется на лету
  function wildDef(seed, kind) {
    const r = ENG.seeded(seed);
    const props = ['tree_dead', 'tree_dead2', 'rocks', 'rocks2', 'rocks_big', 'bush_dry', 'stump', 'log', 'log2', 'wrecked_cars', 'bus', 'tires', 'barrels', 'pole', 'tree_small', 'stump_big', 'hedgehog', 'jersey_red'];
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
      const tpl = kind === 'raiders' ? (r() < 0.5 ? 'raider' : 'raider_melee') : (r() < 0.4 ? 'wild_gun' : 'wild');
      npcs.push([tpl, 12 + Math.floor(r() * 10), 6 + Math.floor(r() * 8), { wander: 3 }]);
    }
    return { name: 'Пустошь', w: 34, h: 34, ground: ['dirt_tracks', 'overgrown_grassland', 'rubble_ground', 'cracked_road'], groundW: [3, 3, 1, 1], base: '#5b4c35', entry: { x: 17, y: 30 }, objects, npcs, temp: true, desc: 'Безымянный клочок пустоши.' };
  }

  W.loadLocation = function (G, id, opts = {}) {
    let def = LOCATIONS[id];
    if (!def && id.startsWith('wild')) def = wildDef(id, opts.kind || 'wild');
    const saved = G.locStates[id];
    const L = { id, def, w: def.w, h: def.h, seed: opts.seed || '' };
    L.objects = buildObjects(def);
    if (saved) {
      for (const so of saved.objects) Object.assign(L.objects[so.uid], so);
      L.actors = saved.actors;
    } else {
      L.actors = def.npcs.map(([tpl, x, y, o], i) => { const a = R.makeNpc(tpl, x, y, o || {}); a.id = `${id}_${i}`; return a; });
    }
    const p = G.player;
    const e = opts.at || def.entry;
    p.x = e.x; p.y = e.y;
    L.actors = L.actors.filter(a => !a.isPlayer && !a.isRemote);
    L.actors.unshift(p);
    for (const a of L.actors) { a.rx = a.x; a.ry = a.y; a.path = []; a.moving = false; a.walkPhase = 0; a.aimT = 0; a.hitFlash = 0; a.bubble = null; a.alerted = false; }
    buildGrids(L);
    ENG.buildGround(L);
    G.loc = L;
    G.scene = 'local';
    G.sneaking = false;
    G.detectT = 0;
    G.grace = 0;
    const c = ENG.tileCenter(p.x, p.y);
    ENG.cam.x = c.x; ENG.cam.y = c.y - 40;
    G.log(`— ${def.name} —`, 'sys');
    if (def.desc) G.log(def.desc, 'sys');
    UI.refresh();
  };

  W.serializeLocation = function (G) {
    const L = G.loc;
    return {
      objects: L.objects.filter(o => o.container).map(o => ({ uid: o.uid, inv: o.inv, lock: o.lock, caps: o.caps, jammed: o.jammed })),
      actors: L.actors.filter(a => !a.isPlayer && !a.isRemote && !a.gone).map(a => {
        const c = { ...a };
        delete c.path; delete c.onArrive; delete c.stepCb; delete c.bubble;
        return c;
      }),
    };
  };
  W.saveLocationState = function (G) {
    const L = G.loc;
    if (!L || L.def.temp) return;
    G.locStates[L.id] = W.serializeLocation(G);
  };

  // переход в локацию (в сетевой игре — с получением состояния от сервера)
  W.goLocation = async function (G, id, opts = {}) {
    if (!NET.active) { W.loadLocation(G, id, opts); return; }
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
  };

  W.leaveToWorld = function (G) {
    if (G.combat) { G.log('Нельзя уйти во время боя!', 'bad'); return; }
    if (NET.active) {
      const st = NET.isAuth && !G.loc.def.temp ? W.serializeLocation(G) : null;
      NET.leave(G.loc.id, st);
    } else W.saveLocationState(G);
    G.loc = null;
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
    return true;
  };

  function speedOf(G, a) {
    if (G.combat) return 5;
    if (a.isPlayer) return G.sneaking ? 2.4 : 4.4;
    if (a.isRemote) return a.sneaking ? 2.6 : 4.8;
    return a.hurry ? 4 : 2.2;
  }

  W.update = function (G, dt) {
    const L = G.loc;
    for (const a of L.actors) {
      if (a.dead || a.gone) continue;
      if (a.aimT > 0) a.aimT -= dt;
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
          if (a.isPlayer) onPlayerStep(G);
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
        a.x = n.x; a.y = n.y; a.moving = true;
        if (!a.path.length) a.stepCb = () => finishPath(a);
      }
    }
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
      W.leaveToWorld(G);
    }
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
  W.detectRadius = a => a.stats.per * 2 + 2 + (a.sentry ? 4 : 0);
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
      const inside = a.dead ? Math.abs(wx - sx) < 40 && wy > sy - 30 && wy < sy + 6 : Math.abs(wx - sx) < 20 && wy > sy - 84 && wy < sy + 4;
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
      if (a) G.log(a.dead ? `Труп: ${a.name}.` : `${a.name}. ${describeActor(G, a)}`);
      else if (o) G.log(`${o.name || 'Объект'}${o.desc ? '. ' + o.desc : ''}${o.container && o.lock ? ' Заперто.' : ''}`);
      else G.log('Ничего интересного.', 'sys');
      UI.setMode('move');
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
      else G.log(`Игрок ${a.name}, уровень ${a.level || 1}. Чат — клавиша Enter.`, 'sys');
      return;
    }
    if (a) {
      if (a.dead) { goThen(G, a, () => UI.openLoot(a)); return; }
      if (a.hostile) { COMBAT.playerAttack(G, a); return; }
      if (G.combat) { G.log('Сейчас не время для разговоров.', 'warn'); return; }
      goThen(G, a, () => W.startDialog(G, a));
      return;
    }
    if (o && o.container) { goThen(G, o, () => W.openContainer(G, o)); return; }
    if (tile) {
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

  W.lockpick = function (G, o) {
    const p = G.player;
    if (!o.lock) { G.log('Тут не заперто.', 'sys'); W.openContainer(G, o); return; }
    if (o.jammed && G.time < o.jammed) { G.log(`Замок заклинило. Механизм остынет через ${o.jammed - G.time} мин. (Отдых или прогулка помогут.)`, 'bad'); return; }
    o.jammed = 0;
    if (G.combat && !G.combat.spend(3)) { G.log('Нужно 3 ОД.', 'warn'); return; }
    const picks = R.count(p, 'lockpicks') > 0;
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
      ENG.floater(p.x, p.y, 'Открыто!', '#9dff8a');
      G.giveXP(10 + Math.floor(diff / 3));
      NET.syncObj(o);
      W.openContainer(G, o);
    } else {
      G.log(`Взлом: неудача (${res.chance}%).`, 'warn');
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
    UI.showDialog(D.npc, node.text, opts.map(o => {
      let t = o.t;
      if (o.check) {
        const sk = DATA.SKILLS.find(s => s.id === o.check.skill);
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
      if (typeof o.act === 'function') o.act(G);
      else if (ACTIONS[o.act]) ACTIONS[o.act](G, D.npc);
    }
    if (o.check) {
      const v = R.skill(G.player, o.check.skill);
      const ok = v >= o.check.diff;
      const sk = DATA.SKILLS.find(s => s.id === o.check.skill);
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
    if (G.mode === 'dialog') G.mode = 'play';
    UI.hideDialog();
  };

  const ACTIONS = {
    trade(G, npc) { setTimeout(() => UI.openTrade(npc), 0); },
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
    },
    healPaid(G) {
      const p = G.player;
      if (p.caps < 30) { G.log('Не хватает крышек.', 'bad'); return; }
      p.caps -= 30; p.hp = R.maxHP(p);
      G.log('Ирина обработала раны. Здоровье восстановлено.', 'good');
    },
    fight(G, npc) {
      W.endDialog(G);
      for (const a of G.loc.actors) if (a.faction === npc.faction && !a.dead) a.alerted = true;
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
