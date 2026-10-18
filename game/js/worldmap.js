// Карта мира: гексы, туман войны, путешествие, случайные встречи
window.WMAP = (function () {
  const { WORLD, HEX_TILES } = DATA;
  const HW = 104, RH = 75, HH = 100;
  const M = {};
  const rows = WORLD.rows.length, cols = WORLD.rows[0].length;
  let panel = null;

  const center = (c, r) => ({ x: c * HW + (r & 1) * HW / 2 + HW / 2, y: r * RH + HH / 2 });
  const toCube = (c, r) => { const q = c - (r - (r & 1)) / 2; return { q, r, s: -q - r }; };
  const fromCube = h => ({ c: h.q + (h.r - (h.r & 1)) / 2, r: h.r });
  const hexDist = (a, b) => { const A = toCube(a.c, a.r), B = toCube(b.c, b.r); return Math.max(Math.abs(A.q - B.q), Math.abs(A.r - B.r), Math.abs(A.s - B.s)); };
  function cubeRound(q, r, s) {
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs; else rs = -rq - rr;
    return { q: rq, r: rr, s: rs };
  }
  function line(a, b) {
    const n = hexDist(a, b), A = toCube(a.c, a.r), B = toCube(b.c, b.r), res = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      res.push(fromCube(cubeRound(A.q + (B.q - A.q) * t + 1e-6, A.r + (B.r - A.r) * t + 1e-6, A.s + (B.s - A.s) * t - 2e-6)));
    }
    return res;
  }
  function neighbors(c, r) {
    const d = r & 1 ? [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]] : [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
    return d.map(([dc, dr]) => ({ c: c + dc, r: r + dr })).filter(h => h.c >= 0 && h.r >= 0 && h.c < cols && h.r < rows);
  }
  // поиск пути: река непроходима, закрытый мост — только как цель
  function findHexPath(G, from, to) {
    const bridge = WORLD.sites.find(s => s.id === 'bridge');
    const ok = (h, isDest) => {
      if (terrainAt(h.c, h.r) === 'v') return false;
      if (bridge && h.c === bridge.x && h.r === bridge.y && !G.flags.bridgeOpen && !isDest) return false;
      return true;
    };
    if (!ok(to, true)) return null;
    const k = h => h.c + ',' + h.r;
    const prev = { [k(from)]: null }, queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      if (cur.c === to.c && cur.r === to.r) {
        const path = []; let x = cur;
        while (x && !(x.c === from.c && x.r === from.r)) { path.unshift(x); x = prev[k(x)]; }
        return path;
      }
      for (const n of neighbors(cur.c, cur.r)) {
        if (k(n) in prev) continue;
        const dest = n.c === to.c && n.r === to.r;
        if (!ok(n, dest)) continue;
        prev[k(n)] = cur; queue.push(n);
      }
    }
    return null;
  }
  M.findPath = (from, to) => findHexPath({ flags: { bridgeOpen: true } }, from, to); // караванам мост всегда открыт
  M.hexDist = hexDist;
  function hexAt(x, y) {
    let best = null, bd = 1e9;
    const r0 = Math.round((y - HH / 2) / RH);
    for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = -1; c <= cols; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const p = center(c, r), d = Math.hypot(p.x - x, (p.y - y) * 1.1);
      if (d < bd) { bd = d; best = { c, r }; }
    }
    return bd < 60 ? best : null;
  }
  const key = (c, r) => c + ',' + r;
  const terrainAt = (c, r) => WORLD.rows[r][c];

  const siteState = (G, id) => (G.world.sites[id] = G.world.sites[id] || { known: !!(WORLD.sites.find(s => s.id === id) || {}).known });
  M.siteState = siteState;
  M.initState = function () {
    const st = { c: WORLD.start.x, r: WORLD.start.y, path: [], revealed: {}, sites: {}, mapV: 3 };
    for (const s of WORLD.sites) st.sites[s.id] = { known: s.known };
    const p = center(st.c, st.r); st.px = p.x; st.py = p.y;
    return st;
  };

  function reveal(G) {
    const W = G.world, rad = G.player.stats.per >= 8 ? 2 : 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (hexDist({ c, r }, { c: W.c, r: W.r }) <= rad) W.revealed[key(c, r)] = true;
    }
    for (const s of WORLD.sites) if (W.revealed[key(s.x, s.y)] && hexDist({ c: s.x, r: s.y }, { c: W.c, r: W.r }) <= 1) siteState(G, s.id).known = true;
  }

  // старые сохранения: карта расширилась на запад — сдвигаем координаты
  M.migrate = function (G) {
    const W = G.world;
    if (!W || W.mapV >= 3) return;
    if (W.mapV === 2) {  // карта выросла на север: сдвиг рядов
      const n = WORLD.northShift || 0, rv = {};
      W.r += n;
      for (const k of Object.keys(W.revealed || {})) { const [c, r] = k.split(',').map(Number); rv[c + ',' + (r + n)] = true; }
      W.revealed = rv; W.path = []; W.mapV = 3;
      const p = center(W.c, W.r); W.px = p.x; W.py = p.y;
      return;
    }
    const s = WORLD.westShift || 0;
    W.c += s; if (W.prevC != null) W.prevC += s;
    const rv = {};
    for (const k of Object.keys(W.revealed || {})) { const [c, r] = k.split(',').map(Number); rv[(c + s) + ',' + r] = true; }
    W.revealed = rv; W.path = []; W.mapV = 2;
    M.migrate(G);
  };
  M.enter = function (G) {
    M.migrate(G);
    G.scene = 'world';
    G.combat = null;
    G.sneaking = false;
    const W = G.world;
    W.path = [];
    const p = center(W.c, W.r); W.px = p.x; W.py = p.y;
    reveal(G);
    ENG.cam.x = W.px; ENG.cam.y = W.py;
    UI.setMode('move');
    G.log('Вы выходите на просторы пустоши.', 'sys');
    SND.setScene('world'); SND.setCombat(false);
    TUT.mark('world');
    showPanel(G);
    UI.refresh();
  };
  M.leave = function () { if (panel) panel.remove(); panel = null; };

  function siteHere(G) { return WORLD.sites.find(s => s.x === G.world.c && s.y === G.world.r && siteState(G, s.id).known); }

  function showPanel(G) {
    if (!panel) {
      panel = document.createElement('div');
      panel.style.cssText = 'position:absolute;left:14px;top:34px;display:flex;flex-direction:column;gap:6px;z-index:5';
      document.getElementById('game').appendChild(panel);
      panel.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.go) M.enterSite(G, b.dataset.go);
        if (b.dataset.rest) M.rest(G);
        if (b.dataset.esc) { CV.panelClick(G, b.dataset.esc); showPanel(G); }
      });
    }
    const s = siteHere(G);
    panel.innerHTML = (window.CV ? CV.panelHtml(G) : '') + (s ? `<button class="primary" data-go="${s.id}">▶ Войти: ${s.name}</button>` : '') + (G.flags.escort ? '' : `<button data-rest="1">Отдохнуть 8 ч</button>`);
  }
  M.refreshPanel = function (G) {
    if (G.scene === 'world') showPanel(G);
  }

  M.enterSite = function (G, id) {
    M.leave();
    return WORLD_API.goLocation(G, id);
  };

  M.rest = function (G) {
    const p = G.player;
    if (G.world.path.length) return;
    const bonus = Math.floor(R.skill(p, 'survival') / 25);
    const heal = (R.healRate(p) + bonus) * 8;
    p.hp = Math.min(R.maxHP(p), p.hp + heal);
    G.passTime(8 * 60);
    G.log(`Вы отдыхаете 8 часов. +${heal} ОЗ (Выживание даёт +${bonus}/ч).`, 'good');
    UI.refresh();
  };

  M.click = function (G, sx, sy) {
    if (UI.modalOpen()) return;
    const w = ENG.screenToWorld(sx, sy);
    const h = hexAt(w.x, w.y);
    if (!h) return;
    const W = G.world;
    if (h.c === W.c && h.r === W.r) { const s = siteHere(G); if (s) M.enterSite(G, s.id); return; }
    if (G.flags.escort) { G.hint(G.flags.escort.leader ? 'Вы в охране каравана: «Идти с караваном» или «Бросить караван»' : 'Вы в охране каравана — путь ведёт наниматель'); return; }
    const cvh = window.CV && CV.at(G, h);
    if (cvh && hexDist(h, { c: W.c, r: W.r }) <= 1 && CV.canMeet(G, cvh)) { CV.openMeet(G, cvh); return; }
    const path = findHexPath(G, { c: W.c, r: W.r }, h);
    if (!path) {
      G.hint(terrainAt(h.c, h.r) === 'v' ? 'Это река' : 'Туда не пройти');
      G.log(G.flags.bridgeOpen ? 'Туда не пройти.' : 'Через реку не перейти. Переправа — Ржавый мост (его держат сборщики пошлины).', 'warn');
      return;
    }
    W.path = path;
    W.dest = h;
  };

  M.update = function (G, dt) {
    const W = G.world;
    if (!W.path.length || UI.modalOpen()) { ENG.cam.x += (W.px - ENG.cam.x) * Math.min(1, dt * 3); ENG.cam.y += (W.py - ENG.cam.y) * Math.min(1, dt * 3); return; }
    const n = W.path[0], t = center(n.c, n.r);
    const dx = t.x - W.px, dy = t.y - W.py, d = Math.hypot(dx, dy);
    const speed = 110 * (1 + R.skill(G.player, 'survival') / 200);
    if (d < speed * dt) {
      W.prevC = W.c; W.px = t.x; W.py = t.y; W.c = n.c; W.r = n.r; W.path.shift();
      onHex(G);
    } else { W.px += dx / d * speed * dt; W.py += dy / d * speed * dt; }
    ENG.cam.x += (W.px - ENG.cam.x) * Math.min(1, dt * 3);
    ENG.cam.y += (W.py - ENG.cam.y) * Math.min(1, dt * 3);
  };

  function onHex(G) {
    const W = G.world, p = G.player;
    // Великая пустыня: жажда
    if (terrainAt(W.c, W.r) === 'y' && W.c < (WORLD.westShift || 0) + 1) {
      G.flags.thirst = (G.flags.thirst || 0) + (R.skill(p, 'survival') >= 70 ? 0.5 : 1);
      if (G.flags.thirst >= 2) {
        G.flags.thirst = 0;
        if (R.removeItem(p, 'water', 1)) G.log('Пустыня: вы выпиваете бутылку воды.', 'sys');
        else { p.hp = Math.max(1, p.hp - 7); G.log('Жажда! Без воды вы теряете силы: −7 ОЗ.', 'bad'); G.hint('Жажда! Нужна вода'); }
      }
    }
    const mins = Math.round(180 * (1 - Math.min(0.5, R.skill(p, 'survival') / 300)));
    G.passTime(mins);
    W.hexes = (W.hexes || 0) + 1;
    if (W.hexes % 2 === 0) p.hp = Math.min(R.maxHP(p), p.hp + R.healRate(p));
    reveal(G);
    if (window.CV && CV.onStep(G)) { showPanel(G); UI.refresh(); return; }
    showPanel(G);
    UI.refresh();
    if (window.CV && CV.checkMeet(G)) return;
    const site = WORLD.sites.find(s => s.x === W.c && s.y === W.r);
    if (site) {
      W.path = [];
      G.log(`Вы добрались до локации: ${site.name}.`, 'good');
      return;
    }
    const tr = terrainAt(W.c, W.r);
    const chance = WORLD.encounter[tr] * (1 - Math.min(0.7, R.skill(p, 'survival') / 200));
    if (Math.random() < chance) {
      W.path = [];
      encounter(G, tr);
    } else if (Math.random() < 0.12) {
      W.path = [];
      worldEvent(G);
    }
  }

  // ---------- мирные события в пути ----------
  const rndItems = list => list.filter(() => Math.random() < 0.6);
  const EVENTS = [
    { id: 'caravan', title: 'Караван браминов', text: 'По дороге неспешно бредут двухголовые брамины, навьюченные тюками. Караванщик машет рукой: «Торговать будешь, путник?»',
      opts: [
        { t: 'Поторговать', act: G => { const trader = { name: 'Караванщик Яков', tpl: 'caravan', faction: 'caravan', caps: 400, inv: [['ammo9', 40], ['shells', 12], ['ammo762', 20], ['medkit', 2], ['bandage', 4], ['water', 5], ['food', 4], ['lockpicks', 1], ['leather', 1], ['rifle', 1]].filter((x, i) => i < 4 || Math.random() < 0.5).map(([id, n]) => ({ id, n })) }; setTimeout(() => UI.openTrade(trader), 0); return null; } },
        { t: 'Расспросить о дорогах', check: { skill: 'speech', diff: 35 }, act: G => { G.giveXP(20); G.flags.radioHeard = true; G.onRadio(); return 'Яков рассказывает: на востоке, за рекой, кто-то крутит по радио позывной «Рассвет». Говорят, там укрепление и чистая вода. И ещё — что люди из «Зари» шли туда с какими-то ящиками.'; }, fail: 'Караванщик пожимает плечами: «Дороги как дороги. Смотри под ноги».' },
        { t: 'Пройти мимо', act: () => 'Караван медленно скрывается в пыли.' },
      ] },
    { id: 'wounded', title: 'Раненый путник', text: 'У обочины сидит человек, зажимая рану на боку. «Помогите... рейдеры...»',
      opts: [
        { t: 'Перевязать рану', check: { skill: 'medic', diff: 30 }, act: G => { G.giveXP(40); const r = ['ammo9', 'bandage', 'water'][R.rnd(0, 2)]; R.addItem(G.player, r, r === 'ammo9' ? 10 : 1); return `Вы останавливаете кровь. Путник благодарит и суёт вам «${DATA.ITEMS[r].name}». (+40 опыта)`; }, fail: 'Вы пытаетесь помочь, но рана слишком сложная. Путник лишь машет рукой: «Иди...»' },
        { t: 'Отдать аптечку', if: G => G.hasItem('medkit'), act: G => { R.removeItem(G.player, 'medkit', 1); G.player.caps += 25; G.giveXP(30); return 'Путник жадно хватает аптечку и отдаёт вам последние 25 крышек. (+30 опыта)'; } },
        { t: 'Обшарить его карманы', act: G => { R.addItem(G.player, 'ammo9', 6); G.player.caps += 12; G.flags.karmaLow = (G.flags.karmaLow || 0) + 1; return 'Он слишком слаб, чтобы сопротивляться. 12 крышек и 6 патронов. На душе мерзко.'; } },
        { t: 'Пройти мимо', act: () => 'Вы идёте дальше. Стоны за спиной постепенно стихают.' },
      ] },
    { id: 'stash', title: 'Странная груда камней', text: 'Камни сложены слишком ровно для случайности. Может, тайник?',
      opts: [
        { t: 'Присмотреться', check: { skill: 'survival', diff: 35 }, act: G => { G.giveXP(20); const got = rndItems([['ammo762', 8], ['medkit', 1], ['water', 2], ['lockpicks', 1]]); got.forEach(([id, n]) => R.addItem(G.player, id, n)); const caps = R.rnd(15, 45); G.player.caps += caps; SND.play('pickup'); return `Тайник! Внутри: ${got.map(([id, n]) => DATA.ITEMS[id].name + (n > 1 ? ' ×' + n : '')).join(', ') || 'пусто'}, и ${caps} крышек. (+20 опыта)`; }, fail: 'Вы разбираете камни, но под ними только песок и скорпион.' },
        { t: 'Идти дальше', act: () => 'Камни как камни.' },
      ] },
    { id: 'car', title: 'Брошенная машина', text: 'Посреди дороги стоит легковушка с распахнутыми дверями. Под днищем поблёскивает проволока.',
      opts: [
        { t: 'Аккуратно снять растяжку и обыскать', check: { skill: 'lockpick', diff: 30 }, act: G => { G.giveXP(25); R.addItem(G.player, 'junk', 2); R.addItem(G.player, 'shells', 6); G.player.caps += 20; SND.play('pickup'); return 'Вы обезвреживаете растяжку. В багажнике: хлам, дробь и 20 крышек. (+25 опыта)'; }, fail: 'Проволока дрожит под пальцами — лучше не рисковать.' },
        { t: 'Обыскать как есть', act: G => { if (Math.random() * 10 < G.player.stats.luck) { R.addItem(G.player, 'junk', 2); SND.play('pickup'); return 'Повезло: растяжка проржавела. Вы находите немного хлама.'; } G.player.hp = Math.max(1, G.player.hp - 8); SND.play('shot', { weapon: 'shotgun' }); return 'Хлопок! Растяжка срабатывает. −8 ОЗ.'; } },
        { t: 'Объехать... то есть обойти', act: () => 'Целее будете.' },
      ] },
    { id: 'water', title: 'Водонос', text: 'Сгорбленный старик с канистрами за спиной: «Вода! Чистая вода! Три бутылки — десять крышек!»',
      opts: [
        { t: 'Купить (10 крышек)', if: G => G.player.caps >= 10, act: G => { G.player.caps -= 10; R.addItem(G.player, 'water', 3); SND.play('cash'); return 'Старик отсчитывает три бутылки. Вода и правда чистая.'; } },
        { t: 'Отказаться', act: () => 'Старик бредёт дальше, позвякивая канистрами.' },
      ] },
    { id: 'radio', title: 'Радиосигнал', text: 'В старом приёмнике на обочине сквозь треск пробивается голос: «...говорит станция «Рассвет»... всем выжившим... вода, защита... мост на востоке...»',
      opts: [{ t: 'Запомнить', act: G => { G.flags.radioHeard = true; G.giveXP(15); if (G.onRadio) G.onRadio(); return 'Вы запоминаете позывной. Похоже, где-то на востоке есть поселение. (+15 опыта)'; } }] },
  ];

  function worldEvent(G) {
    const ev = EVENTS[R.rnd(0, EVENTS.length - 1)];
    const show = (text, result) => {
      UI.openModal('wevent', `<div class="modal" style="width:min(520px,94vw)"><h2>${ev.title}</h2>
        <div class="screen" style="margin-bottom:10px;line-height:1.45">${result || text}</div>
        <div class="cols" style="flex-direction:column;gap:6px" id="we-opts"></div></div>`, root => {
        const box = root.querySelector('#we-opts');
        const opts = result ? [{ t: 'Продолжить путь', done: true }] : ev.opts.filter(o => !o.if || o.if(G));
        box.innerHTML = opts.map((o, i) => {
          let lbl = o.t;
          if (o.check) { const s = DATA.SKILLS.find(x => x.id === o.check.skill); lbl = `<span class="warn">[${s.name} ${o.check.diff}]</span> ` + lbl; }
          return `<button data-i="${i}" style="text-align:left">${lbl}</button>`;
        }).join('');
        box.onclick = e => {
          const b = e.target.closest('[data-i]'); if (!b) return;
          const o = opts[+b.dataset.i];
          SND.play('ui');
          if (o.done) { UI.closeModal(); UI.refresh(); return; }
          let res;
          if (o.check) {
            const v = R.skill(G.player, o.check.skill), ok = v >= o.check.diff;
            G.log(`Проверка: ${DATA.SKILLS.find(x => x.id === o.check.skill).name} ${v} против ${o.check.diff} — ${ok ? 'успех' : 'провал'}.`, ok ? 'good' : 'warn');
            res = ok ? o.act(G) : o.fail;
          } else res = o.act(G);
          if (res == null) return;
          G.log(res, 'sys');
          UI.refresh();
          show(text, res);
        };
      });
    };
    SND.play('dialog');
    show(ev.text);
  }
  M.worldEvent = worldEvent;

  function encounter(G, tr) {
    const p = G.player;
    const roll = Math.random();
    const west = G.world.c < (WORLD.westShift || 0);
    const kind = west ? (roll < 0.6 ? 'nomads' : 'roaches') : roll > 0.9 ? 'roaches' : tr === 'g' && roll < 0.35 ? 'wolves' : roll < 0.25 ? 'rats' : tr === 'r' || tr === 'x' || tr === 'c' || roll < 0.55 ? 'raiders' : 'wild';
    const who = kind === 'nomads' ? 'пустынных налётчиков' : kind === 'roaches' ? 'рой радтараканов' : kind === 'wolves' ? 'стаю волков' : kind === 'rats' ? 'стаю радкрыс' : kind === 'raiders' ? 'группу рейдеров' : 'стаю одичалых';
    const spotChance = R.clamp(Math.round(R.skill(p, 'survival') * 0.6 + p.stats.per * 4), 5, 95);
    const spotted = Math.random() * 100 < spotChance;
    const seed = 'wild_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const go = () => { UI.closeModal(); M.leave(); return WORLD_API.goLocation(G, seed, { kind }); };
    if (spotted) {
      UI.openModal('enc', `<div class="modal" style="width:480px"><h2>Случайная встреча</h2>
        <div class="screen" style="margin-bottom:10px">Благодаря Выживанию (${spotChance}%) вы заранее замечаете впереди ${who}. Они вас пока не видят.</div>
        <div class="cols" style="justify-content:flex-end"><button id="e-avoid">Обойти стороной</button><button class="primary" id="e-go">Подобраться (скрытно)</button></div></div>`, root => {
        root.querySelector('#e-avoid').onclick = () => { UI.closeModal(); G.log('Вы обходите опасность стороной.', 'good'); G.giveXP(15); G.passTime(60); };
        root.querySelector('#e-go').onclick = () => go().then(() => { G.sneaking = true; G.log('Вы подбираетесь, пригнувшись.', 'sys'); UI.refresh(); });
      });
    } else {
      UI.openModal('enc', `<div class="modal" style="width:480px"><h2>Засада!</h2>
        <div class="screen" style="margin-bottom:10px">Вы наткнулись на ${who}. Поздно прятаться...</div>
        <div class="cols" style="justify-content:flex-end"><button class="primary" id="e-go">К бою</button></div></div>`, root => {
        root.querySelector('#e-go').onclick = () => {
          go().then(() => setTimeout(() => { const f = G.loc.actors.find(a => a.hostile && !a.dead); if (f) { for (const a of G.loc.actors) if (a.hostile) a.alerted = true; COMBAT.start(G, f, false); } }, 400));
        };
      });
    }
  }

  // отметка над местом на карте: «!» — есть цель, «?» — можно сдать, «✔» — всё сделано
  M.siteMark = function (G, id) {
    const q = k => G.q(k), has = it => G.hasItem(it), f = G.flags;
    if (id === 'camp') {
      if ((q('rats') === 1 && R.count(G.player, 'rat_tail') >= 5) || (has('samples') && q('zarya') < 9) || (has('meds') && G.quests.meds < 3) || (q('debt') === 1 && f.tihonDebtPaid) || has('toolbox') || has('battery') || q('wounded') === 2 || (q('marauder') < 9 && f.marauderKilled)) return '?';
      if (!G.quests.meds || !q('rats') || q('rats') === 1 || !q('debt') || !q('tools') || !q('wounded') || !q('marauder') || !q('ration') || (q('tools') === 9 && !q('battery'))) return '!';
      return null;
    }
    if (id === 'post') { if (G.quests.meds >= 1 && G.quests.meds < 3 && !has('meds')) return '!'; if (G.quests.meds >= 3 || has('meds')) return '✔'; return null; }
    if (id === 'zarya') {
      if (q('battery') === 1 && !has('battery')) return '!';
      if (G.qZarya && G.qZarya()) return '!';
      if (q('battery') === 9 && q('zarya') === 9) return '✔';
      return null;
    }
    return G.siteQuestMark ? G.siteQuestMark(id) : null;
  };

  M.render = function (G, t) {
    const ctx = ENG.ctx, dpr = ENG.dpr, W = G.world;
    const vw = ENG.viewW(), vh = ENG.viewH();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0806';
    ctx.fillRect(0, 0, vw, vh + ENG.hudH);
    const z = ENG.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (vw / 2 - ENG.cam.x * z), dpr * (vh / 2 - ENG.cam.y * z));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const im = ENG.img[HEX_TILES[terrainAt(c, r)]];
      const p = center(c, r);
      if (!W.revealed[key(c, r)]) {
        hexPath(ctx, p.x, p.y, 1.02);
        ctx.fillStyle = (c + r) % 2 ? '#15110c' : '#18130d'; ctx.fill();
        continue;
      }
      if (im) ctx.drawImage(im, p.x - HW * 0.54, p.y - HH * 0.54, HW * 1.08, HH * 1.08);
      if (terrainAt(c, r) === 'v') {
        hexPath(ctx, p.x, p.y, 1.04);
        ctx.fillStyle = 'rgba(30,70,90,0.72)'; ctx.fill();
        ctx.strokeStyle = 'rgba(170,220,230,0.25)'; ctx.lineWidth = 1.5;
        for (let i = -1; i <= 1; i++) { const yy = p.y + i * 22 + Math.sin(t * 2 + c + i) * 3; ctx.beginPath(); ctx.moveTo(p.x - 30, yy); ctx.quadraticCurveTo(p.x, yy - 6, p.x + 30, yy); ctx.stroke(); }
      }
    }
    // сетка
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const p = center(c, r); hexPath(ctx, p.x, p.y, 1); ctx.stroke(); }
    // локации
    ctx.textAlign = 'center';
    for (const s of WORLD.sites) {
      if (!siteState(G, s.id).known) continue;
      const p = center(s.x, s.y), im = ENG.img[s.sprite];
      if (im) { const k = Math.min(90 / im.width, 90 / im.height); ctx.drawImage(im, p.x - im.width * k / 2, p.y + 30 - im.height * k, im.width * k, im.height * k); }
      const visited = W.visited && W.visited[s.id];
      const label = s.name + (visited ? '' : ' · не исследовано');
      ctx.font = 'bold 13px Consolas, monospace';
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(p.x - w / 2, p.y + 32, w, 17);
      ctx.fillStyle = visited ? '#f0b43c' : '#a89a7c'; ctx.fillText(label, p.x, p.y + 45);
      const mk = M.siteMark(G, s.id);
      if (mk) {
        const bx = p.x + 30, by = p.y - 26 + Math.sin(t * 4) * 2;
        ctx.beginPath(); ctx.arc(bx, by, 11, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(10,10,6,.85)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = mk === '!' ? '#ffd040' : '#7dfc6a'; ctx.stroke();
        ctx.font = 'bold 15px Consolas, monospace';
        ctx.fillStyle = mk === '!' ? '#ffd040' : '#7dfc6a';
        ctx.fillText(mk, bx, by + 5);
      }
    }
    // маршрут
    if (W.path.length) {
      ctx.strokeStyle = 'rgba(125,252,106,0.7)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W.px, W.py);
      for (const h of W.path) { const p = center(h.c, h.r); ctx.lineTo(p.x, p.y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // наведение
    const m = ENG.screenToWorld(ENG.mouse.sx, ENG.mouse.sy);
    const h = ENG.mouse.inside ? hexAt(m.x, m.y) : null;
    if (h) {
      const p = center(h.c, h.r);
      hexPath(ctx, p.x, p.y, 1); ctx.strokeStyle = 'rgba(240,200,90,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      const site = WORLD.sites.find(s => s.x === h.c && s.y === h.r && siteState(G, s.id).known);
      const txt = W.revealed[key(h.c, h.r)] ? (site ? site.name : WORLD.terrain[terrainAt(h.c, h.r)]) + ` · ${hexDist(h, { c: W.c, r: W.r })} гекс.` : 'Неизведано';
      ctx.font = '12px Consolas, monospace';
      const tw = ctx.measureText(txt).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(p.x - tw / 2, p.y - 66, tw, 16);
      ctx.fillStyle = '#9dff8a'; ctx.fillText(txt, p.x, p.y - 54);
    }
    // вторжение: пульсирующий знак над поселением
    const inv = G.flags.invasion;
    if (inv && !inv.done) {
      const s = WORLD.sites.find(x => x.id === inv.loc);
      if (s) {
        const p = center(s.x, s.y), k = 1 + Math.sin(t * 6) * 0.15;
        ctx.strokeStyle = 'rgba(255,70,50,0.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, 40 * k, 0, Math.PI * 2); ctx.stroke();
        ctx.font = 'bold 18px Consolas, monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = '#ff5a3c'; ctx.fillText('⚠', p.x, p.y - 44);
        const hrs = Math.max(0, Math.ceil((inv.until - G.time) / 60));
        ctx.font = 'bold 11px Consolas, monospace';
        ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(p.x - 50, p.y - 82, 100, 15);
        ctx.fillStyle = '#ff8a6a'; ctx.fillText(`ВТОРЖЕНИЕ · ${hrs} ч`, p.x, p.y - 71);
      }
    }
    // караван в пути: значок движется от поселения к цели
    const cv = G.flags.caravan;
    if (cv && !cv.escort) {
      const a = WORLD.sites.find(x => x.id === cv.from), b = WORLD.sites.find(x => x.id === cv.to);
      if (a && b) {
        const pa = center(a.x, a.y), pb = center(b.x, b.y);
        const total = cv.eta - (cv.start != null ? cv.start : cv.eta - 600);
        const k = Math.max(0, Math.min(1, 1 - (cv.eta - G.time) / Math.max(1, total)));
        // туда и обратно: первая половина — путь к цели, вторая — возвращение
        const u = k < 0.5 ? k * 2 : 2 - k * 2;
        const x = pa.x + (pb.x - pa.x) * u, y = pa.y + (pb.y - pa.y) * u;
        ctx.setLineDash([3, 7]); ctx.strokeStyle = 'rgba(240,180,60,0.45)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.setLineDash([]);
        const bob = Math.sin(t * 4) * 2;
        ctx.fillStyle = '#f0b43c'; ctx.strokeStyle = '#3a2408'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(x - 9, y - 7 + bob, 18, 11); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3a2408'; ctx.beginPath(); ctx.arc(x - 5, y + 5 + bob, 3, 0, Math.PI * 2); ctx.arc(x + 5, y + 5 + bob, 3, 0, Math.PI * 2); ctx.fill();
        const hrs = Math.max(0, Math.ceil((cv.eta - G.time) / 60));
        ctx.font = 'bold 11px Consolas, monospace'; ctx.textAlign = 'center';
        const txt = `${cv.party ? 'Караван отряда' : 'Караван'} · ${hrs} ч`, tw = ctx.measureText(txt).width + 8;
        ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(x - tw / 2, y - 26 + bob, tw, 15);
        ctx.fillStyle = '#ffd080'; ctx.fillText(txt, x, y - 15 + bob);
      }
    }
    // цель из журнала заданий
    if (W.target) {
      const s = WORLD.sites.find(x => x.id === W.target);
      if (s) {
        const p = center(s.x, s.y), k = 1 + Math.sin(t * 4) * 0.12;
        ctx.strokeStyle = 'rgba(255,208,64,0.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, 46 * k, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(255,208,64,0.45)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(W.px, W.py); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // торговые караваны в пути (видно в 3 гексах)
    if (window.CV) CV.draw(ctx, G, t, center, hexDist);
    // участники отряда
    if (window.SOC) for (const st of Object.values(SOC.partyState)) {
      if (st.c == null || Date.now() - st.at > 8000) continue;
      const pp = center(st.c, st.r);
      ctx.fillStyle = '#8fd0ff'; ctx.strokeStyle = '#08263a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pp.x + 10, pp.y - 8, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = 'bold 11px Consolas, monospace'; ctx.fillText(st.name, pp.x + 10, pp.y - 18);
    }
    // ночь на карте мира
    const dk = G.darkness ? G.darkness() : 0;
    if (dk > 0.02) {
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(6,10,28,${dk * 0.75})`; ctx.fillRect(0, 0, vw, vh + ENG.hudH);
      ctx.restore();
    }
    // игрок
    const pulse = 1 + Math.sin(t * 5) * 0.15;
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(W.px, W.py + 4, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7dfc6a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(W.px, W.py, 12 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#7dfc6a'; ctx.beginPath(); ctx.arc(W.px, W.py, 5, 0, Math.PI * 2); ctx.fill();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // подсказка
    ctx.font = '13px Consolas, monospace'; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(217,207,181,.7)';
    ctx.fillText('Клик по гексу — идти · клик по своей локации — войти', vw - 14, vh - 10);
  };

  function hexPath(ctx, x, y, k) {
    ctx.beginPath();
    const w = HW / 2 * k, hh = HH / 2 * k;
    ctx.moveTo(x, y - hh); ctx.lineTo(x + w, y - hh / 2); ctx.lineTo(x + w, y + hh / 2); ctx.lineTo(x, y + hh); ctx.lineTo(x - w, y + hh / 2); ctx.lineTo(x - w, y - hh / 2); ctx.closePath();
  }

  return M;
})();
