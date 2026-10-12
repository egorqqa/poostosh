// Сетевое взаимодействие игроков: обмен предметами и отряд
window.SOC = (function () {
  const S = { party: {}, trade: null, partyState: {} };
  const ITEMS = DATA.ITEMS;
  const send = (pid, o) => NET.event(pid, o);
  const nameOf = pid => (NET.players.find(p => p.id === pid) || {}).name || S.party[pid] || ('Игрок ' + pid);

  // ---------- меню при клике по игроку ----------
  S.playerMenu = function (G, a) {
    const pid = a.pid;
    const inParty = !!S.party[pid];
    const opts = [
      { t: 'Предложить обмен', act: () => { S.requestTrade(pid); WORLD_API.endDialog(G); }, end: false },
      inParty ? { t: 'Исключить из отряда', act: () => { S.leaveParty(pid); WORLD_API.endDialog(G); } }
        : { t: 'Пригласить в отряд', act: () => { send(pid, { kind: 'party_inv' }); G.log(`Приглашение в отряд отправлено: ${a.name}.`, 'sys'); WORLD_API.endDialog(G); } },
      { t: 'Отойти', end: true },
    ];
    G.mode = 'dialog';
    G.dialog = { npc: a, dlg: { nodes: { main: { text: `${a.name}, уровень ${a.level || 1}. ОЗ ${Math.max(0, a.hp)}/${a.baseHP || '?'}.${inParty ? ' В вашем отряде.' : ''}`, opts } } }, seen: {} };
    WORLD_API.dialogGo(G, 'main');
  };

  // ---------- обмен ----------
  S.requestTrade = function (pid) {
    if (S.trade) { G.hint('Вы уже в обмене'); return; }
    if (G.combat) { G.hint('Не во время боя'); return; }
    send(pid, { kind: 'trade_req' });
    G.log(`Предложение обмена отправлено: ${nameOf(pid)}.`, 'sys');
  };

  function prompt(title, text, onYes, onNo) {
    UI.openModal('prompt', `<div class="modal" style="width:min(440px,94vw)"><h2>${title}</h2>
      <div class="screen" style="margin-bottom:10px">${text}</div>
      <div class="cols" style="justify-content:flex-end"><button id="pr-no">Отказаться</button><button class="primary" id="pr-yes">Принять</button></div></div>`, root => {
      root.querySelector('#pr-yes').onclick = () => { UI.closeModal(); onYes(); };
      root.querySelector('#pr-no').onclick = () => { UI.closeModal(); onNo && onNo(); };
    });
  }

  const offerTotal = o => Object.values(o.items).reduce((a, b) => a + b, 0) + (o.caps ? 1 : 0);
  const sig = (a, b) => JSON.stringify([a, b]);
  function sendOffer() {
    const T = S.trade;
    T.readyMe = false; T.readyThem = false;
    send(T.pid, { kind: 'trade_offer', offer: T.mine });
    draw();
  }

  function openTrade(pid) {
    S.trade = { pid, name: nameOf(pid), mine: { items: {}, caps: 0 }, theirs: { items: {}, caps: 0 }, readyMe: false, readyThem: false };
    UI.openModal('p2p', `<div class="modal" style="width:min(900px,96vw);height:min(560px,100%)">
      <h2>Обмен с игроком: ${S.trade.name} <button class="close" id="tr-x">✕</button></h2>
      <div class="cols" style="flex:1;min-height:0">
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-height:0"><div class="warn">Ваш инвентарь (клик — предложить)</div><div class="screen" id="tr-inv" style="flex:1"></div></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-height:0"><div class="warn">Вы отдаёте (клик — убрать)</div><div class="screen" id="tr-mine" style="flex:1"></div>
          <div>Крышки: <input type="number" id="tr-caps" min="0" value="0" style="width:90px;font-family:var(--font);background:#050a05;color:var(--green);border:1px solid var(--green-dim);padding:3px"></div></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-height:0"><div class="warn">Вы получаете</div><div class="screen" id="tr-theirs" style="flex:1"></div></div>
      </div>
      <div class="cols" style="margin-top:8px;justify-content:space-between;align-items:center"><span id="tr-st" class="muted"></span>
        <span><button id="tr-cancel">Отменить</button> <button class="primary" id="tr-ok">Готов к обмену</button></span></div></div>`, root => {
      root.querySelector('#tr-x').onclick = cancel;
      root.querySelector('#tr-cancel').onclick = cancel;
      root.querySelector('#tr-ok').onclick = () => {
        const T = S.trade; if (!T) return;
        if (!offerTotal(T.mine) && !offerTotal(T.theirs)) { G.hint('Обмен пуст'); return; }
        T.readyMe = true;
        send(T.pid, { kind: 'trade_ready', sig: sig(T.mine, T.theirs) });
        tryFinish(); draw();
      };
      root.querySelector('#tr-caps').oninput = e => {
        const T = S.trade; if (!T) return;
        T.mine.caps = Math.max(0, Math.min(G.player.caps, Math.floor(+e.target.value || 0)));
        sendOffer();
      };
      root.addEventListener('click', e => {
        const T = S.trade; if (!T) return;
        const add = e.target.closest('[data-add]'), rem = e.target.closest('[data-rem]');
        if (add) {
          const id = add.dataset.add, have = R.count(G.player, id), off = T.mine.items[id] || 0;
          const step = ITEMS[id].type === 'ammo' ? Math.min(10, have - off) : 1;
          if (have - off <= 0 || ITEMS[id].type === 'quest') return;
          T.mine.items[id] = off + step; sendOffer();
        }
        if (rem) {
          const id = rem.dataset.rem;
          T.mine.items[id] = Math.max(0, (T.mine.items[id] || 0) - (ITEMS[id].type === 'ammo' ? 10 : 1));
          if (!T.mine.items[id]) delete T.mine.items[id];
          sendOffer();
        }
      });
      draw();
    });
  }

  const row = (id, n, attr) => `<div class="item" ${attr}><div class="ico">${UI.itemIcon(id)}</div><div><div class="nm">${ITEMS[id].name}</div></div><div class="qty">×${n}</div></div>`;
  function draw() {
    const T = S.trade;
    const root = document.getElementById('modal-root');
    if (!T || !root.querySelector('#tr-inv')) return;
    const p = G.player;
    root.querySelector('#tr-inv').innerHTML = p.inv.filter(s => ITEMS[s.id].type !== 'quest' && s.n - (T.mine.items[s.id] || 0) > 0)
      .map(s => row(s.id, s.n - (T.mine.items[s.id] || 0), `data-add="${s.id}"`)).join('') || '<div class="muted">Пусто</div>';
    root.querySelector('#tr-mine').innerHTML = Object.entries(T.mine.items).map(([id, n]) => row(id, n, `data-rem="${id}"`)).join('') + (T.mine.caps ? `<div class="warn">+ ${T.mine.caps} крышек</div>` : '') || '<div class="muted">Ничего</div>';
    root.querySelector('#tr-theirs').innerHTML = Object.entries(T.theirs.items).map(([id, n]) => row(id, n, '')).join('') + (T.theirs.caps ? `<div class="warn">+ ${T.theirs.caps} крышек</div>` : '') || '<div class="muted">Ничего</div>';
    root.querySelector('#tr-st').innerHTML = `Вы: ${T.readyMe ? '<span class="good">готовы</span>' : 'не готовы'} · ${T.name}: ${T.readyThem ? '<span class="good">готов</span>' : 'не готов'}. Обмен произойдёт, когда оба нажмут «Готов».`;
  }

  function tryFinish() {
    const T = S.trade;
    if (!T || !T.readyMe || !T.readyThem || T.theirSig !== sig(T.theirs, T.mine)) return;
    const p = G.player;
    // проверяем, что всё предложенное ещё есть
    for (const [id, n] of Object.entries(T.mine.items)) if (R.count(p, id) < n) { G.log('Обмен сорван: предметов уже нет.', 'bad'); cancel(); return; }
    if (p.caps < T.mine.caps) { G.log('Обмен сорван: не хватает крышек.', 'bad'); cancel(); return; }
    for (const [id, n] of Object.entries(T.mine.items)) R.removeItem(p, id, n);
    for (const [id, n] of Object.entries(T.theirs.items)) R.addItem(p, id, n);
    p.caps += T.theirs.caps - T.mine.caps;
    G.log(`Обмен с игроком ${T.name} завершён.`, 'good');
    SND.play('cash');
    S.trade = null;
    UI.closeModal();
    UI.refresh();
    if (G.saveMP) G.saveMP(true);
  }

  function cancel(silent) {
    const T = S.trade;
    if (!T) return;
    if (!silent) send(T.pid, { kind: 'trade_cancel' });
    S.trade = null;
    if (UI.current() === 'p2p') UI.closeModal();
  }

  // ---------- отряд ----------
  S.leaveParty = function (pid) {
    if (pid) { send(pid, { kind: 'party_kick' }); delete S.party[pid]; }
    else { for (const id of Object.keys(S.party)) send(+id, { kind: 'party_leave' }); S.party = {}; }
    renderParty();
  };
  function syncParty() {
    // лидер рассылает состав всем участникам
    const members = [{ pid: NET.id, name: NET.name }, ...Object.entries(S.party).map(([pid, name]) => ({ pid: +pid, name }))];
    for (const m of members) if (m.pid !== NET.id) send(m.pid, { kind: 'party_sync', members });
  }

  // общий опыт: 30% опыта уходит каждому члену отряда
  S.shareXP = function (n) {
    if (!NET.active || n < 2) return;
    const share = Math.floor(n * 0.3);
    if (share > 0) for (const pid of Object.keys(S.party)) send(+pid, { kind: 'party_xp', n: share });
  };
  S.partyChat = function (text) {
    const ids = Object.keys(S.party);
    if (!ids.length) { G.log('Вы не в отряде.', 'warn'); return; }
    for (const pid of ids) send(+pid, { kind: 'party_chat', text });
    G.log(`[Отряд] ${NET.name}: ${text}`, 'chat');
  };

  S.onEv = function (m) {
    const from = m.from, name = m.fromName || nameOf(from);
    switch (m.kind) {
      case 'trade_req':
        if (S.trade || G.combat || UI.modalOpen()) { send(from, { kind: 'trade_ans', ok: false, busy: true }); return; }
        SND.play('dialog');
        prompt('Обмен', `<b>${name}</b> предлагает обмен.`, () => { send(from, { kind: 'trade_ans', ok: true }); openTrade(from); }, () => send(from, { kind: 'trade_ans', ok: false }));
        break;
      case 'trade_ans':
        if (m.ok) openTrade(from); else G.log(`${name} ${m.busy ? 'сейчас занят' : 'отказался от обмена'}.`, 'warn');
        break;
      case 'trade_offer':
        if (S.trade && S.trade.pid === from) { S.trade.theirs = m.offer; S.trade.readyMe = false; S.trade.readyThem = false; draw(); }
        break;
      case 'trade_ready':
        if (S.trade && S.trade.pid === from) { S.trade.readyThem = true; S.trade.theirSig = m.sig; tryFinish(); draw(); }
        break;
      case 'trade_cancel':
        if (S.trade && S.trade.pid === from) { G.log(`${name} отменил обмен.`, 'warn'); cancel(true); }
        break;
      case 'party_inv':
        SND.play('dialog');
        prompt('Отряд', `<b>${name}</b> зовёт вас в отряд. Участники видят друг друга на карте мира, получают 30% опыта друг друга и могут писать в чат отряда («/о текст»).`,
          () => { S.party[from] = name; send(from, { kind: 'party_ans', ok: true }); renderParty(); }, () => send(from, { kind: 'party_ans', ok: false }));
        break;
      case 'party_ans':
        if (m.ok) { S.party[from] = name; G.log(`${name} теперь в вашем отряде.`, 'good'); syncParty(); renderParty(); }
        else G.log(`${name} отказался вступать в отряд.`, 'warn');
        break;
      case 'party_sync':
        S.party = {};
        for (const mb of m.members) if (mb.pid !== NET.id) S.party[mb.pid] = mb.name;
        renderParty();
        break;
      case 'party_leave': case 'party_kick':
        if (m.kind === 'party_kick') { S.party = {}; G.log(`${name} исключил вас из отряда.`, 'warn'); }
        else { delete S.party[from]; G.log(`${name} покинул отряд.`, 'warn'); }
        delete S.partyState[from];
        renderParty();
        break;
      case 'party_xp':
        if (S.party[from]) { G.log(`Опыт отряда от ${name}:`, 'sys'); G.giveXP(m.n, true); }
        break;
      case 'party_chat':
        if (S.party[from]) G.log(`[Отряд] ${name}: ${m.text}`, 'chat');
        break;
      case 'party_state':
        if (S.party[from]) { S.partyState[from] = { ...m.s, name, at: Date.now() }; renderParty(); }
        break;
    }
  };

  // ---------- панель отряда ----------
  function renderParty() {
    let el = document.getElementById('party-box');
    if (!el) {
      el = document.createElement('div'); el.id = 'party-box';
      document.getElementById('game').appendChild(el);
      el.addEventListener('click', e => { if (e.target.closest('[data-leave]')) S.leaveParty(); });
    }
    const ids = Object.keys(S.party);
    if (!NET.active || !ids.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = '<div class="pb-head">ОТРЯД <button data-leave="1" data-tip="Покинуть отряд">выйти</button></div>' + ids.map(pid => {
      const st = S.partyState[pid] || {};
      const hp = st.maxHp ? Math.max(0, st.hp) / st.maxHp : 1;
      return `<div class="pb-row"><div class="pb-name">${S.party[pid]}${st.level ? ' · ур. ' + st.level : ''}</div>
        <div class="bar" style="height:6px"><i style="width:${Math.round(hp * 100)}%;background:${hp > 0.5 ? '#4cc23a' : hp > 0.25 ? '#e0a020' : '#d03020'}"></i></div>
        <div class="pb-loc">${st.locName || '...'}</div></div>`;
    }).join('');
  }
  S.renderParty = renderParty;

  // рассылка своего состояния участникам отряда
  setInterval(() => {
    if (!NET.active || !G.player) return;
    for (const pid of Object.keys(S.party)) if (!NET.players.some(p => p.id === +pid)) { delete S.party[pid]; delete S.partyState[pid]; renderParty(); }
    const ids = Object.keys(S.party);
    if (!ids.length) return;
    const p = G.player;
    const s = { hp: p.hp, maxHp: R.maxHP(p), level: p.level, locName: G.scene === 'local' && G.loc ? G.loc.def.name : 'Карта мира', c: G.world && G.world.c, r: G.world && G.world.r, onMap: G.scene === 'world' };
    for (const pid of ids) send(+pid, { kind: 'party_state', s });
  }, 2000);

  return S;
})();
