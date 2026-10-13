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
    else if (def && st === 9) {
      G.log(`Задание выполнено: «${def.title}».`, 'good'); SND.play('quest');
      if (id === 'zarya') setTimeout(() => {
        G.log('В отчёте учёного была строчка: «вторая партия З-2 отгружена на станцию «Рассвет» за рекой». Нити тянутся на восток.', 'warn');
        G.setQuest('thread', 1); WMAP.siteState(G, 'bridge').known = true; WMAP.siteState(G, 'rassvet').known = true;
      }, 600);
      if (['semyon', 'boris', 'irina', 'gvozd', 'tihon', 'mihalych'].includes(def.giver) && id !== 'zarya') G.addRep(10, 'помощь жителям');
    }
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
  // ---------- напарник ----------
  G.canRecruit = () => !G.companion && !NET.active;
  G.recruit = function (tpl, opts) {
    const src = G.loc.actors.find(a => a.tpl === tpl && !a.dead);
    if (!src) return;
    src.gone = true;
    const c = R.makeNpc(tpl, src.x, src.y, {});
    Object.assign(c, { id: 'comp_' + tpl, isCompanion: true, faction: 'player', hostile: false, alerted: true, dialog: 'companion', originId: src.id,
      inv: src.inv.map(s => ({ ...s })), caps: 0, weapon: opts.weapon || null, loaded: opts.loaded || 0, waiting: false, wander: 0,
      rx: src.x, ry: src.y, path: [], moving: false, walkPhase: 0, aimT: 0, hitFlash: 0 });
    Object.assign(c.skillOverride, opts.skills || {});
    c.name = c.name.replace(/^(Раненый|Бродяга|Комендант|Инженер) /, '');
    c.homeLoc = G.loc.id;
    c.baseHP += 10; c.hp = c.baseHP;
    G.companion = c;
    G.loc.actors.push(c);
    G.log(`${c.name} присоединяется к вам. Клик по напарнику — команды и обмен вещами.`, 'good');
    SND.play('quest');
  };
  G.companionEquip = function (verbose) {
    const c = G.companion;
    if (!c) return;
    const score = id => { const w = DATA.ITEMS[id]; return (w.dmg[0] + w.dmg[1]) / 2 / w.ap * (w.melee ? 0.8 : 1); };
    let best = c.weapon;
    for (const s of c.inv) { const it = DATA.ITEMS[s.id]; if (it.type === 'weapon' && !it.hidden && (!best || score(s.id) > score(best))) best = s.id; }
    if (best !== c.weapon) {
      if (c.weapon) R.addItem(c, c.weapon, 1);
      R.removeItem(c, best, 1); c.weapon = best; c.loaded = 0;
      const w = DATA.ITEMS[best];
      if (w.mag) { const n = Math.min(w.mag, R.count(c, w.ammo)); R.removeItem(c, w.ammo, n); c.loaded = n; }
    }
    let arm = c.armor;
    for (const s of c.inv) { const it = DATA.ITEMS[s.id]; if (it.type === 'armor' && (!arm || it.ac > DATA.ITEMS[arm].ac)) arm = s.id; }
    if (arm !== c.armor) { if (c.armor) R.addItem(c, c.armor, 1); R.removeItem(c, arm, 1); c.armor = arm; }
    if (verbose) G.log(`${c.name}: оружие — ${c.weapon ? DATA.ITEMS[c.weapon].name : 'кулаки'}, броня — ${c.armor ? DATA.ITEMS[c.armor].name : 'нет'}.`, 'sys');
  };
  // развитие напарника
  G.companionXP = function (n) {
    const c = G.companion;
    if (!c || n <= 0) return;
    c.level = c.level || 1; c.xp = (c.xp || 0) + n; c.freePts = c.freePts || 0;
    while (c.xp >= R.xpForLevel(c.level)) {
      c.level++; c.freePts += 3; c.baseHP += 5; c.hp = R.maxHP(c);
      G.log(`${c.name} получает уровень ${c.level}! Очки навыков напарника: ${c.freePts} (разговор → «Развитие напарника»).`, 'good');
    }
  };
  G.companionSkillUp = function (k) {
    const c = G.companion;
    if (!c || !c.freePts) return;
    c.skillOverride[k] = R.skill(c, k) + 4; c.freePts--;
  };
  G.healCompanion = function (useKit) {
    const c = G.companion, p = G.player;
    if (!c) return;
    if (useKit) {
      R.removeItem(p, 'medkit', 1);
      const h = R.healAmount(p, 'medkit');
      c.hp = Math.min(R.maxHP(c), c.hp + h); G.log(`${c.name}: +${h} ОЗ (аптечка).`, 'good'); SND.play('heal');
      return;
    }
    if (G.time - (c.lastAid || -999) < 60) { G.log(`Перевязывать ${c.name} можно раз в час.`, 'warn'); return; }
    c.lastAid = G.time;
    const res = R.check(R.skill(p, 'medic') + 15, p.stats.luck);
    if (!res.ok) { G.log(`Перевязка не удалась (${res.chance}%).`, 'warn'); return; }
    const h = 4 + Math.floor(R.skill(p, 'medic') / 5);
    c.hp = Math.min(R.maxHP(c), c.hp + h); G.passTime(15);
    G.log(`Вы перевязали ${c.name}: +${h} ОЗ (${res.chance}%).`, 'good'); SND.play('heal'); G.giveXP(5);
  };
  G.dismissCompanion = function () {
    const c = G.companion;
    if (!c) return;
    G.companion = null;
    if (G.loc) { const i = G.loc.actors.indexOf(c); if (i >= 0) G.loc.actors.splice(i, 1); }
    // вернуть жителя в лагерь
    const restore = list => { const o = list && list.find(a => a.id === c.originId); if (o) { o.gone = false; o.hp = Math.max(1, c.hp); o.inv = c.inv; o.weapon = c.weapon; o.armor = c.armor; } };
    const home = c.homeLoc || 'camp';
    if (G.loc && G.loc.id === home) restore(G.loc.actors); else if (G.locStates[home]) restore(G.locStates[home].actors);
    G.log(`${c.name} возвращается домой: ${DATA.LOCATIONS[home].name}.`, 'sys');
  };

  // ---------- репутация Ручья ----------
  const REP_LEVELS = [
    { min: 50, name: 'Герой Ручья', mult: 0.8, cls: 'good' },
    { min: 15, name: 'Свой', mult: 0.9, cls: 'good' },
    { min: -15, name: 'Чужак', mult: 1, cls: 'sys' },
    { min: -50, name: 'Под подозрением', mult: 1.15, cls: 'warn' },
    { min: -999, name: 'Враг Ручья', mult: 1.3, cls: 'bad' },
  ];
  G.rep = () => (G.flags && G.flags.rep) || 0;
  G.repLevel = (v = G.rep()) => REP_LEVELS.find(l => v >= l.min);
  G.addRep = function (n, why) {
    const before = G.repLevel();
    G.flags.rep = Math.max(-100, Math.min(100, G.rep() + n));
    const after = G.repLevel();
    G.log(`Репутация в Ручье ${n > 0 ? '+' : ''}${n}${why ? ' (' + why + ')' : ''}: ${after.name}.`, n > 0 ? 'good' : 'bad');
    if (after !== before) { G.hint('Репутация: ' + after.name); SND.play(n > 0 ? 'quest' : 'alert'); }
    UI.refresh();
  };
  // приветствие жителей в зависимости от репутации
  G.repGreeting = function (npc) {
    if (!npc || npc.faction !== 'town') return '';
    const v = G.rep();
    if (v >= 50) return '(смотрит с уважением) Рад видеть, герой. ';
    if (v >= 15) return '(кивает как своему) ';
    if (v <= -50) return '(хватается за оружие) Ты?! После всего, что ты натворил... ';
    if (v <= -15) return '(смотрит с подозрением) ';
    return '';
  };
  // ---------- глава 3 ----------
  G.klykN = () => (G.flags.klykDead ? 'Шрам' : 'Клык');
  G.klykSurrenders = function () {
    G.flags.klykSurrender = true;
    const k = G.findNpc('klyk_city'); if (k) { k.gone = true; NET.syncEnt(k); }
    G.loc.actors.filter(a => a.tpl === 'klyk_man').forEach(a => { a.gone = true; NET.syncEnt(a); });
    if (G.q('column') < 4) G.setQuest('column', 4);
    G.giveXP(60);
  };
  G.klykFlee = function () {
    G.flags.klykFled = true;
    const k = G.findNpc('klyk_city');
    if (k) { R.removeItem(k, 'column_orders', 1); k.gone = true; NET.syncEnt(k); }
    G.loc.actors.filter(a => a.tpl === 'klyk_man').forEach(a => { a.gone = true; NET.syncEnt(a); });
    R.addItem(G.player, 'column_orders', 1); R.addItem(G.player, 'ak', 1);
    G.log('Получено: Приказ Колонны, Автомат АК.', 'good');
    if (G.q('column') < 4) G.setQuest('column', 4);
    G.giveXP(60);
  };
  G.columnEnd = function (how) {
    const rewards = { alive: [400, 300, [['col_armor', 1]]], dead: [300, 200, []], joined: [400, 150, [['col_armor', 1]]], exposed: [500, 0, []], lied: [100, 0, []] };
    const [xp, caps, items] = rewards[how] || [100, 0, []];
    G.flags.columnEnd = how;
    G.setQuest('column', 9);
    G.reward(xp, caps, items);
    if (how === 'exposed') G.addRep(20, 'Колонна изгнана');
    G.log('Конец главы 3. Колонна уходит на север, к старой обсерватории... Продолжение следует.', 'warn');
    if (G.loc && G.loc.id === 'city') for (const a of G.loc.actors) if (a.faction === 'column' && !a.dead) { a.leaving = true; a.hostile = false; NET.syncEnt(a); }
  };
  // ---------- глава 4 ----------
  G.granitYields = function () {
    G.flags.granitYield = true;
    for (const a of G.loc.actors) if (a.faction === 'column' && !a.dead) { a.hostile = false; a.leaving = true; NET.syncEnt(a); }
    G.giveXP(150);
  };
  G.obsFinish = function (how) {
    G.flags.obsDone = how;
    if (how === 'dark') {
      G.setQuest('obs', 9); G.reward(300, 500, []); G.addRep(-60, 'облако «З-2» над пустошью');
      G.log('КОНЕЦ КАМПАНИИ (тёмный). Колонна правит пустошью, а на юге поднимаются обращённые...', 'bad');
      return;
    }
    G.giveXP(how === 'boom' ? 250 : 300);
    if (G.q('obs') < 4) G.setQuest('obs', 4);
  };
  G.openBridge = function () {
    if (G.flags.bridgeOpen) return;
    G.flags.bridgeOpen = true;
    if (G.loc && G.loc.id === 'bridge') WORLD_API.refreshGates(G);
    G.log('Ржавый мост открыт — путь на восток свободен.', 'good');
    G.giveXP(30);
  };
  G.onRadio = function () { WMAP.siteState(G, 'bridge').known = true; WMAP.siteState(G, 'rassvet').known = true; };
  G.siteQuestMark = function (id) {
    const q = G.q, f = G.flags;
    if (G.flags.invasion && !G.flags.invasion.done && G.flags.invasion.loc === id) return '!';
    if (id === 'observatory') return q('obs') >= 1 && q('obs') < 4 ? '!' : q('obs') === 9 ? '✔' : null;
    if (id === 'city') return q('column') >= 1 && q('column') < 9 ? '!' : q('column') === 9 ? '✔' : null;
    if (id === 'bridge') return !f.bridgeOpen && q('thread') >= 1 ? '!' : f.bridgeOpen ? '✔' : null;
    if (id === 'rassvet') { if (q('thread') === 4 || q('mast') === 2) return '?'; if (q('thread') === 1 || q('mast') === 0) return '!'; return q('thread') === 9 ? '✔' : null; }
    if (id === 'object9') { if (q('thread') === 2 || q('thread') === 3) return '!'; return f.z2Done ? '✔' : null; }
    return null;
  };
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
      case 'mihalych': return (G.hasItem('meds') && G.quests.meds < 3) || (q('rats') === 1 && R.count(p, 'rat_tail') >= 5) ? '?' : G.quests.meds === 0 || q('rats') === 0 ? '!' : null;
      case 'semyon': return (G.hasItem('samples') && q('zarya') < 9) || (q('pelts') === 1 && R.count(p, 'wolf_pelt') >= 3) ? '?' : q('pelts') === 0 && q('debt') !== 0 ? '!' : q('debt') === 0 ? '!' : q('debt') === 1 && p.caps >= 15 && G.flags.tihonDebtPaid ? '?' : null;
      case 'granit': return q('column') >= 1 && q('column') < 3 ? '!' : q('column') === 4 ? '?' : null;
      case 'klyk_city': return q('column') === 3 ? '!' : null;
      case 'vera': return q('thread') === 1 ? '!' : q('thread') === 4 && (G.flags.z2Destroyed || G.hasItem('z2_crate')) ? '?' : null;
      case 'lada': return G.flags.ladaFree ? null : '!';
      case 'kuzma': return q('obs') === 4 ? '?' : q('column') === 9 && q('obs') === 0 ? '!' : q('mast') === 2 ? '?' : q('mast') === 0 || (q('thread') === 9 && q('column') === 0) ? '!' : null;
      case 'palych': return q('thread') >= 2 && q('thread') < 9 && !G.hasItem('explosive') && !G.flags.z2Done && !G.flags.palychExplosive ? '!' : null;
      case 'mitya': return G.hasItem('samples') && !G.flags.mityaCured ? '?' : null;
      case 'mytar': return !G.flags.bridgeOpen && q('thread') >= 1 ? '!' : null;
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
    if (hours > 0) G.tickInvasions();
  };

  // ---------- улучшения квартиры ----------
  G.buildUpgrade = function (flag, need, caps) {
    const p = G.player;
    for (const [id, n] of need) if (R.count(p, id) < n) return `Не хватает: ${DATA.ITEMS[id].name} ×${n}.`;
    if (p.caps < caps) return `Не хватает крышек: нужно ${caps}.`;
    need.forEach(([id, n]) => R.removeItem(p, id, n)); p.caps -= caps;
    G.flags[flag] = true; WORLD_API.refreshGates(G); G.giveXP(30); SND.play('reload');
    WORLD_API.endDialog(G);
    G.log('Готово! Новое улучшение в квартире.', 'good');
    return null;
  };
  G.radioNews = function () {
    const f = G.flags, q = G.q, news = [];
    const inv = f.invasion;
    if (inv && !inv.done) news.push(`⚠ СРОЧНО: ${inv.kind === 'column' ? 'отряд Колонны' : 'толпа обращённых'} идёт на «${DATA.LOCATIONS[inv.loc].name}»! Защитники просят помощи. Осталось часов: ${Math.max(0, Math.ceil((inv.until - G.time) / 60))}.`);
    if (q('obs') === 9) news.push(f.obsDone === 'dark' ? '«...жёлтое облако видели над южными пустошами. Кто вдохнул — уже не человек...»' : '«Говорит «Рассвет»: небо чистое. Колонна рассеяна, караваны снова ходят.»');
    else if (q('column') === 9) news.push('«...Колонну видели на дороге к северу, у старой обсерватории...»');
    if (f.bridgeOpen) news.push('«Ржавый мост открыт, мытари больше не дерут втридорога.»');
    if (G.rep() >= 50) news.push('«В Ржавом Ручье говорят о путнике, который спас поселение. Будто бы живёт в Старом городе.»');
    news.push(['«Караванщик Яков ищет охрану на юг.»', '«Цены на воду растут: сухой сезон.»', '«В Мёртвом лесу снова воют волки.»', '«Сёма скупает волчьи шкуры и крысиные хвосты.»', '«Доска контрактов у остановки пополнилась.»'][Math.floor(G.time / 360) % 5]);
    if (!f.radioTip) { f.radioTip = true; R.addItem(G.player, 'ammo762', 10); news.push('(Между новостями — координаты тайника. Вы находите 10 патронов 7.62 в вентиляции.)'); }
    SND.play('dialog');
    return news.join(String.fromCharCode(10, 10));
  };

  // ---------- после финала: вторжения на поселения ----------
  const INV_TARGETS = ['camp', 'rassvet'];
  G.postGame = () => G.q('obs') === 9;
  G.tickInvasions = function () {
    if (!G.postGame() || NET.active) return;
    const f = G.flags;
    if (f.invasion && !f.invasion.done) {
      if (G.time > f.invasion.until) {
        const name = DATA.LOCATIONS[f.invasion.loc].name;
        f.invasion.done = 'lost';
        G.log(`Вторжение на «${name}» не отбито. Поселение разграблено.`, 'bad');
        if (f.invasion.loc === 'camp') G.addRep(-10, 'Ручей остался без защиты');
      }
      return;
    }
    if (f.nextInvasion == null) f.nextInvasion = G.time + 12 * 60;
    if (G.time < f.nextInvasion) return;
    const kind = f.obsDone === 'dark' || Math.random() < 0.5 ? 'infected' : 'column';
    const loc = INV_TARGETS[Math.floor(Math.random() * INV_TARGETS.length)];
    f.invasion = { loc, kind, until: G.time + 24 * 60, done: false, n: (f.invasionCount || 0) + 1 };
    f.invasionCount = f.invasion.n;
    f.nextInvasion = G.time + (36 + Math.floor(Math.random() * 24)) * 60;
    G.log(`⚠ ВТОРЖЕНИЕ! ${kind === 'column' ? 'Отряд Колонны' : 'Толпа обращённых'} идёт на «${DATA.LOCATIONS[loc].name}». У вас 24 часа, чтобы отбить атаку.`, 'bad');
    WMAP.siteState(G, loc).known = true;
    G.world.target = loc;
    SND.play('alert');
  };
  G.invasionCleared = function () {
    const inv = G.flags.invasion;
    if (!inv || inv.done) return;
    inv.done = 'won';
    const k = inv.n || 1;
    G.log(`Вторжение отбито! «${DATA.LOCATIONS[inv.loc].name}» спасено.`, 'good');
    G.reward(150 + 50 * k, 100 + 30 * k, [['medkit', 1]]);
    if (inv.loc === 'camp') G.addRep(10, 'защита Ручья');
    SND.play('quest');
  };
  // освещённость: 0 — день, 0.62 — глубокая ночь (сумерки 19–21, рассвет 5–7)
  G.darkness = function () {
    const h = (G.time / 60) % 24, N = 0.62;
    if (h >= 21 || h < 5) return N;
    if (h >= 19) return N * (h - 19) / 2;
    if (h < 7) return N * (7 - h) / 2;
    return 0;
  };
  G.nightK = () => (G.loc && G.loc.def.interior ? 0 : G.darkness() / 0.62);
  G.clockText = function () {
    const d = Math.floor(G.time / 1440) + 1, h = Math.floor(G.time / 60) % 24, m = Math.floor(G.time % 60);
    const part = h >= 22 || h < 5 ? 'ночь' : h < 11 ? 'утро' : h < 18 ? 'день' : 'вечер';
    return `День ${d} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${part}`;
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

  G.giveXP = function (n, noShare) {
    const p = G.player;
    if (!noShare && window.SOC) SOC.shareXP(n);
    if (G.companion && !G.companion.dead) G.companionXP(Math.round(n * 0.6));
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
    try { localStorage.setItem(mpKey(), JSON.stringify(data)); } catch (e) { /* */ }
    if (NET.active) NET.send({ t: 'savechar', data });
    if (!silent) G.log(NET.active ? 'Персонаж сохранён на сервере.' : 'Персонаж сохранён.', 'good');
  };

  G.startMultiplayer = async function (host, port, password, name, charPass) {
    // ключ персонажа: пароль персонажа (вход с любого компьютера) или секрет этого компьютера
    const lk = `mp_key_${host}:${port}_${name.toLowerCase()}`;
    let key = charPass ? 'p:' + charPass : null;
    if (!key) { try { key = localStorage.getItem(lk); } catch (e) { /* */ } }
    if (!key) { key = 'k:' + Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem(lk, key); } catch (e) { /* */ } }
    await NET.connect(host, port, password, name, key);
    let data = NET.char;
    if (!data) { try { data = JSON.parse(localStorage.getItem(mpKey()) || 'null'); } catch (e) { data = null; } }
    const begin = () => {
      G.player.id = NET.myId();
      G.player.name = NET.name;
      G.player.dead = false;
      if (G.player.hp <= 0) G.player.hp = Math.ceil(R.maxHP(G.player) / 2);
      document.getElementById('log-box').innerHTML = '';
      G.log(`Вы на сервере «${NET.serverName}» (${NET.server}) как «${NET.name}». Игроков онлайн: ${NET.players.length}. Enter — чат, «/о текст» — чат отряда.`, 'good');
      if (NET.motd) G.log(NET.motd, 'warn');
      if (NET.serverTime != null) G.time = NET.serverTime;
      if (NET.char) G.log('Персонаж загружен с сервера.', 'sys');
      setTimeout(() => G.saveMP(true), 1500);
      try {
        const rec = JSON.parse(localStorage.getItem('mp_recent') || '[]').filter(s => s.host + ':' + s.port !== NET.server);
        rec.unshift({ host: NET.server.split(':')[0], port: +NET.server.split(':')[1], name: NET.serverName });
        localStorage.setItem('mp_recent', JSON.stringify(rec.slice(0, 6)));
      } catch (e) { /* */ }
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
    const comp = G.companion ? { ...G.companion, path: [], onArrive: null, stepCb: null } : null;
    const data = { contract: window.SOC ? SOC.contract : null, player: p, companion: comp, locStates: G.locStates, quests: G.quests, flags: G.flags, time: G.time, world: G.world,
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
    if (window.SOC) { SOC.contract = data.contract || null; setTimeout(() => SOC.renderContract(), 0); }
    Object.assign(G, { player: data.player, companion: data.companion || null, locStates: data.locStates, quests: data.quests, flags: data.flags, time: data.time, world: data.world, combat: null, dialog: null, mode: 'play' });
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
      G.locStates = {}; G.quests = { meds: 0 }; G.flags = {}; G.time = 8 * 60; G.companion = null;
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
      if (e.key === 'Enter') { const t = chat.value.trim(); if (/^\/[оo]\s/i.test(t)) SOC.partyChat(t.slice(3)); else if (t) NET.chat(t); chat.value = ''; chat.classList.add('hidden'); chat.blur(); }
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
        if (e.key === 'Escape') { WORLD_API.endDialog(G); return; }
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 9) WORLD_API.dialogChoose(G, n - 1);
        return;
      }
      if (e.key === 'Escape') {
        if (UI.modalOpen()) {
          const cur = UI.current();
          if (cur === 'settings' && G.player && G.scene !== 'menu') UI.openPause();
          else if (!['create', 'title', 'dead', 'enc', 'mp', 'update', 'settings', 'wevent', 'confirm', 'prompt'].includes(cur)) UI.closeModal();
        } else if (G.ui.mode !== 'move') UI.setMode('move');
        else if (G.scene !== 'menu') UI.openPause();
        return;
      }
      if (['1', '2', '3'].includes(e.key) && !UI.modalOpen() && G.scene === 'local') { G.useQuick(+e.key - 1); return; }
      if ((k === 'n' || k === 'т') && !UI.modalOpen()) { MINI.toggle(); return; }
      if ((k === 'z' || k === 'я') && !UI.modalOpen()) { UI.cycleAim(); return; }
      const map = { q: 'move', й: 'move', a: 'attack', ф: 'attack', s: 'sneak', ы: 'sneak', k: 'steal', л: 'steal', l: 'lockpick', д: 'lockpick', x: 'look', ч: 'look', h: 'heal', р: 'heal', r: 'reload', к: 'reload', j: 'journal', о: 'journal', i: 'inventory', ш: 'inventory', c: 'character', с: 'character', m: 'map', ь: 'map' };
      if (k === ' ') { e.preventDefault(); if (G.combat) COMBAT.endPlayerTurn(G); return; }
      if (map[k]) {
        if (UI.modalOpen() && !['inventory', 'character', 'journal'].includes(map[k])) return;
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
