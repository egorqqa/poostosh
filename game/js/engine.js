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
      // модели героя с оружием в руках (пистолет, ружьё, автомат)
      E.guns = {};
      for (const [key, man] of Object.entries(window.ASSET_MANIFEST)) {
        if (!key.startsWith('gun_') || !E.img[key]) continue;
        const im = E.img[key];
        const o = document.createElement('canvas'); o.width = im.width; o.height = im.height;
        const ox = o.getContext('2d'); ox.shadowColor = 'rgba(0,0,0,0.85)'; ox.shadowBlur = 3; ox.drawImage(im, 0, 0);
        E.guns[key.slice(4)] = { canvas: o, fw: man.fw, fh: man.fh, ax: man.ax, ay: man.ay, walk: man.walk, aim: man.aim, fire: man.fire };
      }
      // внешность героев: hero_soldier_<герой> (без оружия), hero_pl_<ствол>_<герой> (с оружием)
      E.heroSheets = {};
      const outline = (im, filter) => {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const cx = c.getContext('2d'); cx.filter = filter || 'none'; cx.drawImage(im, 0, 0);
        const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
        const ox = o.getContext('2d'); ox.shadowColor = 'rgba(0,0,0,0.85)'; ox.shadowBlur = 3; ox.drawImage(c, 0, 0);
        return o;
      };
      for (const key of Object.keys(window.ASSET_MANIFEST)) {
        if (!key.startsWith('hero_') || !E.img[key]) continue;
        const m = key.match(/^hero_(soldier|pl_(pistol|rifle|ak))_(\w+)$/);
        if (!m) continue;
        if (m[1] === 'soldier') E.heroSheets[m[3]] = outline(E.img[key], 'brightness(1.12) contrast(1.06)');
        else if (E.guns[m[2]]) E.guns[m[2] + '@' + m[3]] = { ...E.guns[m[2]], canvas: outline(E.img[key]) };
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
    if (L.def.desert) drawDesert(g, L, ox, oy, r);
    if (L.def.river) drawRiver(g, L, ox, oy, r);
    if (L.def.interior) drawInterior(g, L, ox, oy, r);
    L.ground = { canvas: c, ox, oy };
  };

  // песчаная пустыня: рябь дюн, дорога вдоль карты, следы заноса, гора за северным краем
  function drawDesert(g, L, ox, oy, r) {
    const P = (x, y) => { const p = iso(x, y); return { x: ox + p.x, y: oy + p.y }; };
    const poly = pts => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); };
    // песок внутри карты
    g.save(); poly([P(0, 0), P(L.w, 0), P(L.w, L.h), P(0, L.h)]); g.clip();
    const a = P(0, 0), c = P(L.w, L.h);
    const gr = g.createLinearGradient(a.x, a.y, c.x, c.y);
    gr.addColorStop(0, '#b8925a'); gr.addColorStop(0.5, '#c29c63'); gr.addColorStop(1, '#a9844f');
    g.fillStyle = gr; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    // пятна светлого и тёмного песка
    for (let i = 0; i < 90; i++) {
      const p = P(r() * L.w, r() * L.h), rr = 30 + r() * 90;
      const sp = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
      sp.addColorStop(0, r() < 0.5 ? 'rgba(235,205,150,0.22)' : 'rgba(120,85,45,0.18)'); sp.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sp; g.beginPath(); g.ellipse(p.x, p.y, rr, rr * 0.5, 0, 0, Math.PI * 2); g.fill();
    }
    // рябь дюн
    g.lineWidth = 1.4;
    for (let i = 0; i < 520; i++) {
      const p = P(r() * L.w, r() * L.h), w = 14 + r() * 26;
      g.strokeStyle = r() < 0.5 ? 'rgba(255,235,190,0.28)' : 'rgba(110,78,40,0.22)';
      g.beginPath(); g.moveTo(p.x - w, p.y); g.quadraticCurveTo(p.x, p.y - 4, p.x + w, p.y + 1); g.stroke();
    }
    // песчинки
    for (let i = 0; i < 6000; i++) { const p = P(r() * L.w, r() * L.h); g.fillStyle = r() < 0.5 ? 'rgba(90,60,30,0.25)' : 'rgba(255,240,200,0.25)'; g.fillRect(p.x, p.y, 1.5, 1.5); }
    // дорога: асфальт, обочины, трещины, разметка
    const rd = L.def.road;
    if (rd) {
      poly([P(rd.x0 - 0.3, 0), P(rd.x1 + 1.3, 0), P(rd.x1 + 1.3, L.h), P(rd.x0 - 0.3, L.h)]); g.fillStyle = 'rgba(70,58,40,0.45)'; g.fill();
      poly([P(rd.x0, 0), P(rd.x1 + 1, 0), P(rd.x1 + 1, L.h), P(rd.x0, L.h)]); g.fillStyle = '#4a463f'; g.fill();
      for (let i = 0; i < 900; i++) { const p = P(rd.x0 + r() * (rd.x1 - rd.x0 + 1), r() * L.h); g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(180,170,150,0.18)'; g.fillRect(p.x, p.y, 2, 1.5); }
      // нанесённый песок поверх асфальта
      for (let i = 0; i < 40; i++) {
        const p = P(rd.x0 + r() * (rd.x1 - rd.x0 + 1), r() * L.h), rr = 20 + r() * 40;
        const sp = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr); sp.addColorStop(0, 'rgba(190,150,95,0.55)'); sp.addColorStop(1, 'rgba(190,150,95,0)');
        g.fillStyle = sp; g.beginPath(); g.ellipse(p.x, p.y, rr, rr * 0.45, 0, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(20,18,14,0.55)'; g.lineWidth = 1;
      for (let i = 0; i < 26; i++) { let p = P(rd.x0 + r() * (rd.x1 - rd.x0 + 1), r() * L.h); g.beginPath(); g.moveTo(p.x, p.y); for (let k = 0; k < 4; k++) { p = { x: p.x + (r() - 0.5) * 22, y: p.y + (r() - 0.5) * 12 }; g.lineTo(p.x, p.y); } g.stroke(); }
      // осевая разметка (стёртая)
      const mid = (rd.x0 + rd.x1 + 1) / 2;
      g.strokeStyle = 'rgba(225,215,170,0.55)'; g.lineWidth = 3;
      for (let y = 0.5; y < L.h; y += 2) { if (r() < 0.3) continue; const s = P(mid, y), e = P(mid, y + 0.9); g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(e.x, e.y); g.stroke(); }
    }
    // следы заноса от дороги к машине
    const sk = L.def.skid;
    if (sk) for (const off of [-0.35, 0.35]) {
      g.strokeStyle = 'rgba(40,28,16,0.45)'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); sk.forEach(([x, y], i) => { const p = P(x + off, y - off); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }); g.stroke();
    }
    g.restore();
    // гора: склон в северных рядах и скальная стена за краем карты
    const mt = L.def.mountain;
    if (mt) {
      const n = mt.rows;
      const H = x => 150 + Math.sin(x * 0.55) * 40 + Math.sin(x * 1.7 + 1) * 18 + Math.sin(x * 0.21 + 2) * 60;
      // стена
      const top = [];
      for (let x = -2; x <= L.w + 2; x += 0.5) { const p = P(x, 0); top.push({ x: p.x, y: p.y - H(x) }); }
      g.beginPath(); g.moveTo(P(-2, 0).x, P(-2, 0).y);
      for (const q of top) g.lineTo(q.x, q.y);
      g.lineTo(P(L.w + 2, 0).x, P(L.w + 2, 0).y); g.closePath();
      const wg = g.createLinearGradient(0, P(0, 0).y - 260, 0, P(L.w, 0).y);
      wg.addColorStop(0, '#5a4430'); wg.addColorStop(0.6, '#7a5c3c'); wg.addColorStop(1, '#8e6c46');
      g.fillStyle = wg; g.fill();
      // пласты и трещины
      g.save(); g.clip();
      for (let i = 0; i < 70; i++) {
        const x = r() * L.w, p = P(x, 0), y = p.y - r() * H(x);
        g.strokeStyle = r() < 0.5 ? 'rgba(40,28,18,0.45)' : 'rgba(200,160,110,0.25)'; g.lineWidth = 1 + r() * 2;
        g.beginPath(); g.moveTo(p.x - 30 - r() * 40, y + 10); g.lineTo(p.x + 30 + r() * 40, y - 6 + r() * 6); g.stroke();
      }
      for (let i = 0; i < 40; i++) {
        const x = r() * L.w, p = P(x, 0), y = p.y - r() * H(x) * 0.9;
        g.strokeStyle = 'rgba(30,20,12,0.5)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(p.x, y); g.lineTo(p.x + (r() - 0.5) * 16, y + 18 + r() * 30); g.stroke();
      }
      g.restore();
      // гребень освещён
      g.strokeStyle = 'rgba(230,190,130,0.5)'; g.lineWidth = 2; g.beginPath(); top.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.stroke();
      // осыпь у подножия
      poly([P(0, 0), P(L.w, 0), P(L.w, n), P(0, n)]);
      const sg = g.createLinearGradient(P(0, 0).x, P(0, 0).y, P(0, n).x, P(0, n).y);
      sg.addColorStop(0, 'rgba(110,82,52,0.95)'); sg.addColorStop(1, 'rgba(160,125,80,0)');
      g.fillStyle = sg; g.fill();
      for (let i = 0; i < 260; i++) { const p = P(r() * L.w, r() * n); g.fillStyle = r() < 0.5 ? 'rgba(60,44,30,0.6)' : 'rgba(170,135,95,0.6)'; g.beginPath(); g.ellipse(p.x, p.y, 2 + r() * 5, 1.5 + r() * 3, 0, 0, Math.PI * 2); g.fill(); }
    }
  }

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
    let shx = 0, shy = 0;
    if (E.shakeT > 0) { const k = E.shakeT / (E.shakeDur || 1); shx = (Math.random() - 0.5) * 2 * E.shakeAmp * k; shy = (Math.random() - 0.5) * 2 * E.shakeAmp * k; }
    ctx.setTransform(dpr * E.zoom, 0, 0, dpr * E.zoom, dpr * (vw / 2 - E.cam.x * E.zoom + shx), dpr * (vh / 2 - E.cam.y * E.zoom + shy));
    ctx.imageSmoothingEnabled = true;

    ctx.drawImage(L.ground.canvas, -L.ground.ox, -L.ground.oy);
    // следы на земле (копоть взрывов, гарь)
    const nowMs = performance.now();
    E.decals = E.decals.filter(d => d.until > nowMs);
    for (const d of E.decals) if (d.loc === L.id) d.draw(ctx, nowMs);

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

    // бросок: дуга и зона поражения
    if (G.ui && G.ui.mode === 'throw' && G.ui.throwItem && E.mouse.tile && G.mode !== 'dialog') drawThrowAim(ctx, G, L, p, E.mouse.tile, t);

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

  // какая модель с оружием у игрока: по значку оружия в руках
  const GUN_OF = { pistol: 'pistol', shotgun: 'rifle', rifle: 'rifle', ak: 'ak' };
  const ARMED = ['column', 'bastion', 'remnant', 'caravan']; // солдаты, которые носят оружие в руках
  E.gunKey = function (a) {
    if (!a || !a.weapon || !E.guns) return null;
    const tpl = DATA.NPCS[a.tpl];
    const hero = a.hero || a.heroModel;
    if (!(a.isPlayer || a.isRemote || hero || (tpl && ARMED.includes(tpl.faction) && !a.model))) return null;
    const w = DATA.ITEMS[a.weapon];
    if (!w || w.melee || !E.guns[GUN_OF[w.icon]]) return null;
    if (hero && E.guns[GUN_OF[w.icon] + '@' + hero]) return GUN_OF[w.icon] + '@' + hero;
    return GUN_OF[w.icon] + (a.isPlayer || a.isRemote ? '' : ':' + (a.tint || 'guard'));
  };
  // лист модели; для NPC — перекрашенная копия под их окраску (кэшируется)
  function gunSheet(key) {
    if (!key) return null;
    if (E.guns[key]) return E.guns[key];
    const [base, tint] = key.split(':'), B = E.guns[base];
    if (!B) return null;
    const c = document.createElement('canvas'); c.width = B.canvas.width; c.height = B.canvas.height;
    const cx = c.getContext('2d'); cx.filter = DATA.TINTS[tint] || 'none'; cx.drawImage(B.canvas, 0, 0);
    return (E.guns[key] = { ...B, canvas: c });
  }
  E.gunModel = a => gunSheet(E.gunKey(a));
  function gunFrame(G, a, M) {
    const row = a.dir8 != null ? a.dir8 : DIR4_TO_8[a.dir || 0];
    if (a.aimT > 0) return { row, col: a.aimT > 0.3 ? M.fire : M.aim };   // вспышка, затем удержание прицела
    if (a.reloadT > 0) return { row, col: 0 };                              // оружие опущено — меняем магазин
    if (a.moving) return { row, col: Math.floor(a.walkPhase * M.walk * (M.walk < 4 ? 2 : 1)) % M.walk };
    if (G.combat && G.combat.list && G.combat.list.includes(a)) return { row, col: M.aim }; // в бою — оружие наготове
    return { row, col: 0 };
  }

  function drawActor(ctx, G, a, t, hovered) {
    if (a.model && E.models[a.model]) { drawModel(ctx, G, a, t, hovered, E.models[a.model]); drawBurn(ctx, a, t); return; }
    if (a.tpl === 'konst' && E.img.npc_konst) { drawKonst(ctx, G, a, t, hovered); return; }
    const GM = E.gunModel(a);
    const hs = E.heroSheets && E.heroSheets[a.hero || a.heroModel];
    const sheet = hs || E.sheets[a.tint || 'player'];
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
    const f = GM ? gunFrame(G, a, GM) : frameFor(a, t);
    if (a.isPlayer && G.sneaking) ctx.globalAlpha = 0.82;
    if (a.hitFlash > 0) ctx.filter = 'brightness(1.7) sepia(1) hue-rotate(-40deg) saturate(4)';
    // отдача и встряска от попадания
    let ox = 0, oy = 0;
    if (a.recoilT > 0) { const k = a.recoilT / 0.14; ox += (a.recoilX || 0) * 5 * k; oy += (a.recoilY || 0) * 3 * k; }
    if (a.shakeT > 0) { ox += (Math.random() - 0.5) * 6 * a.shakeT / 0.25; oy += (Math.random() - 0.5) * 3 * a.shakeT / 0.25; }
    if (a.reloadT > 0) oy += Math.sin((1 - a.reloadT / 0.8) * Math.PI) * 3; // приседает, перезаряжая
    if (a.knockT > 0) { const k = a.knockT / 0.22; ox += (a.knockX || 0) * 7 * k; oy += (a.knockY || 0) * 4 * k; } // отбрасывает попаданием
    const sneakY = a.isPlayer && G.sneaking ? 4 : 0;
    if (GM) ctx.drawImage(GM.canvas, f.col * GM.fw, f.row * GM.fh, GM.fw, GM.fh, sx - GM.ax + ox, sy - GM.ay + oy + sneakY, GM.fw, GM.fh);
    else ctx.drawImage(sheet, f.col * FR.w, f.row * FR.h, FR.w, FR.h, sx - FR.ax + ox, sy - FR.ay + oy + sneakY, FR.w, FR.h);
    if (a.reloadT > 0) drawReload(ctx, a, sx, sy);
    drawBurn(ctx, a, t);
    if (a.isCompanion) {
      ctx.strokeStyle = 'rgba(143,208,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(sx, sy - 2, 18, 8, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
  }

  // горящий персонаж: языки пламени по фигуре
  function drawBurn(ctx, a, t) {
    if (!(a.burn > 0) || a.dead) return;
    const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH;
    ctx.save(); ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const ph = t * 9 + i * 1.7, x = sx + Math.sin(i * 2.3) * 10, y = sy - 10 - i * 9 - Math.abs(Math.sin(ph)) * 6;
      const r = 7 + Math.sin(ph) * 2;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,240,170,0.9)'); gr.addColorStop(0.5, 'rgba(255,140,30,0.6)'); gr.addColorStop(1, 'rgba(200,40,0,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, y, r * 0.7, r * 1.3, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // оружейник Константин: стоит у верстака, при заказе работает — стучит, сыплет искры, проверяет ствол
  const KONST = { idle: 6, left: 0, work: 2, aim: 10 };
  function drawKonst(ctx, G, a, t, hovered) {
    const im = E.img.npc_konst, M = window.ASSET_MANIFEST.npc_konst;
    const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 2, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
    if (hovered) { ctx.strokeStyle = '#9dff8a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, sy - 2, 20, 9, 0, 0, Math.PI * 2); ctx.stroke(); }
    const bench = tileCenter(a.x, a.y - 1);
    let fr = KONST.idle, oy = 0;
    const p = G.player, near = p && E.dist(a, p) <= 4;
    // сам по себе тоже иногда возится с железом
    const ambient = !near && (t % 9) < 1.4;
    if (a.workT > 0 || ambient) {
      const left = a.workT > 0 ? a.workT : 1.4 - (t % 9);
      if (a.workT > 0 && left < 0.9) fr = KONST.aim;              // смотрит в прицел готового ствола
      else {
        fr = KONST.work;
        const ph = (t * 2.9) % 1;                                  // удары молотком
        oy = ph < 0.2 ? ph * 10 : 0;
        const strike = Math.floor(t * 2.9);
        if (strike !== a._strike && ph < 0.2) {
          a._strike = strike;
          E.sparks(bench.x + 4, bench.y - 18, a.workT > 0 ? 14 : 6);
          if (a.workT > 0 || E.dist(a, p) <= 9) SND.at('clang', a.x, a.y, {});
        }
      }
    } else if (near) {
      const s = iso(p.x - a.x, p.y - a.y);
      fr = s.x < -4 ? KONST.left : KONST.idle;
    }
    if (a.hitFlash > 0) ctx.filter = 'brightness(1.7) sepia(1) hue-rotate(-40deg) saturate(4)';
    const breathe = Math.sin(t * 2) * 0.6;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 3;
    ctx.drawImage(im, fr * M.fw, 0, M.fw, M.fh, sx - M.ax, sy - M.ay + oy + breathe, M.fw, M.fh);
    ctx.restore(); ctx.filter = 'none';
  }

  // дуга броска и зона поражения под курсором
  function drawThrowAim(ctx, G, L, p, tile, t) {
    const it = DATA.ITEMS[G.ui.throwItem];
    if (!it) return;
    const rng = R.throwRange(p, it), d = E.dist(p, tile), ok = d <= rng && d > 0 && E.los(L, p.x, p.y, tile.x, tile.y);
    const r = it.radius || 0;
    for (let y = tile.y - r; y <= tile.y + r; y++) for (let x = tile.x - r; x <= tile.x + r; x++) {
      if (x < 0 || y < 0 || x >= L.w || y >= L.h) continue;
      diamond(ctx, x, y, ok ? 'rgba(255,150,40,0.9)' : 'rgba(255,60,40,0.6)', ok ? `rgba(255,120,30,${0.18 + 0.1 * Math.sin(t * 6)})` : 'rgba(255,40,40,0.12)');
    }
    const a = tileCenter(p.x, p.y), b = tileCenter(tile.x, tile.y);
    const h = 30 + 8 * d;
    ctx.save(); ctx.setLineDash([5, 6]); ctx.lineDashOffset = -t * 20;
    ctx.strokeStyle = ok ? 'rgba(255,220,120,0.85)' : 'rgba(255,90,60,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y - 50);
    ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y - 50, b.y) - h * 2, b.x, b.y - 4);
    ctx.stroke(); ctx.restore();
    ctx.font = 'bold 12px Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(b.x - 34, b.y + 8, 68, 15);
    ctx.fillStyle = ok ? '#ffd080' : '#ff7a5a'; ctx.fillText(ok ? `${it.ap} ОД` : d > rng ? 'далеко' : 'нет броска', b.x, b.y + 19);
  }

  // перезарядка: пустой магазин падает, новый вставляется
  function drawReload(ctx, a, sx, sy) {
    const k = 1 - a.reloadT / 0.8, side = [0, 1, 2, 3].includes(a.dir8 != null ? a.dir8 : 0) ? 1 : -1;
    ctx.save(); ctx.filter = 'none'; ctx.globalAlpha = 1;
    if (k < 0.55) { // старый магазин падает и отскакивает
      const t = k / 0.55, y = sy - 46 + 40 * t * t;
      ctx.fillStyle = '#2b2b26'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.translate(sx + side * (8 + 10 * t), Math.min(y, sy - 4)); ctx.rotate(side * t * 2);
      ctx.fillRect(-2, -5, 4, 9); ctx.strokeRect(-2, -5, 4, 9);
    } else { // новый магазин поднимается к оружию
      const t = (k - 0.55) / 0.45;
      ctx.fillStyle = '#4a4a3c'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.translate(sx + side * 6, sy - 30 - 14 * t);
      ctx.fillRect(-2, -5, 4, 9); ctx.strokeRect(-2, -5, 4, 9);
    }
    ctx.restore();
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
    const GM = gunSheet(a.corpseGun || (a.isPlayer || a.isRemote ? E.gunKey(a) : null));
    const sheet = (E.heroSheets && E.heroSheets[a.hero || a.heroModel]) || E.sheets[a.tint || 'player'];
    const sx = (a.rx - a.ry) * HW, sy = (a.rx + a.ry) * HH + HH;
    if (GM) { drawGunCorpse(ctx, a, GM, sx, sy); return; }
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

  // смерть модели с оружием: отшатывается от попадания, оседает и падает навзничь, оружие выпадает
  function drawGunCorpse(ctx, a, M, sx, sy) {
    if (a.deathAt == null) a.deathAt = performance.now();
    const ms = performance.now() - a.deathAt;
    const row = a.dir8 != null ? a.dir8 : DIR4_TO_8[a.dir || 0];
    const back = [0, 1, 7].includes(row) ? -1 : 1;           // падает от стрелка: в сторону, противоположную взгляду
    const k1 = Math.min(1, ms / 160), k2 = Math.max(0, Math.min(1, (ms - 160) / 420));
    const ease = 1 - Math.pow(1 - k2, 3);
    const pool = Math.min(1, ms / 1800);
    ctx.fillStyle = 'rgba(90,10,6,0.65)';
    ctx.beginPath(); ctx.ellipse(sx + back * 6, sy - 6, 8 + 20 * pool, 3 + 8 * pool, 0.1, 0, Math.PI * 2); ctx.fill();
    // выпавшее оружие лежит рядом
    if (k2 > 0.6) {
      ctx.save(); ctx.translate(sx - back * 18, sy - 4); ctx.rotate(-0.3 * back);
      ctx.fillStyle = '#26241f'; ctx.fillRect(-11, -2, 22, 4); ctx.fillStyle = '#5a3a1e'; ctx.fillRect(-11, -2, 7, 4);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(sx + back * 5 * k1, sy - 8 * ease);
    ctx.rotate(back * (Math.PI / 2 - 0.2) * ease);
    ctx.filter = `brightness(${1 - 0.4 * ease}) saturate(${1 - 0.4 * ease})`;
    const col = k2 > 0 ? 0 : M.aim;                           // в момент попадания ещё держит прицел
    ctx.drawImage(M.canvas, col * M.fw, row * M.fh, M.fw, M.fh, -M.ax, -M.ay + 18 * ease, M.fw, M.fh);
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
    if (E.gunModel(from)) return; // у моделей с оружием вспышка нарисована в кадре выстрела
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
  // ---------- броски, взрывы, попадания ----------
  E.decals = [];
  E.shake = function (dur, amp) { if (E.shakeT > 0 && amp < E.shakeAmp) return; E.shakeT = dur; E.shakeDur = dur; E.shakeAmp = amp; };
  // полёт брошенного предмета по дуге; dur — в секундах
  E.throwArc = function (from, to, item, dur) {
    const a = tileCenter(from.x, from.y), b = tileCenter(to.x, to.y);
    const d = Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
    const H = 30 + 8 * d, spin = item === 'tknife' ? 22 : 9;
    E.effects.push({ t: 0, life: dur, draw(ctx) {
      const k = Math.min(1, this.t / this.life);
      const x = a.x + (b.x - a.x) * k, gy = a.y + (b.y - a.y) * k;
      const y = (a.y - 50) + ((b.y - 4) - (a.y - 50)) * k - 4 * H * k * (1 - k);
      // тень на земле
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, gy, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(x, y); ctx.rotate(this.t * spin);
      if (item === 'grenade') {
        ctx.fillStyle = '#4e5a34'; ctx.strokeStyle = '#141a0a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8a8a80'; ctx.fillRect(-2, -8, 4, 3);
      } else if (item === 'molotov') {
        ctx.fillStyle = '#6a4a1a'; ctx.strokeStyle = '#1a0e02'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-3.5, -4, 7, 11, 2) : ctx.rect(-3.5, -4, 7, 11); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3a5a2a'; ctx.fillRect(-1.5, -8, 3, 4);
        const f = 4 + Math.random() * 3;
        const gr = ctx.createRadialGradient(0, -10, 0, 0, -10, f);
        gr.addColorStop(0, 'rgba(255,240,160,1)'); gr.addColorStop(1, 'rgba(255,90,0,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, -10, f, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = '#d9dbd3'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(6, 0); ctx.stroke();
        ctx.strokeStyle = '#5a3a20'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-3, 0); ctx.stroke();
      }
      ctx.restore();
      // огненный след бутылки
      if (item === 'molotov' && Math.random() < 0.6) E.effects.push({ t: 0, life: 0.3, x, y: y - 6, draw(c) { const q = 1 - this.t / this.life; c.fillStyle = `rgba(255,${120 + 80 * q | 0},20,${0.6 * q})`; c.beginPath(); c.arc(this.x, this.y - 8 * (1 - q), 2.5 * q + 0.5, 0, Math.PI * 2); c.fill(); } });
    } });
  };
  function scorch(L, c, rad, color) {
    const blobs = Array.from({ length: 7 }, () => ({ x: (Math.random() - 0.5) * rad * 1.2, y: (Math.random() - 0.5) * rad * 0.6, r: rad * (0.35 + Math.random() * 0.4) }));
    const until = performance.now() + 30000;
    E.decals.push({ loc: L ? L.id : null, until, draw(ctx, now) {
      const fade = Math.min(1, (until - now) / 5000);
      for (const b of blobs) {
        const gr = ctx.createRadialGradient(c.x + b.x, c.y + b.y, 0, c.x + b.x, c.y + b.y, b.r);
        gr.addColorStop(0, color.replace('A', 0.75 * fade)); gr.addColorStop(1, color.replace('A', 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(c.x + b.x, c.y + b.y, b.r, b.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      }
    } });
  }
  // осколочный взрыв: вспышка, огненный шар, ударная волна, обломки, дым, копоть, тряска
  E.explosion = function (L, tx, ty, r = 1) {
    const c = tileCenter(tx, ty), R0 = 26 + 30 * r;
    scorch(L, c, R0 * 0.9, 'rgba(20,14,8,A)');
    E.effects.push({ t: 0, life: 0.14, draw(ctx) {
      const k = this.t / this.life;
      const gr = ctx.createRadialGradient(c.x, c.y - 14, 0, c.x, c.y - 14, R0 * 2.2);
      gr.addColorStop(0, `rgba(255,255,230,${1 - k})`); gr.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(c.x, c.y - 14, R0 * 2.2, 0, Math.PI * 2); ctx.fill();
    } });
    const balls = Array.from({ length: 7 }, () => ({ x: (Math.random() - 0.5) * R0, y: -Math.random() * R0 * 0.8, s: 0.6 + Math.random() * 0.6, d: Math.random() * 0.12 }));
    E.effects.push({ t: 0, life: 0.75, draw(ctx) {
      for (const b of balls) {
        const k = Math.max(0, Math.min(1, (this.t - b.d) / (this.life - b.d)));
        if (k <= 0) continue;
        const rr = R0 * 0.75 * b.s * (0.4 + k), x = c.x + b.x * (0.5 + k), y = c.y - 10 + b.y * (0.5 + k) - 18 * k;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, rr);
        gr.addColorStop(0, `rgba(255,250,200,${(1 - k) * 0.95})`);
        gr.addColorStop(0.35, `rgba(255,160,40,${(1 - k) * 0.9})`);
        gr.addColorStop(0.75, `rgba(150,40,10,${(1 - k) * 0.6})`);
        gr.addColorStop(1, 'rgba(40,20,10,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
      }
    } });
    E.effects.push({ t: 0, life: 0.45, draw(ctx) {
      const k = this.t / this.life;
      ctx.strokeStyle = `rgba(255,230,180,${0.7 * (1 - k)})`; ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, 10 + R0 * 2 * k, (10 + R0 * 2 * k) * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    } });
    const deb = Array.from({ length: 22 }, () => ({ vx: (Math.random() - 0.5) * 320, vy: -120 - Math.random() * 260, s: 1.5 + Math.random() * 2.5, c: Math.random() < 0.5 ? '#3a2a1a' : '#6a5a40' }));
    E.effects.push({ t: 0, life: 0.95, draw(ctx) {
      const k = this.t;
      for (const q of deb) {
        const y = c.y - 10 + q.vy * k + 520 * k * k;
        if (y > c.y + 14) continue;
        ctx.fillStyle = q.c; ctx.fillRect(c.x + q.vx * k, y, q.s, q.s);
      }
    } });
    const puffs = Array.from({ length: 9 }, () => ({ x: (Math.random() - 0.5) * R0 * 1.2, s: 0.6 + Math.random() * 0.7, d: 0.1 + Math.random() * 0.35, v: 20 + Math.random() * 30 }));
    E.effects.push({ t: 0, life: 2.6, draw(ctx) {
      for (const q of puffs) {
        const k = Math.max(0, Math.min(1, (this.t - q.d) / (this.life - q.d)));
        if (k <= 0) continue;
        const rr = R0 * 0.5 * q.s * (0.6 + k * 1.4), x = c.x + q.x * (1 + k), y = c.y - 20 - q.v * this.t * 1.4;
        ctx.fillStyle = `rgba(70,64,58,${0.5 * (1 - k)})`; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
      }
    } });
    E.shake(0.45, 9);
  };
  // разбитая бутылка: всплеск огня и горящая земля в радиусе
  E.fireArea = function (L, tx, ty, r = 1, dur = 3.2) {
    const c = tileCenter(tx, ty);
    scorch(L, c, 30 + 30 * r, 'rgba(30,18,6,A)');
    const tiles = [];
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) tiles.push({ c: tileCenter(x, y), ph: Math.random() * 6 });
    E.effects.push({ t: 0, life: dur, draw(ctx) {
      const life = this.t < 0.25 ? this.t / 0.25 : Math.min(1, (this.life - this.t) / 1);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const tl of tiles) for (let i = 0; i < 3; i++) {
        const ph = this.t * 8 + tl.ph + i * 2.1, x = tl.c.x + (i - 1) * 9 + Math.sin(ph) * 2, h = (12 + 8 * Math.abs(Math.sin(ph * 0.7))) * life;
        const gr = ctx.createRadialGradient(x, tl.c.y - h * 0.5, 0, x, tl.c.y - h * 0.5, h);
        gr.addColorStop(0, `rgba(255,230,150,${0.8 * life})`); gr.addColorStop(0.5, `rgba(255,120,20,${0.5 * life})`); gr.addColorStop(1, 'rgba(160,30,0,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, tl.c.y - h * 0.5, h * 0.45, h, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      if (Math.random() < 0.5) { const tl = tiles[Math.floor(Math.random() * tiles.length)]; E.sparks(tl.c.x, tl.c.y - 10, 1, true); }
    } });
    E.effects.push({ t: 0, life: 0.3, draw(ctx) {
      const k = this.t / this.life;
      const gr = ctx.createRadialGradient(c.x, c.y - 10, 0, c.x, c.y - 10, 70 * (0.5 + k));
      gr.addColorStop(0, `rgba(255,220,120,${0.9 * (1 - k)})`); gr.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(c.x, c.y - 10, 70 * (0.5 + k), 0, Math.PI * 2); ctx.fill();
    } });
    E.shake(0.2, 4);
  };
  // искры (верстак, рикошет, угли); ember — медленные угольки вверх
  E.sparks = function (x, y, n = 8, ember = false) {
    const ps = Array.from({ length: n }, () => ({ vx: (Math.random() - 0.5) * (ember ? 30 : 180), vy: ember ? -30 - Math.random() * 40 : -60 - Math.random() * 140 }));
    E.effects.push({ t: 0, life: ember ? 0.9 : 0.45, draw(ctx) {
      const k = this.t / this.life;
      ctx.strokeStyle = `rgba(255,${200 - 80 * k | 0},80,${1 - k})`; ctx.lineWidth = ember ? 2 : 1.5;
      for (const q of ps) {
        const px = x + q.vx * this.t, py = y + q.vy * this.t + (ember ? 0 : 420 * this.t * this.t);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - q.vx * 0.02, py - (q.vy + (ember ? 0 : 840 * this.t)) * 0.02); ctx.stroke();
      }
    } });
  };
  // попадание пули: искры и пыль у точки попадания, отброс цели
  E.impact = function (att, def, crit) {
    const c = tileCenter(def.x, def.y), a = tileCenter(att.x, att.y);
    const dx = c.x - a.x, dy = c.y - a.y, l = Math.hypot(dx, dy) || 1;
    def.knockX = dx / l; def.knockY = dy / l; def.knockT = 0.22;
    const hx = c.x - dx / l * 6, hy = c.y - 44;
    E.sparks(hx, hy, crit ? 12 : 6);
    E.effects.push({ t: 0, life: 0.12, draw(ctx) {
      const k = 1 - this.t / this.life;
      ctx.fillStyle = `rgba(255,250,220,${0.9 * k})`; ctx.beginPath(); ctx.arc(hx, hy, (crit ? 9 : 5) * k + 1, 0, Math.PI * 2); ctx.fill();
    } });
  };
  // промах: фонтанчик пыли рядом с целью
  E.dust = function (tx, ty) {
    const c = tileCenter(tx, ty), ox = (Math.random() - 0.5) * 40, oy = (Math.random() - 0.5) * 16;
    const ps = Array.from({ length: 5 }, () => ({ vx: (Math.random() - 0.5) * 50, vy: -20 - Math.random() * 50, r: 2 + Math.random() * 3 }));
    E.effects.push({ t: 0, life: 0.6, draw(ctx) {
      const k = this.t / this.life;
      ctx.fillStyle = `rgba(150,130,100,${0.6 * (1 - k)})`;
      for (const q of ps) { ctx.beginPath(); ctx.arc(c.x + ox + q.vx * this.t, c.y + oy + q.vy * this.t, q.r * (1 + k), 0, Math.PI * 2); ctx.fill(); }
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
    if (E.shakeT > 0) E.shakeT -= dt;
    E.effects = E.effects.filter(f => f.t < f.life);
  };

  return E;
})();
