// Мини-карта локации: выход, NPC, враги, игроки; клик — идти туда
window.MINI = (function () {
  const M = { visible: true, cache: null };
  try { M.visible = localStorage.getItem('opt_minimap') !== '0'; } catch (e) { /* */ }
  const W = 220, H = 124;
  let cv, ctx, scale = 1, ox = 0, oy = 0;

  function geom(L) {
    scale = Math.min((W - 8) / (L.w + L.h), (H - 8) * 2 / (L.w + L.h));
    ox = W / 2 + (L.h - L.w) * scale / 2;
    oy = (H - (L.w + L.h) * scale / 2) / 2;
  }
  const pt = (x, y) => ({ x: ox + (x - y) * scale, y: oy + (x + y) * scale / 2 });

  function buildStatic(L) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    geom(L);
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const p = pt(x, y);
      const blocked = L.blocked[y * L.w + x];
      g.fillStyle = WORLD_API.isExit(L, x, y) ? '#3fbf4a' : blocked ? (L.sight[y * L.w + x] ? '#0c0a06' : '#2a2316') : '#5a4c36';
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + scale, p.y + scale / 2); g.lineTo(p.x, p.y + scale); g.lineTo(p.x - scale, p.y + scale / 2); g.closePath(); g.fill();
    }
    M.cache = { id: L.id + (L.seed || ''), canvas: c };
  }

  M.init = function () {
    cv = document.getElementById('minimap');
    ctx = cv.getContext('2d');
    cv.width = W; cv.height = H;
    cv.addEventListener('mousedown', e => {
      e.stopPropagation();
      if (!window.G || G.scene !== 'local' || !G.loc || G.mode === 'dialog') return;
      const r = cv.getBoundingClientRect();
      const mx = (e.clientX - r.left) * W / r.width, my = (e.clientY - r.top) * H / r.height;
      const a = (mx - ox) / scale, b = (my - oy) * 2 / scale; // a = x - y, b = x + y
      const x = Math.floor((a + b) / 2), y = Math.floor((b - a) / 2);
      if (x < 0 || y < 0 || x >= G.loc.w || y >= G.loc.h) return;
      if (G.combat) { G.hint('В бою — клик по земле'); return; }
      const t = G.loc.blocked[y * G.loc.w + x] ? WORLD_API.freeTile(G.loc, x, y, G.player) : { x, y };
      if (t) WORLD_API.walkPlayer(G, t.x, t.y);
    });
    setInterval(M.draw, 200);
  };
  M.toggle = function () {
    M.visible = !M.visible;
    try { localStorage.setItem('opt_minimap', M.visible ? '1' : '0'); } catch (e) { /* */ }
    M.draw();
  };

  M.draw = function () {
    if (!cv) return;
    const show = M.visible && window.G && G.scene === 'local' && G.loc;
    cv.classList.toggle('hidden', !show);
    if (!show) return;
    const L = G.loc;
    if (!M.cache || M.cache.id !== L.id + (L.seed || '')) buildStatic(L);
    geom(L);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(M.cache.canvas, 0, 0);
    const dot = (x, y, r, col, ring) => {
      const p = pt(x + 0.5, y + 0.5);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 1; ctx.stroke(); }
    };
    const p = G.player;
    for (const a of L.actors) {
      if (a.isPlayer || a.gone) continue;
      if (a.dead) { dot(a.x, a.y, 1.5, '#555'); continue; }
      if (a.isRemote) { dot(a.x, a.y, 2.6, '#8fd0ff', '#000'); continue; }
      const mark = G.questMark && G.questMark(a);
      if (a.hostile) {
        const known = a.alerted || G.combat || ENG.dist(a, p) <= 18;
        if (known) dot(a.x, a.y, 2.4, '#ff4a2c', '#000');
      } else dot(a.x, a.y, mark ? 3 : 2, mark ? '#ffd040' : '#8ccf6a', '#000');
    }
    // экран: примерная рамка видимой области
    const tl = ENG.fromIso(...Object.values(ENG.screenToWorld(0, 0)));
    const br = ENG.fromIso(...Object.values(ENG.screenToWorld(ENG.viewW(), ENG.viewH())));
    const tr = ENG.fromIso(...Object.values(ENG.screenToWorld(ENG.viewW(), 0)));
    const bl = ENG.fromIso(...Object.values(ENG.screenToWorld(0, ENG.viewH())));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath();
    [tl, tr, br, bl].forEach((c, i) => { const q = pt(c.x, c.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.closePath(); ctx.stroke();
    dot(p.x, p.y, 3.2, '#ffffff', '#1a8a1a');
  };
  return M;
})();
