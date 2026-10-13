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
    if ((m.kind === 'party_contract' || m.kind === 'party_prog') && S.onContractEv(m)) return;
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
        if (m.ok) { S.party[from] = name; G.log(`${name} теперь в вашем отряде.`, 'good'); syncParty(); renderParty(); if (S.contract) send(from, { kind: 'party_contract', c: S.contract }); }
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


  // ---------- контракты (совместные задания отряда) ----------
  const CONTRACTS = [
    { id: 'c_wolves', title: 'Волчья напасть', target: ['wolf', 'wolf_alpha'], need: 6, xp: 250, caps: 120, where: 'Мёртвый лес, стаи в пути' },
    { id: 'c_rats', title: 'Крысоловы', target: ['rat', 'rat_big'], need: 10, xp: 150, caps: 70, where: 'подвал водокачки, Заря, Старый город' },
    { id: 'c_infected', title: 'Санитары', target: ['infected', 'infected_brute', 'z_soldier', 'z_officer'], need: 6, xp: 350, caps: 180, where: 'лаборатория «Заря-2», Объект 9' },
    { id: 'c_raiders', title: 'Охота на бандитов', target: ['raider', 'raider_melee', 'raider_rifle', 'scav', 'scav_gun', 'toll'], need: 6, xp: 280, caps: 150, where: 'Блокпост 17, Заря, Ржавый мост, пустошь' },
  ];
  S.contract = null; // { id, have, uid }
  // ежедневные случайные контракты (после финала — больше и дороже)
  const RAND = [
    { t: 'Зачистка гнезда', target: ['rat', 'rat_big'], where: 'подвалы и руины' }, { t: 'Охота на стаю', target: ['wolf', 'wolf_alpha'], where: 'леса и травяные пустоши' },
    { t: 'Карантин', target: ['infected', 'infected_brute', 'z_soldier', 'z_officer'], where: 'лаборатории, Объект 9' }, { t: 'Мусорщики обнаглели', target: ['scav', 'scav_gun', 'scav_boss'], where: 'промзона «Заря», подъезды' },
    { t: 'Дорожные бандиты', target: ['raider', 'raider_melee', 'raider_rifle', 'toll'], where: 'дороги и мост' },
  ];
  function daily() {
    if (!window.G || !G.player) return [];
    const day = Math.floor(G.time / 1440), post = G.postGame && G.postGame();
    let seed = day * 9301 + 49297;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const list = [];
    const pool = RAND.slice();
    for (let i = 0; i < (post ? 3 : 2); i++) {
      const r = pool.splice(Math.floor(rnd() * pool.length), 1)[0], need = 4 + Math.floor(rnd() * 6), lvl = G.player.level, mult = post ? 1.6 : 1;
      list.push({ id: `d${day}_${i}`, title: `${r.t} (день ${day + 1})`, target: r.target, need, where: r.where, daily: true,
        xp: Math.round((40 + 12 * lvl) * need * mult / 2), caps: Math.round((15 + 4 * lvl) * need * mult / 2) });
    }
    return list;
  }
  const allContracts = () => CONTRACTS.concat(daily(), S.contract && S.contract.def ? [S.contract.def] : []);
  const cdef = id => allContracts().find(c => c.id === id);
  const members = () => Object.keys(S.party).map(Number);
  function bcast(o) { if (NET.active) for (const pid of members()) send(pid, o); }

  S.openContracts = function () {
    const c = S.contract, d = c && cdef(c.id);
    const inParty = NET.active && members().length > 0;
    UI.openModal('contracts', `<div class="modal" style="width:min(640px,96vw)">
      <h2>Доска контрактов <button class="close" data-close>✕</button></h2>
      <div class="muted" style="margin-bottom:6px">${inParty ? `Вы в отряде (${members().length + 1} чел.): прогресс общий, награда — каждому участнику, +15% за каждого бойца.` : 'Контракт можно выполнять одному или в отряде (сетевая игра): тогда счёт убийств общий.'}</div>
      ${c ? `<div class="screen" style="margin-bottom:8px"><b class="warn">Текущий: ${d.title}</b> — ${c.have}/${d.need}<div class="bar" style="margin-top:4px"><i style="width:${Math.min(100, c.have / d.need * 100)}%;background:var(--amber)"></i></div>
        <div style="margin-top:6px;text-align:right"><button id="ct-drop">Отказаться</button></div></div>` : ''}
      <div class="screen">${allContracts().filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).map(x => `<div class="item" style="grid-template-columns:1fr auto;cursor:default"><div><div class="nm">${x.title}: убить ${x.need}</div>
        <div class="sub">${x.daily ? '<span class="warn">Сегодня</span> · ' : ''}Где: ${x.where}. Награда: ${x.xp} опыта и ${x.caps} крышек</div></div>
        <div><button ${c ? 'disabled' : ''} data-ct="${x.id}">Взять</button></div></div>`).join('')}</div></div>`, root => {
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-ct]');
        if (b) { S.takeContract(b.dataset.ct); UI.closeModal(); }
        if (e.target.id === 'ct-drop') { S.contract = null; bcast({ kind: 'party_contract', c: null }); G.log('Контракт отменён.', 'warn'); UI.closeModal(); }
      });
    });
  };
  S.takeContract = function (id) {
    const d0 = cdef(id);
    S.contract = { id, have: 0, uid: Date.now() + '_' + NET.id, def: d0.daily ? d0 : null };
    G.log(`Контракт «${cdef(id).title}» взят${members().length ? ' на весь отряд' : ''}.`, 'good');
    bcast({ kind: 'party_contract', c: S.contract });
    renderContract();
  };
  S.onKill = function (a) {
    const c = S.contract;
    if (!c || !cdef(c.id).target.includes(a.tpl)) return;
    c.have++;
    G.log(`Контракт «${cdef(c.id).title}»: ${Math.min(c.have, cdef(c.id).need)}/${cdef(c.id).need}.`, 'sys');
    bcast({ kind: 'party_prog', uid: c.uid, have: c.have });
    checkDone();
    renderContract();
  };
  function checkDone() {
    const c = S.contract;
    if (!c) return;
    const d = cdef(c.id);
    if (c.have < d.need || c.paid) return;
    c.paid = true;
    const bonus = 1 + 0.15 * members().length;
    G.log(`Контракт «${d.title}» выполнен${members().length ? ' всем отрядом' : ''}!`, 'good');
    SND.play('quest');
    const caps = Math.round(d.caps * bonus);
    G.player.caps += caps; G.log(`+${caps} крышек.`, 'good');
    G.giveXP(Math.round(d.xp * bonus), true); // награда уже у каждого — без доли отряду
    S.contract = null;
    renderContract();
  }
  S.onContractEv = function (m) {
    if (!S.party[m.from]) return false;
    if (m.kind === 'party_contract') {
      S.contract = m.c ? { ...m.c } : null;
      G.log(m.c ? `Отряд взял контракт «${cdef(m.c.id).title}».` : 'Отряд отменил контракт.', 'sys');
      renderContract(); return true;
    }
    if (m.kind === 'party_prog' && S.contract && S.contract.uid === m.uid) {
      S.contract.have = Math.max(S.contract.have, m.have);
      checkDone(); renderContract(); return true;
    }
    return false;
  };
  function renderContract() {
    let el = document.getElementById('contract-box');
    if (!el) { el = document.createElement('div'); el.id = 'contract-box'; document.getElementById('game').appendChild(el); }
    const c = S.contract;
    if (!c) { el.classList.add('hidden'); return; }
    const d = cdef(c.id);
    el.classList.remove('hidden');
    el.innerHTML = `<b>КОНТРАКТ</b> ${d.title}: ${Math.min(c.have, d.need)}/${d.need}`;
  }
  S.renderContract = renderContract;

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
