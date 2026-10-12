// Состояние игры, главный цикл, ввод, сохранение
(function () {
  const { ITEMS } = DATA;
  const SAVE_KEY = 'wasteland_demo_save_v1';

  const G = window.G = {
    scene: 'menu', mode: 'play', player: null, loc: null, locStates: {}, quests: { meds: 0 }, flags: {},
    time: 8 * 60, world: null, combat: null, sneaking: false, dialog: null, risk: 0, grace: 0,
    ui: { mode: 'move', hover: null, previewPath: null, apCost: 0 },
  };

  // ---------- API для диалогов и систем ----------
  G.log = (t, c) => UI.log(t, c);
  G.hint = t => UI.hint(t);
  G.maxHP = a => R.maxHP(a);
  G.hasItem = id => R.count(G.player, id) > 0;
  G.addItem = (a, id, n) => R.addItem(a, id, n);
  G.takeFrom = (a, id, n) => { const ok = R.removeItem(a, id, n); NET.touch(a); return ok; };
  G.findNpc = tpl => G.loc && G.loc.actors.find(a => a.tpl === tpl && !a.dead);
  G.anyNpc = tpl => G.loc && G.loc.actors.find(a => a.tpl === tpl);
  G.q = id => G.quests[id] || 0;
  G.setQuest = function (id, st) {
    const prev = G.q(id);
    G.quests[id] = st;
    const def = DATA.QUESTS[id];
    if (def && prev === 0 && st > 0 && st < 9) G.log(`Новое задание: «${def.title}».`, 'good');
    else if (def && st === 9) { G.log(`Задание выполнено: «${def.title}».`, 'good'); SND.play('quest'); }
    else if (def && def.steps[st]) G.log(`Задание обновлено: «${def.title}».`, 'good');
    UI.refresh();
  };
  G.reward = function (xp, caps, items) {
    const p = G.player;
    if (caps) { p.caps += caps; G.log(`+${caps} крышек.`, 'good'); }
    for (const [id, n] of items || []) { R.addItem(p, id, n); G.log(`Получено: ${DATA.ITEMS[id].name}${n > 1 ? ' ×' + n : ''}.`, 'good'); }
    if (xp) G.giveXP(xp);
  };
  G.zaryaFound = function () {
    if (G.flags.zaryaCode) return;
    G.flags.zaryaCode = true;
    if (!G.hasItem('director_log')) R.addItem(G.player, 'director_log', 1);
    if (G.q('zarya') < 2) G.setQuest('zarya', 2); else G.log('Вы узнали код подвала цеха №3: 4-1-7.', 'good');
  };
  G.qZarya = () => G.q('zarya') >= 1 && G.q('zarya') <= 3;
  // сюжетные шаги по предметам в инвентаре
  setInterval(() => {
    if (!G.player || !G.quests) return;
    if (G.hasItem('director_log') && !G.flags.zaryaCode) G.zaryaFound();
    if (G.hasItem('samples') && G.q('zarya') >= 1 && G.q('zarya') < 4) G.setQuest('zarya', 4);
  }, 700);
  G.revealSite = id => { WMAP.siteState(G, id).known = true; G.log('Новая локация отмечена на карте мира.', 'good'); };
  G.marauderDead = () => { const m = G.anyNpc('marauder'); return !!(m && m.dead) || !!G.flags.marauderKilled; };
  G.angerMarauder = function () {
    const m = G.findNpc('marauder');
    if (m) { m.hostile = true; m.alerted = false; NET.syncEnt(m); }
  };
  G.ensureToolbox = function () {
    if (G.hasItem('toolbox')) return;
    const box = G.loc && G.loc.objects.find(o => o.sprite === 'crate_long' && o.container);
    if (box && !box.inv.some(s => s.id === 'toolbox')) { R.addItem(box, 'toolbox', 1); NET.syncObj(box); }
  };
  // значок над NPC: «!» — есть задание, «?» — можно сдать
  G.questMark = function (a) {
    if (a.dead || a.hostile || a.isRemote) return null;
    const q = G.q, p = G.player;
    switch (a.tpl) {
      case 'mihalych': return G.quests.meds === 0 ? '!' : G.hasItem('meds') && G.quests.meds < 3 ? '?' : null;
      case 'semyon': return G.hasItem('samples') && q('zarya') < 9 ? '?' : q('debt') === 0 ? '!' : q('debt') === 1 && p.caps >= 15 && G.flags.tihonDebtPaid ? '?' : null;
      case 'boris': return q('tools') === 0 ? '!' : G.hasItem('toolbox') || G.hasItem('battery') ? '?' : q('tools') === 9 && q('battery') === 0 ? '!' : null;
      case 'irina': return q('wounded') === 2 || (G.hasItem('samples') && q('zarya') < 9) ? '?' : q('wounded') === 0 ? '!' : q('zarya') === 0 && (q('wounded') === 9 || p.level >= 3) ? '!' : null;
      case 'lyoha': return q('wounded') === 1 ? '!' : null;
      case 'gvozd': return q('marauder') < 9 && G.marauderDead() ? '?' : q('marauder') === 0 ? '!' : null;
      case 'tihon': return q('ration') < 9 && G.hasItem('food') ? '?' : q('ration') === 0 ? '!' : q('debt') === 1 && !G.flags.tihonDebtPaid ? '!' : null;
    }
    return null;
  };

  G.passTime = function (min) {
    const before = Math.floor(G.time / 60);
    G.time += min;
    const hours = Math.floor(G.time / 60) - before;
    if (hours > 0 && G.scene === 'local' && !G.combat) {
      const p = G.player;
      p.hp = Math.min(R.maxHP(p), p.hp + hours * R.healRate(p));
    }
  };
  G.clockText = function () {
    const d = Math.floor(G.time / 1440) + 1, h = Math.floor(G.time / 60) % 24, m = Math.floor(G.time % 60);
    return `День ${d} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // быстрые слоты 1–3
  G.quickSlots = function () {
    if (!G.player) return [];
    if (!G.player.quick) G.player.quick = ['medkit', 'bandage', 'water'];
    return G.player.quick;
  };
  G.useQuick = function (i) {
    const id = G.quickSlots()[i];
    if (!id) { G.hint('Слот пуст — назначьте аптечку или бинт в инвентаре'); return; }
    if (!R.count(G.player, id)) { G.hint(`Нет: ${DATA.ITEMS[id].name}`); return; }
    if (G.combat && !G.combat.isPlayerTurn()) return;
    TUT.mark('quick');
    G.useItem(id);
  };

  G.giveXP = function (n) {
    const p = G.player;
    p.xp += n;
    G.log(`+${n} опыта.`, 'good');
    while (p.xp >= R.xpForLevel(p.level)) {
      p.level++;
      const pts = R.skillPerLevel(p);
      p.freePts += pts;
      p.hp = R.maxHP(p);
      G.log(`НОВЫЙ УРОВЕНЬ ${p.level}! +${pts} очков навыков (окно «Персонаж»).`, 'good');
      SND.play('levelup');
      if (p.level % 2 === 0) { p.perkPts = (p.perkPts || 0) + 1; G.log('Доступен новый перк! Откройте окно «Персонаж» (C).', 'good'); }
      if (G.loc) ENG.floater(p.x, p.y, 'Новый уровень!', '#f0b43c');
    }
    UI.refresh();
  };

  G.equip = function (id) {
    const p = G.player, it = ITEMS[id];
    if (G.combat && !G.combat.spend(2)) { G.log('Нужно 2 ОД, чтобы сменить снаряжение.', 'warn'); return; }
    if (it.type === 'weapon') {
      G.unequip('weapon', true);
      R.removeItem(p, id, 1); p.weapon = id; p.loaded = 0;
      if (it.mag) { const n = Math.min(it.mag, R.count(p, it.ammo)); R.removeItem(p, it.ammo, n); p.loaded = n; }
      G.log(`В руках: ${it.name}.`, 'sys');
    } else if (it.type === 'armor') {
      G.unequip('armor', true);
      R.removeItem(p, id, 1); p.armor = id;
      G.log(`Надето: ${it.name}.`, 'sys');
    }
    UI.refresh();
  };
  G.unequip = function (slot, silent) {
    const p = G.player;
    if (!p[slot]) return;
    if (slot === 'weapon') {
      const w = ITEMS[p.weapon];
      if (w.ammo && p.loaded > 0) R.addItem(p, w.ammo, p.loaded);
      p.loaded = 0;
    }
    R.addItem(p, p[slot], 1);
    if (!silent) G.log(`Снято: ${ITEMS[p[slot]].name}.`, 'sys');
    p[slot] = null;
  };

  G.useItem = function (id) {
    const p = G.player, it = ITEMS[id];
    if (it.type !== 'aid') return;
    const uc = R.has(p, 'quick') ? 1 : 2;
    if (G.combat && !G.combat.spend(uc)) { G.log(`Нужно ${uc} ОД.`, 'warn'); return; }
    const h = R.healAmount(p, id);
    R.removeItem(p, id, 1);
    p.hp = Math.min(R.maxHP(p), p.hp + h);
    G.log(`${it.name}: +${h} ОЗ.`, 'good');
    SND.play('heal');
    if (G.loc) ENG.floater(p.x, p.y, '+' + h, '#9dff8a');
    UI.refresh();
    if (G.combat) COMBAT.autoEnd(G);
  };

  // Навык «Медицина»: первая помощь без расходников
  G.firstAid = function () {
    const p = G.player;
    if (p.hp >= R.maxHP(p)) { G.hint('Вы здоровы'); return; }
    if (G.combat) {
      if (!G.combat.spend(4)) { G.log('Первая помощь в бою: 4 ОД.', 'warn'); return; }
    } else if (G.time - p.lastFirstAid < (R.has(p, 'fieldmedic') ? 30 : 120)) {
      const cd = R.has(p, 'fieldmedic') ? 30 : 120;
      G.log(`Первую помощь можно оказывать раз в ${cd >= 60 ? cd / 60 + ' ч' : cd + ' мин'} (через ${cd - (G.time - p.lastFirstAid)} мин).`, 'warn'); return;
    }
    const res = R.check(R.skill(p, 'medic') + 20, p.stats.luck);
    p.lastFirstAid = G.time;
    if (!G.combat) G.passTime(15);
    if (res.ok) {
      const h = R.rnd(2, 6) + Math.floor(R.skill(p, 'medic') / 6);
      p.hp = Math.min(R.maxHP(p), p.hp + h);
      G.log(`Первая помощь (${res.chance}%): +${h} ОЗ.`, 'good');
      SND.play('heal');
      if (G.loc) ENG.floater(p.x, p.y, '+' + h, '#9dff8a');
      if (!G.combat) G.giveXP(5);
    } else G.log(`Первая помощь не удалась (${res.chance}%).`, 'warn');
    UI.refresh();
    if (G.combat) COMBAT.autoEnd(G);
  };

  G.gameOver = function () {
    G.player.dead = true;
    SND.play('death'); SND.setCombat(false);
    G.log('Вы погибли.', 'bad');
    if (NET.active) { setTimeout(() => UI.openRespawn(), 1200); return; }
    setTimeout(() => UI.openDead(() => G.load(), () => location.reload()), 1200);
  };

  // ---------- сетевая игра ----------
  const mpKey = () => `mp_${NET.server}_${NET.name}`;
  G.saveMP = function (silent) {
    if (!NET.server || !G.player || G.scene === 'menu') return;
    const p = { ...G.player };
    delete p.path; delete p.onArrive; delete p.stepCb;
    const data = { player: p, quests: G.quests, flags: G.flags, time: G.time, world: G.world };
    try { localStorage.setItem(mpKey(), JSON.stringify(data)); if (!silent) G.log('Персонаж сохранён.', 'good'); } catch (e) { /* */ }
  };

  G.startMultiplayer = async function (host, port, password, name) {
    await NET.connect(host, port, password, name);
    let data = null;
    try { data = JSON.parse(localStorage.getItem(mpKey()) || 'null'); } catch (e) { data = null; }
    const begin = () => {
      G.player.id = NET.myId();
      G.player.name = NET.name;
      G.player.dead = false;
      if (G.player.hp <= 0) G.player.hp = Math.ceil(R.maxHP(G.player) / 2);
      document.getElementById('log-box').innerHTML = '';
      G.log(`Вы на сервере ${NET.server} как «${NET.name}». Игроков онлайн: ${NET.players.length}. Enter — чат.`, 'good');
      if (NET.serverVersion !== window.GAME_VERSION) G.log(`Внимание: версия сервера ${NET.serverVersion}, у вас ${window.GAME_VERSION}.`, 'warn');
      G.world.c = DATA.WORLD.start.x; G.world.r = DATA.WORLD.start.y;
      WORLD_API.goLocation(G, 'camp');
    };
    UI.closeModal();
    if (data && data.player) {
      Object.assign(G, { player: data.player, quests: data.quests, flags: data.flags, time: data.time, world: data.world, locStates: {}, combat: null, dialog: null, mode: 'play' });
      if (G.flags.tutStep == null && G.player.xp > 0) G.flags.tutStep = 99;
      begin();
    } else {
      UI.openCharacter(true, p => {
        G.player = p;
        G.locStates = {}; G.quests = { meds: 0 }; G.flags = {}; G.time = 8 * 60;
        G.world = WMAP.initState();
        begin();
      });
      const nm = document.querySelector('#c-name');
      if (nm) { nm.value = NET.name; nm.disabled = true; }
    }
  };

  G.respawn = function () {
    const p = G.player;
    p.dead = false;
    p.hp = Math.ceil(R.maxHP(p) / 2);
    G.combat = null;
    if (G.loc) NET.leave(G.loc.id, NET.isAuth && !G.loc.def.temp ? WORLD_API.serializeLocation(G) : null);
    G.loc = null;
    G.world.c = DATA.WORLD.start.x; G.world.r = DATA.WORLD.start.y; G.world.path = [];
    G.log('Вы приходите в себя у старой заправки.', 'sys');
    WORLD_API.goLocation(G, 'camp');
  };

  G.onDisconnect = function () {
    G.saveMP(true);
    G.combat = null;
    UI.openDisconnected();
  };

  // ---------- сохранение ----------
  G.autosave = function () {
    if (NET.active) { G.saveMP(true); return; }
    if (!G.combat) G.save(true);
  };
  G.save = function (auto) {
    if (NET.active) { G.saveMP(false); return; }
    if (G.combat) { if (!auto) G.log('Нельзя сохраняться в бою.', 'warn'); return; }
    if (G.scene === 'local') WORLD_API.saveLocationState(G);
    const p = { ...G.player };
    delete p.path; delete p.onArrive; delete p.stepCb;
    const data = { player: p, locStates: G.locStates, quests: G.quests, flags: G.flags, time: G.time, world: G.world,
      scene: G.scene, locId: G.loc && !G.loc.def.temp ? G.loc.id : null };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); G.log(auto ? 'Автосохранение.' : 'Игра сохранена.', auto ? 'sys' : 'good'); }
    catch (e) { G.log('Не удалось сохранить: ' + e.message, 'bad'); }
  };
  G.hasSave = function () { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } };
  G.load = function () {
    if (NET.active) { G.hint('В сетевой игре загрузка недоступна'); return; }
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { data = null; }
    if (!data) { G.hint('Сохранений нет'); return; }
    UI.closeModal();
    Object.assign(G, { player: data.player, locStates: data.locStates, quests: data.quests, flags: data.flags, time: data.time, world: data.world, combat: null, dialog: null, mode: 'play' });
    G.player.dead = false;
    if (G.flags.tutStep == null && G.player.xp > 0) G.flags.tutStep = 99;
    UI.hideDialog();
    WMAP.leave();
    if (data.locId) {
      const p = G.player;
      WORLD_API.loadLocation(G, data.locId, { at: { x: p.x, y: p.y } });
    } else WMAP.enter(G);
    G.log('Игра загружена.', 'good');
  };

  function newGame() {
    UI.openCharacter(true, p => {
      G.player = p;
      G.locStates = {}; G.quests = { meds: 0 }; G.flags = {}; G.time = 8 * 60;
      G.world = WMAP.initState();
      document.getElementById('log-box').innerHTML = '';
      G.log(`${p.name}, вы выходите из пустоши к поселению у старой заправки.`, 'sys');
      G.log('Подсказка: поговорите со старостой Михалычем (клик по NPC).', 'sys');
      WORLD_API.goLocation(G, 'camp');
    });
  }

  // ---------- ввод ----------
  function bindInput() {
    const cv = ENG.canvas;
    cv.addEventListener('mousemove', e => {
      ENG.mouse.sx = e.clientX; ENG.mouse.sy = e.clientY; ENG.mouse.inside = true;
      updateHover();
    });
    cv.addEventListener('mouseleave', () => { ENG.mouse.inside = false; ENG.mouse.tile = null; });
    cv.addEventListener('mousedown', e => {
      if (e.button !== 0 || UI.modalOpen()) return;
      ENG.mouse.sx = e.clientX; ENG.mouse.sy = e.clientY; ENG.mouse.inside = true;
      if (G.scene === 'world') { WMAP.click(G, e.clientX, e.clientY); return; }
      if (G.scene !== 'local' || G.mode === 'dialog' || G.player.dead) return;
      updateHover();
      WORLD_API.click(G, ENG.mouse.tile, G.ui.hover || {});
      UI.refresh();
    });
    cv.addEventListener('contextmenu', e => { e.preventDefault(); UI.setMode(G.ui.mode === 'move' ? 'attack' : 'move'); });
    cv.addEventListener('wheel', e => {
      ENG.zoom = Math.max(0.55, Math.min(1.8, ENG.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    }, { passive: true });

    const chat = document.getElementById('chat-input');
    chat.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = chat.value.trim(); if (t) NET.chat(t); chat.value = ''; chat.classList.add('hidden'); chat.blur(); }
      if (e.key === 'Escape') { chat.classList.add('hidden'); chat.blur(); }
    });
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'Enter' && NET.active && G.scene !== 'menu' && G.mode !== 'dialog' && !UI.modalOpen()) { e.preventDefault(); UI.openChat(); return; }
      const k = e.key.toLowerCase();
      if (e.key === 'F5') { e.preventDefault(); if (G.player) G.save(); return; }
      if (e.key === 'F9') { e.preventDefault(); G.load(); return; }
      if (e.key === 'F2') { e.preventDefault(); G.debug = !G.debug; return; }
      if (!G.player || G.scene === 'menu') return;
      if (G.mode === 'dialog' && G.dialog) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 9) WORLD_API.dialogChoose(G, n - 1);
        return;
      }
      if (e.key === 'Escape') { if (UI.modalOpen()) { if (!['create', 'title', 'dead', 'enc', 'mp', 'update', 'settings'].includes(UI.current())) UI.closeModal(); } else UI.setMode('move'); return; }
      if (['1', '2', '3'].includes(e.key) && !UI.modalOpen() && G.scene === 'local') { G.useQuick(+e.key - 1); return; }
      if ((k === 'n' || k === 'т') && !UI.modalOpen()) { MINI.toggle(); return; }
      if ((k === 'z' || k === 'я') && !UI.modalOpen()) { UI.cycleAim(); return; }
      const map = { q: 'move', й: 'move', a: 'attack', ф: 'attack', s: 'sneak', ы: 'sneak', k: 'steal', л: 'steal', l: 'lockpick', д: 'lockpick', x: 'look', ч: 'look', h: 'heal', р: 'heal', r: 'reload', к: 'reload', i: 'inventory', ш: 'inventory', c: 'character', с: 'character', m: 'map', ь: 'map' };
      if (k === ' ') { e.preventDefault(); if (G.combat) COMBAT.endPlayerTurn(G); return; }
      if (map[k]) {
        if (UI.modalOpen() && !['inventory', 'character'].includes(map[k])) return;
        UI.action(map[k]);
      }
    });
  }

  function updateHover() {
    if (G.scene !== 'local' || !G.loc) { G.ui.hover = null; return; }
    const w = ENG.screenToWorld(ENG.mouse.sx, ENG.mouse.sy);
    const t = ENG.fromIso(w.x, w.y - 16);
    const tile = { x: Math.floor(t.x + 0.5), y: Math.floor(t.y + 0.5) };
    const changed = !ENG.mouse.tile || tile.x !== ENG.mouse.tile.x || tile.y !== ENG.mouse.tile.y;
    ENG.mouse.tile = tile;
    const prev = G.ui.hover;
    G.ui.hover = WORLD_API.pick(G, w.x, w.y);
    // предпросмотр пути и стоимости в бою
    const p = G.player;
    let cost = 0;
    if (G.combat && G.combat.isPlayerTurn() && !G.combat.busy) {
      const a = G.ui.hover.actor;
      if (a && !a.dead && a.hostile) { cost = R.weaponOf(p).ap + COMBAT.aimCost(G.ui.aim || 'torso'); G.ui.previewPath = null; }
      else if (changed) {
        const path = ENG.findPath(G.loc, p.x, p.y, tile.x, tile.y, { maxLen: 30 });
        G.ui.previewPath = path;
      }
      if (!a && G.ui.previewPath) cost = Math.min(G.ui.previewPath.length, p.ap);
    } else G.ui.previewPath = null;
    const hoverChanged = !prev || prev.actor !== G.ui.hover.actor || prev.obj !== G.ui.hover.obj;
    if (cost !== G.ui.apCost || hoverChanged) { G.ui.apCost = cost; UI.refresh(); }
    // курсор
    const h = G.ui.hover;
    if (G.ui.mode === 'move') ENG.canvas.style.cursor = h.actor ? (h.actor.hostile && !h.actor.dead ? 'crosshair' : 'pointer') : h.obj && h.obj.container ? 'pointer' : 'default';
  }

  // ---------- цикл ----------
  let last = performance.now(), clockAcc = 0;
  let lastFrameAt = 0;
  function frame(now) {
    lastFrameAt = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    requestAnimationFrame(frame);
    try { step(dt, t); } catch (e) { console.error(e); }
  }
  function step(dt, t) {
    if (G.scene === 'local' && G.loc) {
      WORLD_API.update(G, dt);
      ENG.updateFx(dt);
      ENG.render(G, t);
      if (!G.combat && G.mode !== 'dialog') {
        clockAcc += dt;
        if (clockAcc >= 2) { clockAcc = 0; G.passTime(1); document.getElementById('clock').textContent = G.clockText(); }
      }
    } else if (G.scene === 'world') {
      WMAP.update(G, dt);
      WMAP.render(G, t);
    } else {
      ENG.ctx.setTransform(1, 0, 0, 1, 0, 0);
      ENG.ctx.fillStyle = '#000';
      ENG.ctx.fillRect(0, 0, ENG.canvas.width, ENG.canvas.height);
    }
  }
  // свёрнутое окно: продолжаем симуляцию (важно для ведущего в сетевой игре)
  setInterval(() => {
    if (performance.now() - lastFrameAt < 250) return;
    last = performance.now();
    try {
      if (G.scene === 'local' && G.loc) { WORLD_API.update(G, 0.1); ENG.updateFx(0.1); }
      else if (G.scene === 'world') WMAP.update(G, 0.1);
    } catch (e) { console.error(e); }
  }, 100);

  // ---------- старт ----------
  async function boot() {
    ENG.init(document.getElementById('view'));
    UI.init(G);
    MINI.init();
    G.log('Загрузка ассетов...', 'sys');
    await ENG.load();
    document.getElementById('log-box').innerHTML = '';
    bindInput();
    G.player = R.newPlayer('Странник', { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 5, luck: 5 }, []);
    G.player.hp = R.maxHP(G.player);
    UI.refresh();
    UI.openTitle(G.hasSave(), newGame, () => G.load());
    requestAnimationFrame(frame);
  }
  boot();
})();
