// Торговые караваны на карте мира.
// Караваны ходят между городами по общему расписанию: номер рейса k → маршрут, время выхода, название.
// Расписание одинаково у всех игроков сервера, поэтому все видят одни и те же караваны.
// Караван можно встретить (торговать / напасть / пройти мимо) или наняться к нему в охрану.
window.CV = (function () {
  const C = {};
  const EVERY = 6 * 60;   // новый рейс — каждые 6 игровых часов
  const HEX = 180;        // караван проходит гекс за 3 часа (как пеший путник)
  const SEE = 3;          // видно за 3 гекса
  const TOWNS = ['camp', 'rassvet', 'oasis', 'city'];
  const ROUTES = [];
  for (const a of TOWNS) for (const b of TOWNS) if (a !== b) ROUTES.push([a, b]);
  const FACTIONS = {
    camp: { name: 'Торговый дом Ручья', color: '#e8a040', rep: 15,
      goods: [['water', 3, 8], ['food', 3, 8], ['bandage', 2, 6], ['ammo9', 20, 60], ['medkit', 1, 3], ['junk', 4, 10], ['moonshine', 1, 4]] },
    rassvet: { name: 'Интендантство «Рассвета»', color: '#7ab4ea', rep: 10,
      goods: [['ammo762', 20, 60], ['shells', 10, 24], ['medkit', 2, 4], ['grenade', 1, 3], ['vest', 0, 1], ['rifle', 0, 1], ['food', 2, 5]] },
    oasis: { name: 'Водовозы Оазиса', color: '#5fd4c4', rep: 0,
      goods: [['water', 8, 16], ['desert_robe', 0, 1], ['molotov', 1, 4], ['food', 2, 4], ['shells', 6, 14], ['bandage', 2, 5]] },
    city: { name: 'Артель мусорщиков', color: '#c8c09a', rep: 0,
      goods: [['junk', 8, 20], ['lockpicks', 1, 4], ['pistol', 0, 2], ['knife', 0, 2], ['tknife', 2, 6], ['ammo9', 10, 30], ['jacket', 0, 1]] },
  };
  const NAMES = ['Ржавая звезда', 'Пыльный путь', 'Последний рейс', 'Солёный ветер', 'Старая колея', 'Железный мул', 'Сухой ручей', 'Три колеса', 'Северный обоз', 'Медный котёл', 'Долгая дорога', 'Белый дым'];
  C.FACTIONS = FACTIONS;

  const hash = (k, salt = 0) => {
    let h = (Math.imul(k + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  };
  const site = id => DATA.WORLD.sites.find(s => s.id === id);
  const townName = id => (site(id) || {}).name || (DATA.LOCATIONS[id] || {}).name || id;
  C.townName = townName;
  const tq = id => { const n = townName(id); return n.includes('«') ? n : '«' + n + '»'; };

  // ---------- расписание ----------
  const pathCache = {};
  function pathOf(from, to) {
    const key = from + '>' + to;
    if (key in pathCache) return pathCache[key];
    const a = site(from), b = site(to);
    const p = a && b ? WMAP.findPath({ c: a.x, r: a.y }, { c: b.x, r: b.y }) : null;
    return (pathCache[key] = p ? [{ c: a.x, r: a.y }, ...p] : null);
  }
  C.get = function (k) {
    if (k < 0) return null;
    const [from, to] = ROUTES[hash(k, 1) % ROUTES.length];
    const path = pathOf(from, to);
    if (!path || path.length < 3) return null;
    const h = hash(k, 3);
    return { k, id: 'cv' + k, from, to, path, start: k * EVERY + (h % 90), dur: (path.length - 1) * HEX,
      name: NAMES[h % NAMES.length], fac: FACTIONS[from], guards: 2 + ((h >>> 5) % 2) };
  };
  // общее время: в сети — часы сервера, плавно между их рассылками
  C.clock = G => (window.NET && NET.active && NET.srvAt ? NET.srvTime + (Date.now() - NET.srvAt) / 2000 : G.time);
  C.isDead = (G, id) => !!((G.flags.cvDead || {})[id] || (window.NET && NET.active && NET.cvDead && NET.cvDead[id]));
  C.active = function (G) {
    const t = C.clock(G), out = [], k1 = Math.floor(t / EVERY);
    const esc = G.flags.escort;
    for (let k = k1 - 18; k <= k1; k++) {
      const cv = C.get(k);
      if (!cv || t < cv.start || t >= cv.start + cv.dur || C.isDead(G, cv.id)) continue;
      if (esc && esc.k === k) continue;            // тот, что мы охраняем, рисуется рядом с героем
      const f = (t - cv.start) / HEX, i = Math.min(cv.path.length - 1, Math.floor(f));
      cv.i = i; cv.frac = f - i; cv.hex = cv.path[i];
      out.push(cv);
    }
    return out;
  };
  C.pay = cv => ({ caps: 90 + 20 * (cv.path.length - 1), xp: 60 + 15 * (cv.path.length - 1) });

  // ---------- карта мира ----------
  function drawTruck(ctx, x, y, color, t, scale = 1) {
    const im = ENG.img && ENG.img.truck;
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0, 8, 30, 9, 0, 0, Math.PI * 2); ctx.fill();
    if (im) { const w = 64, h = w * im.height / im.width; ctx.drawImage(im, -w / 2, 8 - h, w, h); }
    else { ctx.fillStyle = '#5a5a40'; ctx.fillRect(-24, -16, 48, 20); }
    // флажок фракции
    const wave = Math.sin(t * 6) * 2;
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, -18); ctx.lineTo(14, -44); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(14, -44); ctx.lineTo(30, -40 + wave); ctx.lineTo(14, -34); ctx.fill();
    ctx.restore();
  }
  function drawGuards(ctx, x, y, n, t) {
    for (let i = 0; i < n; i++) {
      const gx = x - 30 + i * 14, gy = y + 14 + (i % 2) * 6 + Math.sin(t * 5 + i) * 1;
      ctx.fillStyle = '#2b2f22'; ctx.beginPath(); ctx.arc(gx, gy - 12, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(gx - 3, gy - 9, 6, 9);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(gx + 2, gy - 6); ctx.lineTo(gx + 8, gy - 9); ctx.stroke();
    }
  }
  // рисуется из WMAP.render (в координатах карты)
  C.draw = function (ctx, G, t, center, hexDist) {
    const W = G.world, me = { c: W.c, r: W.r };
    for (const cv of C.active(G)) {
      if (hexDist(cv.hex, me) > SEE) continue;
      const a = center(cv.hex.c, cv.hex.r), nb = cv.path[Math.min(cv.path.length - 1, cv.i + 1)], b = center(nb.c, nb.r);
      const x = a.x + (b.x - a.x) * cv.frac, y = a.y + (b.y - a.y) * cv.frac + 6;
      const hostile = (G.flags.cvHostile || {})[cv.id];
      drawGuards(ctx, x, y, cv.guards + 1, t);
      drawTruck(ctx, x, y, cv.fac.color, t, 0.9);
      ctx.font = 'bold 11px Consolas, monospace'; ctx.textAlign = 'center';
      const txt = `«${cv.name}» · ${cv.fac.name}`, tw = ctx.measureText(txt).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(x - tw / 2, y - 66, tw, 15);
      ctx.fillStyle = hostile ? '#ff7a5a' : cv.fac.color; ctx.fillText(txt, x, y - 55);
    }
    // охраняемый караван — рядом с героем
    const esc = G.flags.escort;
    if (esc) {
      drawGuards(ctx, W.px + 22, W.py + 4, Math.max(0, esc.guards - esc.guardsLost) + (esc.traderDead ? 0 : 1), t);
      drawTruck(ctx, W.px + 34, W.py - 4, (FACTIONS[esc.from] || {}).color || '#ccc', t, 0.8);
    }
  };
  C.at = function (G, hex) { return C.active(G).find(cv => cv.hex.c === hex.c && cv.hex.r === hex.r); };
  C.near = function (G, dist = 1) {
    const me = { c: G.world.c, r: G.world.r };
    return C.active(G).filter(cv => WMAP.hexDist(cv.hex, me) <= dist);
  };
  // вызывается на каждом шаге по карте; true — встреча состоялась
  // после любого выбора («Торговать», «Напасть», «Пройти мимо») караван не останавливает героя
  // ближайший игровой час — и пока они не разойдутся
  const MEET_COOLDOWN = 60;
  function metInfo(G, id) {
    const m = (G.flags.cvMet = G.flags.cvMet || {})[id];
    return m == null ? null : typeof m === 'number' ? { t: m, away: false } : m;
  }
  C.canMeet = function (G, cv) {
    const m = metInfo(G, cv.id);
    return !m || (C.clock(G) - m.t >= MEET_COOLDOWN && m.away);
  };
  C.checkMeet = function (G) {
    if (G.flags.escort) return false;
    const near = C.near(G, 1);
    // караваны, с которыми уже разошлись, снова можно встретить (после часа)
    for (const [id, v] of Object.entries(G.flags.cvMet || {})) {
      if (!near.some(c => c.id === id)) { const m = metInfo(G, id); m.away = true; G.flags.cvMet[id] = m; }
      if (C.clock(G) - (typeof v === 'number' ? v : v.t) > 48 * 60) delete G.flags.cvMet[id];
    }
    const cv = near.find(c => C.canMeet(G, c));
    if (!cv) return false;
    C.openMeet(G, cv);
    return true;
  };

  C.openMeet = function (G, cv) {
    G.flags.cvMet = G.flags.cvMet || {};
    G.flags.cvMet[cv.id] = { t: C.clock(G), away: false };
    const resume = G.world.path.slice(); // куда герой шёл — продолжит после «Пройти мимо»
    G.world.path = [];
    const hostile = (G.flags.cvHostile || {})[cv.id];
    SND.play(hostile ? 'alert' : 'dialog');
    UI.openModal('enc', `<div class="modal" style="width:min(520px,95vw)"><h2>Караван «${cv.name}»</h2>
      <div class="screen" style="margin-bottom:10px">Вы встретили караван «${cv.name}» — ${cv.fac.name}.<br>
        Грузовик, торговец и ${cv.guards} вооружённых охранника. Идёт из ${tq(cv.from)} в ${tq(cv.to)}.
        ${hostile ? '<br><span class="bad">Охрана узнаёт вас: вы уже нападали на этот караван. Торговать с вами не станут.</span>' : ''}</div>
      <div class="cols" style="justify-content:flex-end;flex-wrap:wrap;gap:6px">
        <button id="m-pass">Пройти мимо</button>
        <button id="m-attack" style="border-color:#a03a2a">Напасть</button>
        <button class="primary" id="m-trade" ${hostile ? 'disabled' : ''}>Торговать</button>
      </div></div>`, root => {
      root.querySelector('#m-pass').onclick = () => { UI.closeModal(); G.log(`Караван «${cv.name}» идёт своей дорогой, вы — своей.`, 'sys'); G.world.path = resume; };
      root.querySelector('#m-trade').onclick = () => C.enter(G, cv, 'trade');
      root.querySelector('#m-attack').onclick = () => C.enter(G, cv, 'attack');
    });
  };

  C.enter = function (G, cv, mode) {
    UI.closeModal(); WMAP.leave();
    const id = 'wild_cv_' + cv.k;
    return WORLD_API.goLocation(G, id, { kind: 'caravan', cv: { k: cv.k, mode } }).then(() => {
      if (mode !== 'attack') { G.log(`Караван «${cv.name}» встал на привал. Торговец ждёт у грузовика.`, 'good'); return; }
      G.flags.cvHostile = G.flags.cvHostile || {}; G.flags.cvHostile[cv.id] = true;
      if (cv.fac.rep) G.addRep(-cv.fac.rep, `нападение на караван «${cv.fac.name}»`);
      setTimeout(() => {
        const f = G.loc.actors.find(a => a.cvRole && !a.dead);
        if (f) COMBAT.start(G, f, true);
        G.log('Вы нападаете на караван!', 'bad');
      }, 400);
    });
  };

  // ---------- локация каравана ----------
  // описание локации (вызывается из world.js для kind caravan / cvfight)
  C.locDef = function (id, opts, base) {
    const r = ENG.seeded(id);
    const cvo = opts.cv || {}, cv = C.get(cvo.k) || C.get(0);
    const objects = base.objects.filter(([s, x, y]) => !(x > 9 && x < 26 && y > 8 && y < 24));
    objects.push(['truck', 15, 12, { fw: 3, fh: 5, oy: 8, name: 'Грузовик каравана', desc: `Тентованный грузовик. На борту краской: «${cv.name}».` }]);
    objects.push(['crate_pile', 19, 11, { name: 'Груз каравана', container: true, lock: 55, owner: 'cv_trader', cvCargo: true, items: [], desc: 'Ящики и мешки с товаром под брезентом. Замок навесной.' }]);
    objects.push(['barrels', 12, 17, {}]);
    const npcs = [];
    const fight = opts.kind === 'cvfight';
    const guards = fight ? Math.max(0, opts.guards) : cv.guards;
    if (!(fight && opts.traderDead)) npcs.push(['cv_trader', 17, 18, { cvRole: 'trader' }]);
    const gpos = [[13, 20], [21, 16], [12, 13], [22, 20]];
    for (let i = 0; i < guards; i++) npcs.push([i % 2 ? 'cv_guard_ak' : 'cv_guard', gpos[i][0], gpos[i][1], { cvRole: 'guard' }]);
    if (fight) {
      const west = (cv.path[0] && cv.path[0].c < (DATA.WORLD.westShift || 0)) || cv.from === 'oasis' || cv.to === 'oasis';
      const n = 3 + (opts.n || 1) + Math.min(3, opts.party || 0);
      for (let i = 0; i < n; i++) {
        const tpl = west ? 'nomad_raider' : (r() < 0.55 ? 'raider' : 'raider_melee');
        npcs.push([tpl, 6 + Math.floor(r() * 22), 2 + Math.floor(r() * 4), {}]);
      }
      if ((opts.n || 1) >= 2) npcs.push([west ? 'nomad_raider' : 'scav_boss', 17, 3, {}]);
    }
    return { ...base, entry: { x: 17, y: 23 }, name: fight ? 'Нападение на караван' : `Караван «${cv.name}»`, objects, npcs, cv: { k: cv.k, id: cv.id, name: cv.name, from: cv.from, mode: fight ? 'fight' : cvo.mode || 'trade' },
      desc: fight ? 'Рейдеры перегородили дорогу. Охрана каравана занимает оборону у грузовика.' : 'Караван остановился на привал у обочины.' };
  };
  // после загрузки локации: роли, товар, союзники/враги
  C.setup = function (G, L) {
    const info = L.def.cv, cv = C.get(info.k);
    if (!cv) return;
    const r = ENG.seeded(L.id + ':goods');
    for (const a of L.actors) {
      if (!a.cvRole) continue;
      a.faction = 'caravan';
      if (a.cvRole === 'trader') {
        a.name = `Торговец «${cv.name}»`;
        if (!a.cvStocked) {
          a.cvStocked = true;
          a.inv = [];
          for (const [it, lo, hi] of cv.fac.goods) { const n = lo + Math.floor(r() * (hi - lo + 1)); if (n > 0) a.inv.push({ id: it, n }); }
          a.caps = 250 + Math.floor(r() * 300);
        }
      } else a.name = `Охранник «${cv.name}»`;
      if (info.mode === 'fight') { a.ally = true; a.hostile = false; a.alerted = true; }
      else if (info.mode === 'attack') { a.hostile = true; a.alerted = true; }
    }
    const crate = L.objects.find(o => o.cvCargo);
    if (crate && !crate.cvStocked) {
      crate.cvStocked = true;
      crate.inv = cv.fac.goods.map(([it, lo, hi]) => ({ id: it, n: Math.max(0, Math.round((lo + hi) / 2)) })).filter(s => s.n > 0);
      crate.caps = 80 + Math.floor(r() * 120);
    }
  };
  // гибель NPC каравана (из COMBAT.kill)
  C.onKill = function (G, a, by) {
    const info = G.loc && G.loc.def.cv;
    if (!info || !a.cvRole) return;
    if (info.mode === 'fight') {
      G.log(a.cvRole === 'trader' ? `Погиб торговец каравана! Награда за рейс будет меньше.` : `Погиб охранник каравана.`, 'bad');
      return;
    }
    // грабёж: караван уничтожен, когда пал торговец или вся охрана
    G.flags.cvHostile = G.flags.cvHostile || {}; G.flags.cvHostile[info.id] = true;
    const left = G.loc.actors.filter(x => x.cvRole && !x.dead && !x.gone && x !== a);
    if (a.cvRole === 'trader' || !left.length) C.markDead(G, info.id, info.name);
  };
  C.markDead = function (G, id, name) {
    G.flags.cvDead = G.flags.cvDead || {};
    if (G.flags.cvDead[id]) return;
    G.flags.cvDead[id] = true;
    G.log(`Караван «${name}» разграблен. Груз в кузове — ваш.`, 'warn');
    if (window.NET && NET.active) { NET.send({ t: 'cvdead', id }); NET.send({ t: 'stat', k: 'robberies' }); }
    G.giveXP(80);
  };

  // ---------- охрана караванов ----------
  C.board = function (G, town) {
    const t = C.clock(G), k1 = Math.floor(t / EVERY), list = [];
    for (let k = k1; k <= k1 + 12 && list.length < 4; k++) {
      const cv = C.get(k);
      if (cv && cv.from === town && cv.start >= t - 30 && !C.isDead(G, cv.id)) list.push(cv);
    }
    const esc = G.flags.escort;
    UI.openModal('escort', `<div class="modal" style="width:min(620px,96vw)">
      <h2>Охрана караванов <button class="close" data-close>✕</button></h2>
      <div class="muted" style="margin-bottom:6px">Караван идёт из города в город. В пути на него почти наверняка нападут: охрана с торговцем дерётся на вашей стороне. Довели — получите плату и опыт. Погибший торговец сильно урезает плату, каждый погибший охранник — немного.${window.NET && NET.active && Object.keys(SOC.party).length ? ' Отряд получит приглашение идти вместе: платят каждому.' : ''}</div>
      <div class="screen" id="eb-list">${esc ? `<div>Вы уже охраняете караван «${esc.name}» → ${tq(esc.to)}.</div>`
        : list.length ? list.map(cv => {
          const pay = C.pay(cv), wait = Math.max(0, Math.round((cv.start - t) / 60));
          return `<div class="item" style="grid-template-columns:1fr auto;cursor:default"><div><div class="nm" style="color:${cv.fac.color}">«${cv.name}» · ${cv.fac.name}</div>
            <div class="sub">→ ${tq(cv.to)}, ${cv.path.length - 1} переходов · охрана ${cv.guards} · отправление ${wait ? 'через ' + wait + ' ч' : 'сейчас'}<br>Плата: ${pay.caps} крышек и ${pay.xp} опыта (+25% за каждое отбитое нападение)</div></div>
            <div><button data-hire="${cv.k}">Наняться</button></div></div>`;
        }).join('') : '<div class="muted">Сейчас отсюда караваны не уходят. Загляните позже.</div>'}</div></div>`, root => {
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-hire]');
        if (b) C.hire(G, +b.dataset.hire);
      });
    });
  };

  C.hire = function (G, k) {
    const cv = C.get(k);
    if (!cv || G.flags.escort) return;
    if (G.combat) { G.log('Сначала закончите бой — караван не будет ждать под пулями.', 'warn'); return; }
    const t = C.clock(G);
    if (cv.start > t && !(window.NET && NET.active)) { const w = Math.ceil(cv.start - t); G.passTime(w); G.log(`Вы ждёте отправления ${Math.round(w / 60)} ч.`, 'sys'); }
    const h = hash(k, 7), len = cv.path.length - 1;
    const a1 = (h % 100) < 85 ? Math.max(1, Math.min(len - 1, 1 + Math.floor(len * (0.25 + 0.45 * (((h >>> 8) % 100) / 100))))) : null;
    const a2 = a1 && ((h >>> 16) % 100) < 10 && a1 + 2 < len ? Math.min(len - 1, a1 + 2 + ((h >>> 20) % 3)) : null;
    const esc = { k, id: cv.id, name: cv.name, from: cv.from, to: cv.to, path: cv.path.map(p => [p.c, p.r]), i: 0, guards: cv.guards,
      guardsLost: 0, traderDead: false, fights: 0, attacks: [a1, a2].filter(x => x != null), leader: true, party: [], pay: C.pay(cv) };
    G.flags.escort = esc;
    UI.closeModal(); if (G.dialog) WORLD_API.endDialog(G);
    G.log(`Вы нанялись в охрану каравана «${cv.name}» до ${tq(cv.to)}. На карте мира нажмите «Идти с караваном».`, 'good');
    SND.play('quest');
    if (window.NET && NET.active && window.SOC) SOC.bcast({ kind: 'party_esc', esc: { ...esc, leader: false, party: [] } });
    const s = site(cv.from);
    WORLD_API.leaveToWorld(G, s ? { c: s.x, r: s.y } : null);
  };

  C.fail = function (G, why) {
    const esc = G.flags.escort;
    if (!esc) return;
    G.flags.escort = null;
    G.log(`${why} Рейс сорван, платы не будет.`, 'bad');
    if (esc.leader && window.NET && NET.active && window.SOC) SOC.bcast({ kind: 'party_escfail', why });
    if (esc.leader) { G.flags.cvDead = G.flags.cvDead || {}; G.flags.cvDead[esc.id] = true; }
    if (G.scene === 'world') WMAP.refreshPanel(G);
  };

  // кнопки на карте мира
  C.panelHtml = function (G) {
    const esc = G.flags.escort;
    if (!esc) return '';
    const left = esc.path.length - 1 - esc.i;
    return esc.leader
      ? `<button class="primary" data-esc="go">▶ Идти с караваном (до ${tq(esc.to)}: ${left})</button><button data-esc="drop">✖ Бросить караван</button>`
      : `<div class="screen" style="padding:4px 8px">Вы в охране «${esc.name}». Ведёт наниматель.</div><button data-esc="drop">✖ Уйти из охраны</button>`;
  };
  C.panelClick = function (G, what) {
    const esc = G.flags.escort;
    if (!esc) return;
    if (what === 'drop') {
      if (esc.leader) C.fail(G, 'Вы бросили караван.');
      else { G.flags.escort = null; G.log('Вы ушли из охраны каравана.', 'warn'); if (esc.leaderId && window.SOC) SOC.send(esc.leaderId, { kind: 'party_escleave' }); WMAP.refreshPanel(G); }
      return;
    }
    if (what === 'go' && esc.leader) {
      const W = G.world;
      const cur = esc.path[esc.i];
      if (W.c !== cur[0] || W.r !== cur[1]) { W.c = cur[0]; W.r = cur[1]; }
      W.path = esc.path.slice(esc.i + 1).map(([c, r]) => ({ c, r }));
    }
  };

  // шаг по карте во время охраны; true — обычные встречи не происходят
  C.onStep = function (G) {
    const esc = G.flags.escort;
    if (!esc) return false;
    const W = G.world;
    if (!esc.leader) return true;
    const idx = esc.path.findIndex(([c, r], i) => i > esc.i && c === W.c && r === W.r);
    if (idx > 0) esc.i = idx;
    if (window.NET && NET.active && window.SOC) SOC.bcast({ kind: 'party_escstep', i: esc.i });
    if (esc.i >= esc.path.length - 1) { W.path = []; C.arrive(G); return true; }
    if (esc.attacks.includes(esc.i) && !(esc.done || []).includes(esc.i)) {
      // второе нападение — только если первое отбито (иначе рейс уже сорван)
      W.path = [];
      C.ambush(G);
    }
    return true;
  };

  C.ambush = function (G) {
    const esc = G.flags.escort;
    esc.done = esc.done || []; esc.done.push(esc.i);
    const n = esc.fights + 1;
    const loc = `wild_cvf_${esc.k}_${n}`;
    const opts = { kind: 'cvfight', cv: { k: esc.k, mode: 'fight' }, n, guards: esc.guards - esc.guardsLost, traderDead: esc.traderDead, party: esc.party.length };
    if (window.NET && NET.active && window.SOC) SOC.bcast({ kind: 'party_escfight', loc, opts });
    SND.play('alert');
    UI.openModal('enc', `<div class="modal" style="width:min(480px,95vw)"><h2>Нападение на караван!</h2>
      <div class="screen" style="margin-bottom:10px">${n > 1 ? 'Не успели отдышаться — снова засада!' : 'Дорогу перегородили обломки. Из-за них поднимаются вооружённые люди.'} Охрана «${esc.name}» занимает оборону у грузовика.</div>
      <div class="cols" style="justify-content:flex-end"><button class="primary" id="a-go">К бою</button></div></div>`, root => {
      root.querySelector('#a-go').onclick = () => C.goFight(G, loc, opts);
    });
  };
  C.goFight = function (G, loc, opts) {
    UI.closeModal(); WMAP.leave();
    return WORLD_API.goLocation(G, loc, opts).then(() => setTimeout(() => {
      const f = G.loc.actors.find(a => a.hostile && !a.dead && !a.cvRole);
      if (f && !G.combat) { for (const a of G.loc.actors) if (a.hostile) a.alerted = true; COMBAT.start(G, f, false); }
    }, 400));
  };
  // уход с локации боя: итог нападения считает наниматель
  C.onLeave = function (G) {
    const L = G.loc, info = L && L.def.cv, esc = G.flags.escort;
    if (!info || info.mode !== 'fight' || !esc || !esc.leader) return;
    const raiders = L.actors.some(a => a.hostile && !a.dead && !a.gone && !a.cvRole);
    if (raiders) { setTimeout(() => C.fail(G, 'Вы ушли, не отбив нападение. Караван разграблен.'), 0); return; }
    const deadT = L.actors.some(a => a.cvRole === 'trader' && a.dead);
    const deadG = L.actors.filter(a => a.cvRole === 'guard' && a.dead).length;
    if (deadT) esc.traderDead = true;
    esc.guardsLost += deadG;
    esc.fights++;
    G.log(`Нападение отбито!${deadT ? ' Торговец погиб.' : ''}${deadG ? ` Погибло охранников: ${deadG}.` : ''} Караван продолжает путь.`, 'good');
    if (window.NET && NET.active && window.SOC) SOC.bcast({ kind: 'party_escstate', traderDead: esc.traderDead, guardsLost: esc.guardsLost, fights: esc.fights });
  };

  C.reward = function (esc) {
    const mult = (esc.traderDead ? 0.4 : 1) * Math.max(0.2, 1 - 0.12 * esc.guardsLost) * (1 + 0.25 * esc.fights);
    return { caps: Math.round(esc.pay.caps * mult), xp: Math.round(esc.pay.xp * (1 + 0.25 * esc.fights)) };
  };
  C.arrive = function (G) {
    const esc = G.flags.escort;
    if (!esc) return;
    G.flags.escort = null;
    const rw = C.reward(esc);
    G.log(`Караван «${esc.name}» дошёл до ${tq(esc.to)}!${esc.traderDead ? ' (торговец погиб — плата урезана)' : ''}${esc.guardsLost ? ` Потеряно охранников: ${esc.guardsLost}.` : ''}`, 'good');
    G.reward(rw.xp, rw.caps);
    const fac = FACTIONS[esc.from];
    if (fac && fac.rep) G.addRep(3, `караван «${fac.name}» доведён`);
    if (esc.from === 'camp' && G.q('p_gosha') === 2) G.setQuest('p_gosha', 3); // долг Гоши отработан
    SND.play('quest');
    if (window.NET && NET.active) { NET.send({ t: 'stat', k: 'escorts' }); if (window.SOC) SOC.bcast({ kind: 'party_escdone', caps: rw.caps, xp: rw.xp, name: esc.name, dest: esc.to }); } // не «to» — это адресат сообщения
    WMAP.refreshPanel(G);
  };

  // ---------- отряд: совместная охрана ----------
  C.onPartyEv = function (G, m, name) {
    const esc = G.flags.escort;
    switch (m.kind) {
      case 'party_esc':
        if (esc) return true;
        SOC.prompt('Охрана каравана', `<b>${name}</b> нанялся охранять караван «${m.esc.name}» до ${tq(m.esc.to)}. Пойти вместе? Плата: ${m.esc.pay.caps} крышек и ${m.esc.pay.xp} опыта каждому.`, () => {
          G.flags.escort = { ...m.esc, leader: false, leaderId: m.from };
          SOC.send(m.from, { kind: 'party_escjoin' });
          G.log(`Вы идёте в охране каравана «${m.esc.name}». Ведёт ${name}.`, 'good');
          const [c, r] = m.esc.path[m.esc.i];
          if (G.scene === 'local') WORLD_API.leaveToWorld(G, { c, r });
          else { G.world.c = c; G.world.r = r; WMAP.enter(G); }
        });
        return true;
      case 'party_escjoin':
        if (esc && esc.leader) { esc.party.push(name); G.log(`${name} идёт с вами в охране каравана.`, 'good'); }
        return true;
      case 'party_escleave':
        if (esc && esc.leader) { esc.party = esc.party.filter(n => n !== name); G.log(`${name} ушёл из охраны каравана.`, 'warn'); }
        return true;
      case 'party_escstep':
        if (esc && !esc.leader && m.from === esc.leaderId) {
          esc.i = m.i;
          const [c, r] = esc.path[esc.i];
          if (G.scene === 'world') G.world.path = [{ c, r }];
          else if (G.world) { G.world.c = c; G.world.r = r; }
        }
        return true;
      case 'party_escfight':
        if (esc && !esc.leader && m.from === esc.leaderId) {
          if (G.scene !== 'world') { G.log('На караван напали! Вернитесь на карту мира, чтобы прийти на помощь.', 'bad'); return true; }
          G.world.path = [];
          SND.play('alert');
          UI.openModal('enc', `<div class="modal" style="width:min(460px,95vw)"><h2>Нападение на караван!</h2>
            <div class="screen" style="margin-bottom:10px">Засада на дороге! ${name} и охрана «${esc.name}» уже в бою.</div>
            <div class="cols" style="justify-content:flex-end"><button class="primary" id="a-go">К бою</button></div></div>`, root => {
            root.querySelector('#a-go').onclick = () => C.goFight(G, m.loc, m.opts);
          });
        }
        return true;
      case 'party_escstate':
        if (esc && !esc.leader) { esc.traderDead = m.traderDead; esc.guardsLost = m.guardsLost; esc.fights = m.fights; }
        return true;
      case 'party_escdone':
        if (esc && !esc.leader && m.from === esc.leaderId) {
          G.flags.escort = null;
          G.log(`Караван «${m.name}» дошёл до ${tq(m.dest)}! Ваша плата за охрану:`, 'good');
          G.reward(m.xp, m.caps); SND.play('quest');
          NET.send({ t: 'stat', k: 'escorts' });
          if (G.scene === 'world') WMAP.refreshPanel(G);
        }
        return true;
      case 'party_escfail':
        if (esc && !esc.leader && m.from === esc.leaderId) { G.flags.escort = null; G.log(`Рейс сорван: ${m.why}`, 'bad'); if (G.scene === 'world') WMAP.refreshPanel(G); }
        return true;
    }
    return false;
  };

  return C;
})();
