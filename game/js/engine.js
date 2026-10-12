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
    // лёгкая виньетка
    L.ground = { canvas: c, ox, oy };
  };

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
        const label = '▼ ВЫХОД ▼';
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
    // подписи над NPC
    ctx.font = '12px Consolas, monospace';
    for (const a of actors) {
      if (a.isPlayer) continue;
      const show = (hov && hov.actor === a) || (G.combat && a.hostile) || a.isRemote;
      if (!show && !a.bubble) continue;
      const c = { x: a.rx * HW - a.ry * HW, y: (a.rx + a.ry) * HH };
      const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH;
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

  function drawActor(ctx, G, a, t, hovered) {
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
    if (a.hitFlash > 0) ctx.filter = 'brightness(2) saturate(2)';
    ctx.drawImage(sheet, f.col * FR.w, f.row * FR.h, FR.w, FR.h, sx - FR.ax, sy - FR.ay + (a.isPlayer && G.sneaking ? 4 : 0), FR.w, FR.h);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }

  function drawCorpse(ctx, a) {
    const sheet = E.sheets[a.tint || 'player'];
    const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH;
    ctx.fillStyle = 'rgba(90,10,6,0.65)';
    ctx.beginPath(); ctx.ellipse(sx + 4, sy - 6, 26, 10, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(sx, sy - 10);
    ctx.rotate(-Math.PI / 2 + 0.25);
    ctx.filter = 'brightness(0.6) saturate(0.6)';
    ctx.drawImage(sheet, 0, a.dir === 1 ? FR.h : 0, FR.w, FR.h, -FR.ax + 4, -FR.ay + 22, FR.w, FR.h);
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
