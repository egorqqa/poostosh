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
    const st = { c: WORLD.start.x, r: WORLD.start.y, path: [], revealed: {}, sites: {} };
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

  M.enter = function (G) {
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
      });
    }
    const s = siteHere(G);
    panel.innerHTML = (s ? `<button class="primary" data-go="${s.id}">▶ Войти: ${s.name}</button>` : '') + `<button data-rest="1">Отдохнуть 8 ч</button>`;
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
    W.path = line({ c: W.c, r: W.r }, h);
    W.dest = h;
  };

  M.update = function (G, dt) {
    const W = G.world;
    if (!W.path.length || UI.modalOpen()) { ENG.cam.x += (W.px - ENG.cam.x) * Math.min(1, dt * 3); ENG.cam.y += (W.py - ENG.cam.y) * Math.min(1, dt * 3); return; }
    const n = W.path[0], t = center(n.c, n.r);
    const dx = t.x - W.px, dy = t.y - W.py, d = Math.hypot(dx, dy);
    const speed = 110 * (1 + R.skill(G.player, 'survival') / 200);
    if (d < speed * dt) {
      W.px = t.x; W.py = t.y; W.c = n.c; W.r = n.r; W.path.shift();
      onHex(G);
    } else { W.px += dx / d * speed * dt; W.py += dy / d * speed * dt; }
    ENG.cam.x += (W.px - ENG.cam.x) * Math.min(1, dt * 3);
    ENG.cam.y += (W.py - ENG.cam.y) * Math.min(1, dt * 3);
  };

  function onHex(G) {
    const W = G.world, p = G.player;
    const mins = Math.round(180 * (1 - Math.min(0.5, R.skill(p, 'survival') / 300)));
    G.passTime(mins);
    W.hexes = (W.hexes || 0) + 1;
    if (W.hexes % 2 === 0) p.hp = Math.min(R.maxHP(p), p.hp + R.healRate(p));
    reveal(G);
    showPanel(G);
    UI.refresh();
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
    }
  }

  function encounter(G, tr) {
    const p = G.player;
    const kind = tr === 'r' || tr === 'x' || tr === 'c' || Math.random() < 0.4 ? 'raiders' : 'wild';
    const who = kind === 'raiders' ? 'группу рейдеров' : 'стаю одичалых';
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
      ctx.font = 'bold 13px Consolas, monospace';
      const w = ctx.measureText(s.name).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(p.x - w / 2, p.y + 32, w, 17);
      ctx.fillStyle = '#f0b43c'; ctx.fillText(s.name, p.x, p.y + 45);
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
