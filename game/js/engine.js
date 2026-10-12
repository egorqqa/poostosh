// Движок: загрузка ассетов, изометрия, отрисовка локаций, поиск пути
window.ENG = (function () {
  const TW = 64, TH = 32, HW = 32, HH = 16;
  const FR = { w: 120, h: 110, ax: 60, ay: 104 };
  const DIR = { S: 0, E: 1, N: 2, W: 3 };

  const E = {
    canvas: null, ctx: null, dpr: 1, img: {}, sheets: {}, zoom: 1,
    cam: { x: 0, y: 0 }, mouse: { sx: 0, sy: 0, wx: 0, wy: 0, tile: null, inside: false },
    effects: [], floaters: [], hudH: 186,
  };

  // ---------- загрузка ----------
  E.load = function (onProgress) {
    const man = window.ASSET_MANIFEST;
    const names = Object.keys(man);
    let done = 0;
    return Promise.all(names.map(n => new Promise(res => {
      const im = new Image();
      im.onload = () => { E.img[n] = im; done++; onProgress && onProgress(done / names.length); res(); };
      im.onerror = () => { console.warn('Не загружен ассет', n); done++; res(); };
      im.src = man[n].src;
    }))).then(() => {
      // существа со своими листами (8 направлений)
      E.models = {};
      for (const [key, man] of Object.entries(window.ASSET_MANIFEST)) {
        if (!key.startsWith('char_') || key === 'char_soldier' || !E.img[key]) continue;
        const im = E.img[key];
        const o = document.createElement('canvas'); o.width = im.width; o.height = im.height;
        const ox = o.getContext('2d'); ox.shadowColor = 'rgba(0,0,0,0.8)'; ox.shadowBlur = 2; ox.drawImage(im, 0, 0);
        E.models[key.slice(5)] = { canvas: o, fw: man.fw, fh: man.fh, ax: man.ax, ay: man.ay, frames: man.frames };
      }
      // перекрашенные копии модели персонажа
      const base = E.img.char_soldier;
      for (const [k, f] of Object.entries(DATA.TINTS)) {
        const c = document.createElement('canvas');
        c.width = base.width; c.height = base.height;
        const cx = c.getContext('2d');
        cx.filter = (f ? f + ' ' : '') + 'brightness(1.12) contrast(1.06)';
        cx.drawImage(base, 0, 0);
        // тёмный контур для читаемости на пёстрой земле
        const o = document.createElement('canvas');
        o.width = c.width; o.height = c.height;
        const ox = o.getContext('2d');
        ox.shadowColor = 'rgba(0,0,0,0.85)'; ox.shadowBlur = 3;
        ox.drawImage(c, 0, 0);
        E.sheets[k] = o;
      }
    });
  };

  E.init = function (canvas) {
    E.canvas = canvas;
    E.ctx = canvas.getContext('2d');
    const resize = () => {
      E.dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(innerWidth * E.dpr);
      canvas.height = Math.round(innerHeight * E.dpr);
    };
    addEventListener('resize', resize);
    resize();
  };

  // ---------- изометрия ----------
  const iso = (tx, ty) => ({ x: (tx - ty) * HW, y: (tx + ty) * HH });
  const tileCenter = (x, y) => iso(x + 0.5, y + 0.5);
  const fromIso = (sx, sy) => ({ x: (sy / HH + sx / HW) / 2, y: (sy / HH - sx / HW) / 2 });
  E.iso = iso; E.tileCenter = tileCenter; E.fromIso = fromIso; E.FR = FR; E.DIR = DIR;

  E.viewW = () => E.canvas.width / E.dpr;
  E.viewH = () => E.canvas.height / E.dpr - E.hudH;
  E.screenToWorld = (sx, sy) => ({ x: (sx - E.viewW() / 2) / E.zoom + E.cam.x, y: (sy - E.viewH() / 2) / E.zoom + E.cam.y });
  E.worldToScreen = (wx, wy) => ({ x: (wx - E.cam.x) * E.zoom + E.viewW() / 2, y: (wy - E.cam.y) * E.zoom + E.viewH() / 2 });

  // ---------- детерминированный рандом ----------
  function seeded(seed) {
    let a = 0;
    for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) | 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  E.seeded = seeded;

  // ---------- земля ----------
  E.buildGround = function (L) {
    const pad = 260;
    const W = (L.w + L.h) * HW + pad * 2, H = (L.w + L.h) * HH + pad * 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const ox = L.h * HW + pad, oy = pad;
    const r = seeded(L.id + (L.seed || ''));
    g.fillStyle = L.def.base || '#504432';
    g.fillRect(0, 0, W, H);
    // мелкий шум
    for (let i = 0; i < W * H / 500; i++) {
      g.fillStyle = `rgba(${r() < .5 ? '0,0,0' : '255,230,190'},${0.03 + r() * 0.05})`;
      g.fillRect(r() * W, r() * H, 2 + r() * 6, 1 + r() * 3);
    }
    const kinds = L.def.ground, weights = L.def.groundW || kinds.map(() => 1);
    const tot = weights.reduce((a, b) => a + b, 0);
    const pick = () => { let v = r() * tot; for (let i = 0; i < kinds.length; i++) { v -= weights[i]; if (v <= 0) return kinds[i]; } return kinds[0]; };
    const step = 4;
    for (let j = -4; j < L.h + 4; j += step) for (let i = -4; i < L.w + 4; i += step) {
      const im = E.img['ground_' + pick()];
      if (!im) continue;
      const p = iso(i + r() * 2, j + r() * 2);
      const s = 0.85 + r() * 0.3;
      g.save();
      g.translate(ox + p.x, oy + p.y);
      if (r() < 0.5) g.scale(-1, 1);
      g.drawImage(im, -im.width * s / 2, -im.height * s / 2, im.width * s, im.height * s);
      g.restore();
    }
    // затемнение за пределами карты
    const a = iso(0, 0), b = iso(L.w, 0), cc = iso(L.w, L.h), d = iso(0, L.h);
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.moveTo(ox + a.x, oy + a.y); g.lineTo(ox + d.x, oy + d.y); g.lineTo(ox + cc.x, oy + cc.y); g.lineTo(ox + b.x, oy + b.y); g.closePath();
    g.shadowColor = 'rgba(0,0,0,0.95)'; g.shadowBlur = 60;
    g.fillStyle = 'rgba(8,6,4,0.82)';
    g.fill('evenodd');
    g.restore();
    if (L.def.river) drawRiver(g, L, ox, oy, r);
    if (L.def.interior) drawInterior(g, L, ox, oy, r);
    L.ground = { canvas: c, ox, oy };
  };

  // река с мостом поперёк карты
  function drawRiver(g, L, ox, oy, r) {
    const rv = L.def.river;
    const P = (x, y) => { const p = iso(x, y); return { x: ox + p.x, y: oy + p.y }; };
    const poly = (pts, fill) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fillStyle = fill; g.fill(); };
    const band = [P(0, rv.y0), P(L.w, rv.y0), P(L.w, rv.y1 + 1), P(0, rv.y1 + 1)];
    // берега
    poly([P(0, rv.y0 - 0.6), P(L.w, rv.y0 - 0.6), P(L.w, rv.y1 + 1.6), P(0, rv.y1 + 1.6)], 'rgba(40,34,22,0.65)');
    const a = band[0], c = band[2];
    const gr = g.createLinearGradient(a.x, a.y, c.x, c.y);
    gr.addColorStop(0, '#2a4a52'); gr.addColorStop(0.5, '#1e3c46'); gr.addColorStop(1, '#2a4a52');
    poly(band, gr);
    // рябь
    g.save(); g.beginPath(); band.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.clip();
    g.strokeStyle = 'rgba(160,210,220,0.18)'; g.lineWidth = 1.5;
    for (let i = 0; i < 160; i++) {
      const p = P(r() * L.w, rv.y0 + r() * (rv.y1 - rv.y0 + 1));
      g.beginPath(); g.moveTo(p.x - 10, p.y); g.quadraticCurveTo(p.x, p.y - 3, p.x + 10, p.y); g.stroke();
    }
    g.restore();
    // настил моста
    const deck = [P(rv.bx0, rv.y0 - 0.4), P(rv.bx1 + 1, rv.y0 - 0.4), P(rv.bx1 + 1, rv.y1 + 1.4), P(rv.bx0, rv.y1 + 1.4)];
    poly(deck, '#5b574e');
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
    for (let y = rv.y0; y <= rv.y1 + 1; y += 0.5) { const p1 = P(rv.bx0, y), p2 = P(rv.bx1 + 1, y); g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke(); }
    // перила
    g.strokeStyle = '#7a3f22'; g.lineWidth = 4;
    for (const x of [rv.bx0, rv.bx1 + 1]) {
      const p1 = P(x, rv.y0 - 0.4), p2 = P(x, rv.y1 + 1.4);
      g.beginPath(); g.moveTo(p1.x, p1.y - 14); g.lineTo(p2.x, p2.y - 14); g.stroke();
      for (let y = rv.y0; y <= rv.y1 + 1; y += 1) { const q = P(x, y); g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x, q.y - 14); g.stroke(); }
    }
  }

  // стены и освещение помещений: задние стены «в разрезе» и полумрак
  function drawInterior(g, L, ox, oy, r) {
    const A = iso(0, 0), B = iso(L.w, 0), D = iso(0, L.h), Cc = iso(L.w, L.h);
    const H = 150, [cr, cg, cb] = L.def.wallColor || [100, 90, 80];
    const P = p => ({ x: ox + p.x, y: oy + p.y });
    // затемнение пола
    g.save();
    g.beginPath(); const a = P(A), b = P(B), c2 = P(Cc), d = P(D);
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c2.x, c2.y); g.lineTo(d.x, d.y); g.closePath();
    g.fillStyle = L.def.lab ? 'rgba(10,40,25,0.35)' : 'rgba(0,0,0,0.32)'; g.fill();
    g.clip();
    // пятна света от ламп
    for (let i = 0; i < 5; i++) {
      const lp = P(iso(r() * L.w, r() * L.h));
      const gr = g.createRadialGradient(lp.x, lp.y, 10, lp.x, lp.y, 220);
      gr.addColorStop(0, L.def.lab ? 'rgba(120,255,160,0.16)' : 'rgba(255,210,140,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(lp.x - 230, lp.y - 230, 460, 460);
    }
    g.restore();
    const wall = (p1, p2, shade) => {
      const q1 = P(p1), q2 = P(p2);
      g.beginPath(); g.moveTo(q1.x, q1.y); g.lineTo(q2.x, q2.y); g.lineTo(q2.x, q2.y - H); g.lineTo(q1.x, q1.y - H); g.closePath();
      const grd = g.createLinearGradient(0, q1.y - H, 0, q1.y);
      grd.addColorStop(0, `rgb(${cr * shade * 0.55 | 0},${cg * shade * 0.55 | 0},${cb * shade * 0.55 | 0})`);
      grd.addColorStop(1, `rgb(${cr * shade | 0},${cg * shade | 0},${cb * shade | 0})`);
      g.fillStyle = grd; g.fill();
      // кирпичная кладка
      g.save(); g.clip();
      g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 1;
      const len = Math.hypot(q2.x - q1.x, q2.y - q1.y), dx = (q2.x - q1.x) / len, dy = (q2.y - q1.y) / len;
      for (let h = 0, row = 0; h < H; h += 10, row++) {
        g.beginPath(); g.moveTo(q1.x, q1.y - h); g.lineTo(q2.x, q2.y - h); g.stroke();
        for (let s = (row % 2) * 12; s < len; s += 24) {
          g.beginPath(); g.moveTo(q1.x + dx * s, q1.y + dy * s - h); g.lineTo(q1.x + dx * s, q1.y + dy * s - h - 10); g.stroke();
        }
      }
      // окна и трубы
      for (let s = 80; s < len - 60; s += 170 + r() * 80) {
        const wx = q1.x + dx * s, wy = q1.y + dy * s - 95;
        g.fillStyle = L.def.lab ? 'rgba(40,90,60,0.85)' : 'rgba(30,40,45,0.9)';
        g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + dx * 46, wy + dy * 46); g.lineTo(wx + dx * 46, wy + dy * 46 + 34); g.lineTo(wx, wy + 34); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; g.stroke();
      }
      g.strokeStyle = 'rgba(70,60,50,0.9)'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(q1.x, q1.y - H + 22); g.lineTo(q2.x, q2.y - H + 22); g.stroke();
      g.restore();
      // карниз
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(q1.x, q1.y - H); g.lineTo(q2.x, q2.y - H); g.stroke();
    };
    wall(D, A, 0.75);
    wall(A, B, 1.0);
  }

  // ---------- геометрия объектов ----------
  E.objectAnchor = function (o) {
    const c = iso(o.x + o.fw / 2, o.y + o.fh / 2);
    const b = iso(o.x + o.fw, o.y + o.fh);
    return { x: c.x, y: b.y + (o.oy || 0) };
  };
  E.objectRect = function (o) {
    const im = E.img[o.sprite];
    const an = E.objectAnchor(o);
    return { x: an.x - im.width / 2, y: an.y - im.height, w: im.width, h: im.height };
  };

  // ---------- поиск пути ----------
  E.passable = function (L, x, y, ignore) {
    if (x < 0 || y < 0 || x >= L.w || y >= L.h) return false;
    if (L.blocked[y * L.w + x]) return false;
    for (const a of L.actors) if (!a.dead && a !== ignore && a.x === x && a.y === y && !a.leaving) return false;
    return true;
  };

  // A*: возвращает список клеток (без стартовой) или null
  E.findPath = function (L, sx, sy, tx, ty, opts = {}) {
    const { ignore, adjacent = false, maxLen = 400 } = opts;
    const W = L.w, key = (x, y) => y * W + x;
    const goal = opts.goal || ((x, y) => adjacent ? Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= 1 && !(x === tx && y === ty) : x === tx && y === ty);
    if (goal(sx, sy)) return [];
    if (!adjacent && !opts.goal && !E.passable(L, tx, ty, ignore)) return null;
    const open = [{ x: sx, y: sy, g: 0, f: 0 }];
    const came = new Map(), gs = new Map([[key(sx, sy), 0]]);
    const h = (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty));
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let it = 0;
    while (open.length && it++ < 6000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (goal(cur.x, cur.y)) {
        const path = [];
        let k = key(cur.x, cur.y);
        while (k !== key(sx, sy)) { path.unshift({ x: k % W, y: Math.floor(k / W) }); k = came.get(k); }
        return path;
      }
      if (cur.g >= maxLen) continue;
      for (const [dx, dy] of dirs) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!E.passable(L, nx, ny, ignore)) continue;
        if (dx && dy && (!E.passable(L, cur.x + dx, cur.y, ignore) || !E.passable(L, cur.x, cur.y + dy, ignore))) continue;
        const ng = cur.g + (dx && dy ? 1.01 : 1);
        const nk = key(nx, ny);
        if (gs.has(nk) && gs.get(nk) <= ng) continue;
        gs.set(nk, ng); came.set(nk, key(cur.x, cur.y));
        open.push({ x: nx, y: ny, g: ng, f: ng + h(nx, ny) * 1.001 });
      }
    }
    return null;
  };

  // линия видимости по клеткам (высокие объекты закрывают обзор)
  E.los = function (L, x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
    let x = x0, y = y0;
    while (!(x === x1 && y === y1)) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) break;
      if (L.sight[y * L.w + x]) return false;
    }
    return true;
  };
  E.dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  // ---------- кадры персонажа ----------
  E.dirFromDelta = function (dx, dy) {
    const s = iso(dx, dy);
    if (Math.abs(s.y) > Math.abs(s.x) * 0.9) return s.y > 0 ? DIR.S : DIR.N;
    return s.x > 0 ? DIR.E : DIR.W;
  };
  function frameFor(a, t) {
    const row = a.dir;
    const walkN = row === DIR.S || row === DIR.N ? 8 : 6;
    if (a.aimT > 0) {
      const r = a.dir === DIR.W ? DIR.W : DIR.E;
      return { row: r, col: 6 + (a.aimT > 0.15 ? 1 : 0) };
    }
    if (a.moving) return { row, col: Math.floor(a.walkPhase * walkN) % walkN };
    return { row, col: 0 };
  }

  // ---------- отрисовка ----------
  E.render = function (G, t) {
    const L = G.loc, ctx = E.ctx, dpr = E.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080604';
    ctx.fillRect(0, 0, E.canvas.width, E.canvas.height);
    if (!L) return;
    const vw = E.viewW(), vh = E.viewH();
    ctx.setTransform(dpr * E.zoom, 0, 0, dpr * E.zoom, dpr * (vw / 2 - E.cam.x * E.zoom), dpr * (vh / 2 - E.cam.y * E.zoom));
    ctx.imageSmoothingEnabled = true;

    ctx.drawImage(L.ground.canvas, -L.ground.ox, -L.ground.oy);

    // зона выхода
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    if (L.def.exits) {
      for (const r of L.def.exits) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
        if (x < 0 || y < 0 || x >= L.w || y >= L.h) continue;
        diamond(ctx, x, y, `rgba(110,255,110,${0.25 + 0.2 * pulse})`, `rgba(70,230,80,${0.16 + 0.1 * pulse})`);
      }
    }
    // выход с карты
    const p = G.player;
    if (E.mouse.tile && G.mode !== 'dialog') {
      const { x, y } = E.mouse.tile;
      if (x >= 0 && y >= 0 && x < L.w && y < L.h) {
        const exit = WORLD_API.isExit(L, x, y);
        let col = exit ? 'rgba(120,255,120,0.9)' : 'rgba(240,200,90,0.8)';
        if (!exit && L.blocked[y * L.w + x]) col = 'rgba(255,80,60,0.6)';
        diamond(ctx, x, y, col, exit ? 'rgba(120,255,120,0.15)' : null);
        if (G.combat && G.combat.isPlayerTurn() && G.ui.mode === 'move' && !L.blocked[y * L.w + x]) {
          const path = G.ui.previewPath;
          if (path) {
            ctx.fillStyle = 'rgba(255,220,120,0.55)';
            path.forEach((c, i) => {
              const cc = tileCenter(c.x, c.y);
              ctx.beginPath(); ctx.ellipse(cc.x, cc.y, 5, 2.5, 0, 0, Math.PI * 2);
              ctx.fillStyle = i < p.ap ? 'rgba(140,255,120,0.75)' : 'rgba(255,90,60,0.75)';
              ctx.fill();
            });
          }
        }
      }
    }

    // трупы — на земле
    for (const a of L.actors) if (a.dead) drawCorpse(ctx, a);

    // сортировка объектов и персонажей
    const objs = L.objects.filter(o => !o.hidden).slice().sort((a, b) => (a.x + a.fw + a.y + a.fh) - (b.x + b.fw + b.y + b.fh) || a.x - b.x);
    const actors = L.actors.filter(a => !a.dead && !a.gone).sort((a, b) => (a.rx + a.ry) - (b.rx + b.ry));
    const list = objs.map(o => ({ o }));
    for (const a of actors) {
      let pos = 0;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (it.o) { if (inFront(a, it.o)) pos = i + 1; }
        else if (it.a.rx + it.a.ry <= a.rx + a.ry) pos = i + 1;
      }
      list.splice(pos, 0, { a });
    }
    const hov = G.ui.hover;
    for (const it of list) {
      if (it.o) drawObject(ctx, G, it.o, hov && hov.obj === it.o);
      else drawActor(ctx, G, it.a, t, hov && hov.actor === it.a);
    }
    if (G.debug) for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (L.blocked[y * L.w + x]) diamond(ctx, x, y, 'rgba(255,0,0,.5)', L.sight[y * L.w + x] ? 'rgba(255,0,0,.25)' : 'rgba(255,255,0,.2)');

    // эффекты
    for (const fx of E.effects) fx.draw(ctx, t);
    // ночь: затемнение с кругами света у героя и фонарей
    const dark = !L.def.interior && G.darkness ? G.darkness() : 0;
    if (dark > 0.02) drawDarkness(ctx, G, L, dark, t);
    ctx.font = 'bold 14px Consolas, monospace';
    ctx.textAlign = 'center';
    for (const f of E.floaters) {
      const k = f.t / f.life;
      ctx.globalAlpha = Math.min(1, 2 - k * 2);
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, f.x + 1, f.y - k * 34 + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - k * 34);
    }
    ctx.globalAlpha = 1;

    // подпись зоны выхода
    if (L.def.exits) {
      ctx.font = 'bold 18px Consolas, monospace';
      ctx.textAlign = 'center';
      for (const r of L.def.exits) {
        const c = iso((r.x0 + r.x1 + 1) / 2, (r.y0 + r.y1 + 1) / 2);
        const label = `▼ ${r.label || 'ВЫХОД'} ▼`;
        const w = ctx.measureText(label).width + 16;
        ctx.fillStyle = 'rgba(5,20,5,0.75)';
        ctx.fillRect(c.x - w / 2, c.y - 44, w, 26);
        ctx.strokeStyle = `rgba(120,255,120,${0.6 + 0.4 * pulse})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(c.x - w / 2, c.y - 44, w, 26);
        ctx.fillStyle = '#8dff7a';
        ctx.fillText(label, c.x, c.y - 25);
      }
    }
    // значки заданий
    if (G.questMark) {
      ctx.font = 'bold 22px Consolas, monospace';
      ctx.textAlign = 'center';
      for (const a of actors) {
        const m = G.questMark(a);
        if (!m) continue;
        const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH - 100 + Math.sin(t * 4 + a.x) * 3;
        ctx.lineWidth = 4; ctx.strokeStyle = '#1a1206';
        ctx.strokeText(m, sx, sy);
        ctx.fillStyle = m === '?' ? '#8dff7a' : '#ffd040';
        ctx.fillText(m, sx, sy);
      }
    }
    // подпись объекта под курсором
    if (hov && hov.obj && (hov.obj.name)) {
      const o = hov.obj, r = E.objectRect(o);
      const done = o.interact && G.flags[`obj_${L.id}_${o.uid}_search`];
      const label = o.name + (o.container ? (o.lock ? ' · заперто' : '') : o.interact ? (o.interact.search && !done ? ' · обыскать' : ' · осмотреть') : '');
      ctx.font = '12px Consolas, monospace';
      ctx.textAlign = 'center';
      const w = ctx.measureText(label).width + 10;
      const ly = Math.max(r.y + 14, r.y + r.h * 0.25);
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(r.x + r.w / 2 - w / 2, ly - 13, w, 17);
      ctx.fillStyle = o.container || (o.interact && (o.interact.search || o.interact.check)) ? '#f0c060' : '#c8f5bd';
      ctx.fillText(label, r.x + r.w / 2, ly);
    }
    // стрелка-подсказка обучения
    const ta = window.TUT && TUT.arrow();
    if (ta) {
      let tx = null, ty = null;
      if (ta.npc) { const n = L.actors.find(a => a.tpl === ta.npc && !a.dead); if (n) { tx = (n.rx - n.ry) * HW; ty = (n.rx + n.ry) * HH + HH - 125; } }
      if (ta.exit && L.def.exits) { const r = L.def.exits[0]; const c = iso((r.x0 + r.x1 + 1) / 2, (r.y0 + r.y1 + 1) / 2); tx = c.x; ty = c.y - 70; }
      if (tx != null) {
        const b = Math.sin(t * 5) * 6;
        ctx.save(); ctx.translate(tx, ty + b);
        ctx.fillStyle = '#7dfc6a'; ctx.strokeStyle = '#0a2a08'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-11, -18); ctx.lineTo(11, -18); ctx.lineTo(11, -2); ctx.lineTo(20, -2); ctx.lineTo(0, 16); ctx.lineTo(-20, -2); ctx.lineTo(-11, -2); ctx.closePath();
        ctx.stroke(); ctx.fill(); ctx.restore();
      }
    }
    // подписи над NPC
    ctx.font = '12px Consolas, monospace';
    for (const a of actors) {
      if (a.isPlayer) continue;
      const show = (hov && hov.actor === a) || (G.combat && a.hostile) || a.isRemote;
      if (!show && !a.bubble) continue;
      const c = { x: a.rx * HW - a.ry * HW, y: (a.rx + a.ry) * HH };
      const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH + (a.model ? 50 - 25 * ((a.scale || 1) - 1) : 0);
      let label = a.name;
      if (G.combat && (a.hostile || a.isRemote)) label += `  ${Math.max(0, a.hp)}/${R.maxHP(a)}`;
      if (show) {
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        const w = ctx.measureText(label).width + 8;
        ctx.fillRect(sx - w / 2, sy - 104, w, 16);
        ctx.fillStyle = a.isRemote ? '#8fd0ff' : a.hostile ? '#ff6a4a' : '#9dff8a';
        ctx.fillText(label, sx, sy - 92);
      }
      if (a.bubble) {
        ctx.font = 'bold 13px Consolas, monospace';
        const w = ctx.measureText(a.bubble.text).width + 12;
        ctx.fillStyle = 'rgba(10,12,8,.85)';
        ctx.fillRect(sx - w / 2, sy - 128, w, 20);
        ctx.strokeStyle = a.bubble.color || '#f0b43c';
        ctx.strokeRect(sx - w / 2, sy - 128, w, 20);
        ctx.fillStyle = a.bubble.color || '#f0b43c';
        ctx.fillText(a.bubble.text, sx, sy - 113);
        ctx.font = '12px Consolas, monospace';
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const LIGHTS = { lamp_post: 170, mil_lamp: 190, floodlight: 260, tent_green_lit: 130, gas_station: 150, med_tent: 120, mil_med_tent: 120, booth: 110 };
  function drawDarkness(ctx, G, L, dark, t) {
    const W = E.canvas.width, H = E.canvas.height, dpr = E.dpr;
    if (!E.darkCv) E.darkCv = document.createElement('canvas');
    const dc = E.darkCv;
    if (dc.width !== W || dc.height !== H) { dc.width = W; dc.height = H; }
    const g = dc.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = `rgba(6,10,28,${dark})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    const hole = (wx, wy, r, k = 1) => {
      const s = E.worldToScreen(wx, wy), R = r * E.zoom * dpr;
      const gr = g.createRadialGradient(s.x * dpr, s.y * dpr, 0, s.x * dpr, s.y * dpr, R);
      gr.addColorStop(0, `rgba(0,0,0,${k})`); gr.addColorStop(0.55, `rgba(0,0,0,${k * 0.7})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(s.x * dpr, s.y * dpr, R, 0, Math.PI * 2); g.fill();
    };
    const p = G.player;
    const pc = tileCenter(p.rx, p.ry);
    hole(pc.x, pc.y - 30, 210, 0.95);
    const glow = [];
    for (const o of L.objects) {
      const r = LIGHTS[o.sprite];
      if (!r || o.hidden) continue;
      const rr = E.objectRect(o);
      const flick = 1 + Math.sin(t * 7 + o.uid) * 0.03;
      hole(rr.x + rr.w / 2, rr.y + rr.h * 0.75, r * flick, 1);
      glow.push([rr.x + rr.w / 2, rr.y + rr.h * 0.75, r * 0.6]);
    }
    g.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(dc, 0, 0);
    // тёплый свет фонарей
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, r] of glow) {
      const s = E.worldToScreen(x, y), R = r * E.zoom * dpr;
      const gr = ctx.createRadialGradient(s.x * dpr, s.y * dpr, 0, s.x * dpr, s.y * dpr, R);
      gr.addColorStop(0, `rgba(255,170,70,${0.12 * dark / 0.62})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s.x * dpr, s.y * dpr, R, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function inFront(a, o) {
    // персонаж перед объектом, если он южнее одной из передних граней
    return a.rx >= o.x + o.fw - 0.01 || a.ry >= o.y + o.fh - 0.01;
  }

  function diamond(ctx, x, y, stroke, fill) {
    const a = iso(x, y), b = iso(x + 1, y), c = iso(x + 1, y + 1), d = iso(x, y + 1);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
  }
  E.diamond = diamond;

  function drawObject(ctx, G, o, hovered) {
    const im = E.img[o.sprite];
    if (!im) return;
    const r = E.objectRect(o);
    let alpha = 1;
    // прозрачность, если игрок за объектом
    const p = G.player;
    if (o.fw * o.fh >= 4 && !inFront(p, o)) {
      const ps = { x: (p.rx - p.ry) * HW, y: (p.rx + p.ry) * HH };
      if (ps.x > r.x + 10 && ps.x < r.x + r.w - 10 && ps.y > r.y + 20 && ps.y - 60 < r.y + r.h && ps.y < r.y + r.h + 10) alpha = 0.45;
    }
    ctx.globalAlpha = alpha;
    if (hovered && (o.container || o.name)) {
      ctx.save();
      ctx.shadowColor = o.container ? 'rgba(255,220,100,0.95)' : 'rgba(160,255,140,0.6)';
      ctx.shadowBlur = 12;
      ctx.drawImage(im, r.x, r.y);
      ctx.restore();
    } else ctx.drawImage(im, r.x, r.y);
    ctx.globalAlpha = 1;
  }

  // 8 направлений по экранному вектору: ряды листа S, SE, E, NE, N, NW, W, SW
  E.dir8FromDelta = function (dx, dy) {
    const s = iso(dx, dy);
    const idx = ((Math.round(Math.atan2(s.y, s.x) / (Math.PI / 4)) % 8) + 8) % 8; // 0=E,1=SE,2=S,3=SW,4=W,5=NW,6=N,7=NE
    return [2, 1, 0, 7, 6, 5, 4, 3][idx];
  };
  const DIR4_TO_8 = [0, 2, 4, 6];
  function drawModel(ctx, G, a, t, hovered, M) {
    const k = a.scale || 1;
    const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 2, 12 * k, 5 * k, 0, 0, Math.PI * 2); ctx.fill();
    if (hovered || (G.combat && G.combat.current === a)) {
      ctx.strokeStyle = a.hostile ? '#ff5a3c' : '#9dff8a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy - 2, 15 * k, 7 * k, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const row = a.dir8 != null ? a.dir8 : DIR4_TO_8[a.dir || 0];
    const n = M.frames[row] || 1;
    let col = 0;
    if (a.aimT > 0) col = n - 1;                                  // укус — последний кадр (пасть открыта)
    else if (a.moving) col = Math.floor(a.walkPhase * 1.6 * Math.max(1, n - 2)) % Math.max(1, n - 2);
    let ox = 0, oy = 0;
    if (a.shakeT > 0) { ox += (Math.random() - 0.5) * 5; oy += (Math.random() - 0.5) * 2; }
    if (a.hitFlash > 0) ctx.filter = 'brightness(1.7) sepia(1) hue-rotate(-40deg) saturate(4)';
    ctx.drawImage(M.canvas, col * M.fw, row * M.fh, M.fw, M.fh, sx - M.ax * k + ox, sy - M.ay * k + oy, M.fw * k, M.fh * k);
    ctx.filter = 'none';
  }

  function drawActor(ctx, G, a, t, hovered) {
    if (a.model && E.models[a.model]) { drawModel(ctx, G, a, t, hovered, E.models[a.model]); return; }
    const sheet = E.sheets[a.tint || 'player'];
    const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH;
    // тень
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 2, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
    if (a.isPlayer) {
      ctx.strokeStyle = G.sneaking ? 'rgba(125,252,106,0.35)' : 'rgba(125,252,106,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(sx, sy - 2, 18, 8, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // кольцо выделения
    if (hovered || (G.combat && G.combat.current === a)) {
      ctx.strokeStyle = a.isPlayer ? '#7dfc6a' : a.hostile ? '#ff5a3c' : '#9dff8a';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy - 2, 20, 9, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const f = frameFor(a, t);
    if (a.isPlayer && G.sneaking) ctx.globalAlpha = 0.82;
    if (a.hitFlash > 0) ctx.filter = 'brightness(1.7) sepia(1) hue-rotate(-40deg) saturate(4)';
    // отдача и встряска от попадания
    let ox = 0, oy = 0;
    if (a.recoilT > 0) { const k = a.recoilT / 0.14; ox += (a.recoilX || 0) * 5 * k; oy += (a.recoilY || 0) * 3 * k; }
    if (a.shakeT > 0) { ox += (Math.random() - 0.5) * 6 * a.shakeT / 0.25; oy += (Math.random() - 0.5) * 3 * a.shakeT / 0.25; }
    ctx.drawImage(sheet, f.col * FR.w, f.row * FR.h, FR.w, FR.h, sx - FR.ax + ox, sy - FR.ay + oy + (a.isPlayer && G.sneaking ? 4 : 0), FR.w, FR.h);
    if (a.isCompanion) {
      ctx.strokeStyle = 'rgba(143,208,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(sx, sy - 2, 18, 8, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }

  function drawCorpse(ctx, a) {
    if (a.model && E.models[a.model]) {
      const M = E.models[a.model], k = a.scale || 1;
      const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH;
      if (a.deathAt == null) a.deathAt = performance.now();
      const p = Math.min(1, (performance.now() - a.deathAt) / 350);
      ctx.fillStyle = 'rgba(70,90,10,0.55)';
      ctx.beginPath(); ctx.ellipse(sx, sy - 4, 14 * k * p + 2, 5 * k * p + 1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(sx, sy - 6);
      ctx.scale(1, 1 - 2 * p);  // переворачивается кверху лапами
      ctx.filter = 'brightness(0.6) saturate(0.6)';
      ctx.drawImage(M.canvas, 0, 2 * M.fh, M.fw, M.fh, -M.ax * k, -M.ay * k + 8, M.fw * k, M.fh * k);
      ctx.restore(); ctx.filter = 'none';
      return;
    }
    const sheet = E.sheets[a.tint || 'player'];
    const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH;
    // анимация падения: тело заваливается, лужа крови растекается
    if (a.deathAt == null) a.deathAt = performance.now();
    const k = Math.min(1, (performance.now() - a.deathAt) / 450);
    const ease = 1 - Math.pow(1 - k, 3);
    const pool = Math.min(1, (performance.now() - a.deathAt) / 1600);
    ctx.fillStyle = 'rgba(90,10,6,0.65)';
    ctx.beginPath(); ctx.ellipse(sx + 4, sy - 6, 8 + 18 * pool, 3 + 7 * pool, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(sx, sy - 10 * ease);
    ctx.rotate((-Math.PI / 2 + 0.25) * ease);
    ctx.filter = 'brightness(0.6) saturate(0.6)';
    ctx.drawImage(sheet, 0, a.dir === 1 ? FR.h : 0, FR.w, FR.h, -FR.ax + 4 * ease, -FR.ay + 22 * ease, FR.w, FR.h);
    ctx.restore();
    ctx.filter = 'none';
  }

  // ---------- эффекты ----------
  E.floater = function (tx, ty, text, color = '#fff') {
    const c = tileCenter(tx, ty);
    E.floaters.push({ x: c.x, y: c.y - 70, text, color, t: 0, life: 1.4 });
  };
  E.tracer = function (from, to, hit) {
    const a = tileCenter(from.x, from.y), b = tileCenter(to.x, to.y);
    const ox = (Math.random() - 0.5) * (hit ? 4 : 40), oy = (Math.random() - 0.5) * (hit ? 4 : 30);
    E.effects.push({ t: 0, life: 0.18, draw(ctx) {
      const k = this.t / this.life;
      ctx.strokeStyle = `rgba(255,230,140,${1 - k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - 52); ctx.lineTo(b.x + ox, b.y - 44 + oy); ctx.stroke();
      ctx.fillStyle = `rgba(255,200,80,${1 - k})`;
      ctx.beginPath(); ctx.arc(a.x + (b.x > a.x ? 20 : -20), a.y - 54, 6 * (1 - k) + 2, 0, Math.PI * 2); ctx.fill();
    } });
  };
  // вспышка выстрела
  E.muzzle = function (from, to) {
    const a = tileCenter(from.x, from.y), b = tileCenter(to.x, to.y);
    const dx = b.x > a.x ? 1 : -1;
    E.effects.push({ t: 0, life: 0.09, draw(ctx) {
      const k = 1 - this.t / this.life;
      const x = a.x + dx * 24, y = a.y - 54;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, 26 * k + 6);
      gr.addColorStop(0, `rgba(255,255,220,${0.95 * k})`); gr.addColorStop(0.4, `rgba(255,190,60,${0.7 * k})`); gr.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 26 * k + 6, 0, Math.PI * 2); ctx.fill();
    } });
  };
  // брызги крови
  E.blood = function (to, n = 8) {
    const b = tileCenter(to.x, to.y);
    const ps = Array.from({ length: n }, () => ({ x: b.x + (Math.random() - 0.5) * 10, y: b.y - 45 - Math.random() * 15, vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 80, r: 1.5 + Math.random() * 2 }));
    E.effects.push({ t: 0, life: 0.55, draw(ctx) {
      const k = this.t;
      ctx.fillStyle = `rgba(150,14,8,${1 - this.t / this.life})`;
      for (const p of ps) { ctx.beginPath(); ctx.arc(p.x + p.vx * k, p.y + p.vy * k + 260 * k * k, p.r, 0, Math.PI * 2); ctx.fill(); }
    } });
  };
  E.swing = function (from, to) {
    const b = tileCenter(to.x, to.y);
    E.effects.push({ t: 0, life: 0.25, draw(ctx) {
      const k = this.t / this.life;
      ctx.strokeStyle = `rgba(255,255,255,${0.8 - k * 0.8})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y - 45, 20, -1.5 + k * 2, -0.5 + k * 2); ctx.stroke();
    } });
  };
  E.updateFx = function (dt) {
    for (const f of E.floaters) f.t += dt;
    E.floaters = E.floaters.filter(f => f.t < f.life);
    for (const f of E.effects) f.t += dt;
    E.effects = E.effects.filter(f => f.t < f.life);
  };

  return E;
})();
