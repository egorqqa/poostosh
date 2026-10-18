// Векторные иконки интерфейса, оружия и предметов
(function () {
  const S = (vb, body, extra = '') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" ${extra}>${body}</svg>`;
  const st = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

  // ---- быстрые действия ----
  const ACTION = {
    walk: S('0 0 32 32', `<g ${st}><path d="M11 4c3 0 4 3 4 6s-1 5-1 8h-6c0-3-1-5-1-8s1-6 4-6z"/><path d="M8 21h6v3c0 2-1 3-3 3s-3-1-3-3z"/><path d="M22 8c2 0 3 2 3 5s-1 4-1 6h-5c0-2-1-3-1-6s2-5 4-5z" opacity=".6"/></g>`),
    attack: S('0 0 32 32', `<g ${st}><circle cx="16" cy="16" r="9"/><circle cx="16" cy="16" r="3"/><path d="M16 2v7M16 23v7M2 16h7M23 16h7"/></g>`),
    steal: S('0 0 32 32', `<g ${st}><path d="M9 28v-9l-3-5c-1-2 1-3 2-2l3 4V6c0-2 3-2 3 0v8-10c0-2 3-2 3 0v10-8c0-2 3-2 3 0v9-6c0-2 3-2 3 0v11c0 4-2 8-5 8z"/></g>`),
    lockpick: S('0 0 32 32', `<g ${st}><rect x="6" y="14" width="16" height="13" rx="2"/><path d="M10 14v-4a4 4 0 0 1 8 0v4"/><path d="M14 19v4"/><path d="M22 6l6-2M24 10l4 0" opacity=".7"/></g>`),
    sneak: S('0 0 32 32', `<g ${st}><circle cx="18" cy="7" r="3"/><path d="M17 11l-5 6 5 3-2 8M12 17l-5 2M17 13l6 3 3-2"/><path d="M4 28h24" opacity=".5"/></g>`),
    look: S('0 0 32 32', `<g ${st}><path d="M2 16s5-9 14-9 14 9 14 9-5 9-14 9S2 16 2 16z"/><circle cx="16" cy="16" r="4"/></g>`),
    heal: S('0 0 32 32', `<g ${st}><rect x="4" y="9" width="24" height="18" rx="2"/><path d="M12 9V6h8v3M16 13v10M11 18h10"/></g>`),
    inventory: S('0 0 32 32', `<g ${st}><path d="M8 11c0-4 3-7 8-7s8 3 8 7v15H8z"/><path d="M8 15h16M12 19h8v4h-8z"/></g>`),
    character: S('0 0 32 32', `<g ${st}><circle cx="16" cy="10" r="5"/><path d="M6 28c0-6 4-10 10-10s10 4 10 10"/></g>`),
    map: S('0 0 32 32', `<g ${st}><path d="M3 7l8-3 10 3 8-3v21l-8 3-10-3-8 3z"/><path d="M11 4v21M21 7v21"/></g>`),
    talk: S('0 0 32 32', `<g ${st}><path d="M4 6h24v15H14l-6 6v-6H4z"/><path d="M9 12h14M9 16h9"/></g>`),
    endturn: S('0 0 32 32', `<g ${st}><path d="M9 4h14M9 28h14M10 4c0 7 12 7 12 12s-12 5-12 12M22 4c0 7-12 7-12 12s12 5 12 12"/></g>`),
    reload: S('0 0 32 32', `<g ${st}><path d="M26 16a10 10 0 1 1-3-7"/><path d="M26 4v6h-6"/></g>`),
    save: S('0 0 32 32', `<g ${st}><path d="M5 5h18l4 4v18H5z"/><path d="M10 5v7h11V5M10 27v-8h12v8"/></g>`),
  };

  // ---- оружие (вид сбоку) ----
  const W = {
    fists: S('0 0 120 60', `<path d="M30 22h46c6 0 9 4 9 9v8c0 6-4 10-10 10H40c-6 0-10-3-12-8l-4-10c-1-5 1-9 6-9z" fill="#b98d64" stroke="#3a2614" stroke-width="2"/><path d="M45 22v10M58 22v10M71 23v10" stroke="#6b4a2c" stroke-width="2"/><path d="M28 34h-14" stroke="#5a5a4a" stroke-width="8"/>`),
    knife: S('0 0 140 40', `<path d="M8 20c0-5 4-8 9-8h38v16H17c-5 0-9-3-9-8z" fill="#3b2a1a" stroke="#120a04" stroke-width="2"/><path d="M14 14h4v12h-4zM26 14h4v12h-4zM38 14h4v12h-4z" fill="#7a6040"/><rect x="55" y="9" width="6" height="22" fill="#6a6a62" stroke="#222" stroke-width="2"/><path d="M61 13h52l20 8-20 6H61z" fill="#c9cbc4" stroke="#333" stroke-width="2"/><path d="M63 21h62" stroke="#8e918a" stroke-width="2"/>`),
    pipe: S('0 0 140 40', `<rect x="6" y="14" width="126" height="13" rx="3" fill="#7a4a2a" stroke="#2a160a" stroke-width="2"/><rect x="6" y="12" width="26" height="17" rx="2" fill="#3a3a32" stroke="#111" stroke-width="2"/><path d="M50 16l6 9M78 15l4 10M104 16l5 9" stroke="#a8622e" stroke-width="3"/>`),
    pistol: S('0 0 140 80', `<path d="M20 18h96l6 4v14H62l-4 4H40l-4 30H14l8-34-6-4z" fill="#3d3f3c" stroke="#111" stroke-width="2"/><path d="M24 24h90" stroke="#5c5f5a" stroke-width="3"/><path d="M40 40c-1 10 10 10 16 0" fill="none" stroke="#222" stroke-width="3"/><path d="M18 46l4-6h12l-4 28H16z" fill="#5a3a20" stroke="#111" stroke-width="2"/><rect x="116" y="20" width="10" height="8" fill="#2a2c2a"/>`),
    shotgun: S('0 0 200 60', `<path d="M4 34l40-10h30v14H52l-30 14H8z" fill="#6b3f1f" stroke="#1d0f05" stroke-width="2"/><rect x="72" y="20" width="44" height="18" rx="2" fill="#3a3c3a" stroke="#111" stroke-width="2"/><rect x="114" y="18" width="80" height="9" rx="2" fill="#4c4f4b" stroke="#111" stroke-width="2"/><rect x="114" y="27" width="80" height="9" rx="2" fill="#40433f" stroke="#111" stroke-width="2"/><path d="M84 38c0 8 10 8 14 0" fill="none" stroke="#222" stroke-width="3"/>`),
    rifle: S('0 0 240 60', `<path d="M4 30l48-8h40v12H66l-40 16H8z" fill="#7a4a24" stroke="#1d0f05" stroke-width="2"/><path d="M90 22h70v12H90z" fill="#3a3c3a" stroke="#111" stroke-width="2"/><path d="M110 24h126v6H110z" fill="#4c4f4b" stroke="#111" stroke-width="2"/><path d="M160 30h52v6h-52z" fill="#6b3f1f" stroke="#1d0f05" stroke-width="2"/><rect x="104" y="12" width="44" height="8" rx="3" fill="#222" stroke="#000"/><path d="M98 34c0 8 10 8 14 0" fill="none" stroke="#222" stroke-width="3"/>`),
    ak: S('0 0 240 80', `<path d="M4 30l44-6h34v12H62l-36 14H8z" fill="#7a3f1c" stroke="#1d0f05" stroke-width="2"/><path d="M80 22h82v14H80z" fill="#373936" stroke="#111" stroke-width="2"/><path d="M110 36c6 16 10 30 4 40h-14c4-12 0-24-6-38z" fill="#2d2f2c" stroke="#111" stroke-width="2"/><path d="M160 24h70v6h-70z" fill="#4c4f4b" stroke="#111" stroke-width="2"/><path d="M160 30h40v8h-40z" fill="#7a3f1c" stroke="#1d0f05" stroke-width="2"/><path d="M86 36l-4 18h10l4-18" fill="#2a2a28" stroke="#111" stroke-width="2"/><rect x="226" y="18" width="4" height="6" fill="#222"/>`),
  };

  // ---- предметы ----
  const I = {
    medkit: S('0 0 60 44', `<rect x="6" y="10" width="48" height="30" rx="4" fill="#d9d4c6" stroke="#3a3428" stroke-width="2"/><rect x="22" y="4" width="16" height="8" rx="2" fill="none" stroke="#3a3428" stroke-width="2"/><path d="M30 16v18M21 25h18" stroke="#c0281c" stroke-width="6"/>`),
    bandage: S('0 0 60 44', `<ellipse cx="22" cy="24" rx="14" ry="14" fill="#e8e2d0" stroke="#5a5240" stroke-width="2"/><circle cx="22" cy="24" r="5" fill="#bdb49a"/><path d="M34 22h22v8H34" fill="#e8e2d0" stroke="#5a5240" stroke-width="2"/>`),
    water: S('0 0 60 44', `<path d="M24 4h12v6l4 4v26H20V14l4-4z" fill="#5d93b5" stroke="#1f3a4a" stroke-width="2"/><rect x="24" y="2" width="12" height="5" fill="#2a4a5a"/><rect x="22" y="20" width="16" height="10" fill="#c8d8e0"/>`),
    food: S('0 0 60 44', `<rect x="14" y="10" width="32" height="28" rx="3" fill="#9a9a90" stroke="#333" stroke-width="2"/><ellipse cx="30" cy="10" rx="16" ry="4" fill="#bdbdb4" stroke="#333" stroke-width="2"/><rect x="14" y="18" width="32" height="12" fill="#b0402a"/>`),
    lockpicks: S('0 0 60 44', `<path d="M6 30h34l6-6M6 36h40l8-4M8 24h28l4-8" fill="none" stroke="#a9aba3" stroke-width="3" stroke-linecap="round"/><rect x="4" y="22" width="10" height="16" rx="2" fill="#5a3a20"/>`),
    ammo: S('0 0 60 44', `<rect x="8" y="14" width="44" height="26" rx="2" fill="#5d6a3a" stroke="#222" stroke-width="2"/><path d="M14 14V8l3-4 3 4v6M24 14V8l3-4 3 4v6M34 14V8l3-4 3 4v6M44 14V8l3-4 3 4v6" fill="#c9a24a" stroke="#4a3a10" stroke-width="1.5"/>`),
    shells: S('0 0 60 44', `<rect x="10" y="8" width="12" height="30" rx="2" fill="#b0281c" stroke="#222" stroke-width="2"/><rect x="25" y="8" width="12" height="30" rx="2" fill="#b0281c" stroke="#222" stroke-width="2"/><rect x="40" y="8" width="12" height="30" rx="2" fill="#b0281c" stroke="#222" stroke-width="2"/><path d="M10 32h12M25 32h12M40 32h12" stroke="#d4a43a" stroke-width="6"/>`),
    jacket: S('0 0 60 52', `<path d="M18 4l12 6 12-6 14 8-4 14-6-2v26H14V24l-6 2-4-14z" fill="#6b4626" stroke="#22140a" stroke-width="2"/><path d="M30 10v38" stroke="#22140a" stroke-width="2"/>`),
    armor: S('0 0 60 52', `<path d="M16 4h10l4 4 4-4h10l10 8-4 12v26H10V24L6 12z" fill="#4e5a3a" stroke="#1a1f10" stroke-width="2"/><rect x="16" y="20" width="28" height="22" rx="3" fill="#3c4630" stroke="#1a1f10" stroke-width="2"/><path d="M16 30h28" stroke="#1a1f10"/>`),
    meds: S('0 0 60 44', `<rect x="6" y="10" width="48" height="28" rx="2" fill="#7a6a3a" stroke="#2a2410" stroke-width="2"/><rect x="20" y="16" width="20" height="16" fill="#e8e2d0"/><path d="M30 18v12M24 24h12" stroke="#c0281c" stroke-width="4"/>`),
    junk: S('0 0 60 44', `<circle cx="20" cy="26" r="10" fill="none" stroke="#9a8a6a" stroke-width="4"/><path d="M32 12l18 22M36 34l14-16" stroke="#7a7a72" stroke-width="5" stroke-linecap="round"/>`),
    caps: S('0 0 60 44', `<circle cx="30" cy="22" r="14" fill="#c9a24a" stroke="#4a3a10" stroke-width="2"/><circle cx="30" cy="22" r="8" fill="#8a6a2a"/>`),
    token: S('0 0 60 44', `<path d="M30 4l20 8v12c0 8-10 14-20 18C20 38 10 32 10 24V12z" fill="#8a2a1a" stroke="#2a0a04" stroke-width="2"/><path d="M22 18l16 10M38 18L22 28" stroke="#e8c070" stroke-width="3"/>`),
    holotape: S('0 0 60 44', `<rect x="8" y="8" width="44" height="28" rx="3" fill="#3a3a3a" stroke="#111" stroke-width="2"/><rect x="14" y="14" width="32" height="10" fill="#7dfc6a" opacity=".6"/>`),
  };

  I.grenade = S('0 0 60 44', `<ellipse cx="28" cy="26" rx="13" ry="15" fill="#4e5a34" stroke="#1a1f10" stroke-width="2"/><path d="M18 20h20M17 27h22M18 34h20" stroke="#2c3420" stroke-width="2"/><rect x="24" y="6" width="9" height="7" fill="#8a8a80" stroke="#222" stroke-width="2"/><path d="M33 8c8 0 12 4 12 12" fill="none" stroke="#a9aba3" stroke-width="3"/><circle cx="44" cy="22" r="3" fill="none" stroke="#a9aba3" stroke-width="2"/>`);
  I.molotov = S('0 0 60 44', `<path d="M24 14h12v6c6 3 8 7 8 12v8H16v-8c0-5 2-9 8-12z" fill="#6a4a1a" stroke="#2a1a06" stroke-width="2"/><rect x="25" y="8" width="10" height="7" fill="#3a5a2a" stroke="#1a2a10" stroke-width="2"/><path d="M28 9c-2-4 2-6 1-8 4 2 6 5 3 8" fill="#ff9a20" stroke="#c04a00" stroke-width="1"/><rect x="18" y="26" width="24" height="7" fill="#d8c8a0" opacity=".7"/>`);
  I.tknife = S('0 0 60 44', `<path d="M6 30L40 12l12 2-10 8L12 36z" fill="#c9cbc3" stroke="#333" stroke-width="2"/><path d="M6 30l6 6-4 2-6-4z" fill="#5a3a20" stroke="#222" stroke-width="2"/><path d="M14 30l26-14" stroke="#8a8c84" stroke-width="2"/>`);
  window.ICONS = { ACTION, WEAPON: W, ITEM: I };
})();
