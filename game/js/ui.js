// Интерфейс: нижняя панель, диалоги, окна
window.UI = (function () {
  const { ITEMS, SPECIAL, SKILLS } = DATA;
  const $ = s => document.querySelector(s);
  const U = {};
  let G;
  let modalRefresh = null;

  const ACTIONS = [
    { id: 'move', name: 'Ходить', icon: 'walk', key: 'Q' },
    { id: 'attack', name: 'Атака', icon: 'attack', key: 'A' },
    { id: 'steal', name: 'Кража', icon: 'steal', key: 'K' },
    { id: 'lockpick', name: 'Взлом', icon: 'lockpick', key: 'L' },
    { id: 'sneak', name: 'Красться', icon: 'sneak', key: 'S' },
    { id: 'look', name: 'Осмотр', icon: 'look', key: 'X' },
    { id: 'heal', name: 'Лечить', icon: 'heal', key: 'H' },
    { id: 'reload', name: 'Перезар.', icon: 'reload', key: 'R' },
    { id: 'inventory', name: 'Инвентарь', icon: 'inventory', key: 'I' },
    { id: 'character', name: 'Персонаж', icon: 'character', key: 'C' },
    { id: 'map', name: 'Карта', icon: 'map', key: 'M' },
    { id: 'save', name: 'Сохран.', icon: 'save', key: 'F5' },
  ];
  const CURSORS = { move: 'default', attack: 'crosshair', steal: 'grab', lockpick: 'cell', look: 'help', throw: 'crosshair' };

  U.init = function (game) {
    G = game;
    const box = $('#actions');
    box.innerHTML = ACTIONS.map(a => `<div class="act" data-act="${a.id}" data-tip="${a.name} [${a.key}]"><span class="key">${a.key}</span>${ICONS.ACTION[a.icon]}<span>${a.name}</span></div>`).join('');
    box.addEventListener('click', e => { const el = e.target.closest('.act'); if (el) { SND.play('ui'); U.action(el.dataset.act); } });
    $('#quick-slots').addEventListener('click', e => { const el = e.target.closest('.qs'); if (el) G.useQuick(+el.dataset.i); });
    $('#btn-sound').addEventListener('click', () => { SND.set('mute', !SND.opts.mute); U.refresh(); });
    $('#weapon-box').addEventListener('click', e => {
      const b = e.target.closest('[data-aim]');
      if (b) { e.stopPropagation(); G.ui.aim = b.dataset.aim; SND.play('ui'); U.refresh(); return; }
      U.action('attack');
    });
    $('#weapon-box').addEventListener('contextmenu', e => { e.preventDefault(); U.action('reload'); });
    $('#btn-endturn').addEventListener('click', () => COMBAT.endPlayerTurn(G));
    $('#dlg-options').addEventListener('click', e => { const li = e.target.closest('li'); if (li && !li.classList.contains('disabled')) { SND.play('ui'); WORLD_API.dialogChoose(G, +li.dataset.i); } });
    // подсказки
    const tip = $('#tooltip');
    document.addEventListener('mousemove', e => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el) { tip.style.display = 'block'; tip.textContent = el.dataset.tip; tip.style.left = Math.min(innerWidth - 310, e.clientX + 14) + 'px'; tip.style.top = (e.clientY - 30) + 'px'; }
      else tip.style.display = 'none';
    });
  };

  U.action = function (id) {
    if (G.scene === 'menu' || G.player.dead) return;
    const inLocal = G.scene === 'local';
    switch (id) {
      case 'move': case 'attack': case 'steal': case 'lockpick': case 'look':
        if (!inLocal) return;
        U.setMode(G.ui.mode === id && id !== 'move' ? 'move' : id);
        if (id === 'steal') G.hint('Кража: кликните по персонажу');
        if (id === 'lockpick') G.hint('Взлом: кликните по запертому контейнеру');
        if (id === 'look') G.hint('Осмотр: кликните по объекту');
        break;
      case 'sneak':
        if (!inLocal) return;
        if (G.combat) { G.log('В бою красться бессмысленно.', 'warn'); return; }
        G.sneaking = !G.sneaking;
        G.log(G.sneaking ? `Вы крадётесь. Скрытность: ${R.skill(G.player, 'sneak')}%.` : 'Вы перестали красться.', 'sys');
        break;
      case 'heal': G.firstAid(); break;
      case 'reload': if (inLocal) COMBAT.reload(G); break;
      case 'inventory': U.toggle('inventory', U.openInventory); break;
      case 'character': U.toggle('character', () => U.openCharacter(false)); break;
      case 'map':
        if (G.scene === 'world') { G.hint('Вы уже на карте мира'); return; }
        WORLD_API.leaveToWorld(G); break;
      case 'save': G.save(); break;
      case 'journal': U.toggle('journal', () => U.openJournal()); break;
    }
    U.refresh();
  };

  U.setMode = function (m) {
    if (!G.ui) return;
    G.ui.mode = m;
    ENG.canvas.style.cursor = CURSORS[m] || 'default';
    U.refresh();
  };

  // ---------- обновление HUD ----------
  U.refresh = function () {
    if (!G || !G.player) return;
    const p = G.player;
    const max = R.maxAP(p);
    const ap = G.combat ? p.ap : max;
    const cost = G.ui.apCost || 0;
    $('#ap-bar').innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < ap ? (G.combat && cost && i >= ap - cost ? 'cost' : 'on') : ''}"></i>`).join('');
    $('#hp-val').textContent = `${Math.max(0, p.hp)}/${R.maxHP(p)}`;
    $('#ac-val').textContent = R.AC(p);
    $('#ap-val').textContent = `${ap}/${max}`;
    const w = R.weaponOf(p);
    $('#wpn-name').textContent = w.name;
    $('#wpn-icon').innerHTML = ICONS.WEAPON[w.icon] || '';
    const aim = G.ui.aim || 'torso';
    const chance = G.ui.hover && G.ui.hover.actor && !G.ui.hover.actor.dead && G.loc ? COMBAT.hitChance(G, p, G.ui.hover.actor, aim) : null;
    $('#wpn-info').innerHTML = `<span>ОД ${w.ap + COMBAT.aimCost(aim)} · урон ${w.dmg[0]}–${w.dmg[1]}${w.melee ? '' : ' · дальн. ' + w.range}</span><span>${w.mag ? `${p.loaded}/${w.mag} · ${R.count(p, w.ammo)}` : ''}${chance != null && (G.ui.mode === 'attack' || G.ui.hover.actor.hostile) ? ` · <b>${chance}%</b>` : ''}</span>`;
    $('#aim-sel').innerHTML = Object.entries(DATA.AIM).map(([k, A]) => `<span data-aim="${k}" class="${k === aim ? 'on' : ''}" data-tip="${A.name}: ${A.desc}${A.ap ? ' +' + A.ap + ' ОД.' : ''} [Z]">${A.name}</span>`).join('');
    $('#weapon-box').classList.toggle('active', G.ui.mode === 'attack');
    const qs = G.quickSlots ? G.quickSlots() : [];
    $('#quick-slots').innerHTML = qs.map((id, i) => {
      const n = id ? R.count(p, id) : 0;
      return `<div class="qs ${n ? '' : 'empty'}" data-i="${i}" data-tip="${id ? ITEMS[id].name + ' [' + (i + 1) + ']' : 'Пустой слот — назначьте в инвентаре'}"><span class="k">${i + 1}</span>${id ? itemIcon(id) : ''}<span class="n">${id ? n : ''}</span></div>`;
    }).join('');
    $('#btn-sound').textContent = SND.opts.mute ? '🔇' : '🔊';
    $('#btn-endturn').classList.toggle('hidden', !(G.combat && G.combat.isPlayerTurn()));
    document.querySelectorAll('.act').forEach(el => {
      const id = el.dataset.act;
      el.classList.toggle('on', id === G.ui.mode || (id === 'sneak' && G.sneaking));
      const localOnly = ['move', 'attack', 'steal', 'lockpick', 'look', 'sneak', 'reload'].includes(id);
      el.classList.toggle('disabled', (localOnly && G.scene !== 'local') || (id === 'map' && !!G.combat && !G.combat.canFlee) || (id === 'sneak' && !!G.combat));
    });
    // верхняя строка
    $('#loc-name').textContent = G.scene === 'world' ? 'Карта мира' : G.loc ? G.loc.def.name : '';
    $('#clock').textContent = G.clockText();
    const tags = [];
    if (G.combat) tags.push(`<span class="tag combat">БОЙ · раунд ${G.combat.round}${G.combat.isPlayerTurn() ? ' · ваш ход' : ' · ход: ' + (G.combat.current ? G.combat.current.name : '…')}</span>`);
    if (G.scene !== 'menu' && G.player && G.nightK && G.nightK() > 0.55) tags.push('<span class="tag night" data-tip="Ночью враги замечают вас с меньшего расстояния, а стрелять вдаль труднее">НОЧЬ</span>');
    if (G.combat && G.combat.canFlee) tags.push('<span class="tag sneak">МОЖНО УЙТИ НА КАРТУ</span>');
    if (G.sneaking) tags.push(`<span class="tag sneak">СКРЫТНО${G.risk ? ' · риск ' + G.risk + '%/с' : ''}</span>`);
    if (R.overloaded(p)) tags.push('<span class="tag danger">ПЕРЕГРУЗ</span>');
    if (NET.active) tags.push(`<span class="tag online" data-tip="${NET.players.map(x => x.name + (x.loc ? '' : ' (карта)')).join('\n')}">ОНЛАЙН: ${NET.players.length}${NET.isAuth && G.scene === 'local' ? ' · ведущий' : ''}</span>`);
    if (p.perkPts > 0) tags.push(`<span class="tag sneak">Новый перк!</span>`);
    if (p.freePts > 0) tags.push(`<span class="tag sneak">Очки навыков: ${p.freePts}</span>`);
    $('#status-tags').innerHTML = tags.join('');
    if (modalRefresh) modalRefresh();
  };

  U.log = function (text, cls = '') {
    const box = $('#log-box');
    const d = document.createElement('div');
    if (cls) d.className = 'l-' + cls;
    d.textContent = '› ' + text;
    box.appendChild(d);
    while (box.children.length > 120) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  };

  let hintT = 0;
  U.hint = function (text) {
    const h = $('#float-hint');
    h.textContent = text; h.style.display = 'block';
    clearTimeout(hintT);
    hintT = setTimeout(() => h.style.display = 'none', 1800);
  };

  // ---------- диалог ----------
  U.showDialog = function (npc, text, opts) {
    if (!G.dialog || G.dialog._shown !== npc) { SND.play('dialog'); if (G.dialog) G.dialog._shown = npc; }
    $('#log-box').classList.add('hidden');
    $('#dialog-box').classList.remove('hidden');
    const port = $('#dlg-portrait');
    port.src = makePortrait(npc);
    $('#dlg-name').textContent = npc.name;
    $('#dlg-sub').textContent = npc.sprite ? 'объект' : npc.trader ? 'торговец' : npc.hostile ? 'враждебен' : npc.faction === 'town' ? 'житель Ручья' : '';
    $('#dlg-text').textContent = text;
    $('#dlg-options').innerHTML = opts.map((t, i) => `<li data-i="${i}">${t}</li>`).join('');
  };
  U.hideDialog = function () {
    $('#dialog-box').classList.add('hidden');
    $('#log-box').classList.remove('hidden');
    $('#log-box').scrollTop = 1e9;
  };
  const portraitCache = {};
  function makePortrait(a) {
    if (a.sprite) {
      const k2 = 'spr_' + a.sprite;
      if (portraitCache[k2]) return portraitCache[k2];
      const im = ENG.img[a.sprite];
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = '#0d150c'; x.fillRect(0, 0, 64, 64);
      if (im) { const s = Math.min(60 / im.width, 60 / im.height); x.drawImage(im, 32 - im.width * s / 2, 32 - im.height * s / 2, im.width * s, im.height * s); }
      try { return (portraitCache[k2] = c.toDataURL()); } catch (e) { return ''; }
    }
    const k = a.tint || 'player';
    if (portraitCache[k]) return portraitCache[k];
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#0d150c'; x.fillRect(0, 0, 64, 64);
    x.imageSmoothingEnabled = false;
    x.drawImage(ENG.sheets[k], 30, 8, 60, 46, -8, 2, 80, 61);
    try { return (portraitCache[k] = c.toDataURL()); }
    catch (e) { return (portraitCache[k] = 'assets/ui/portrait.png'); } // file:// — холст «испорчен»
  }
  U.portrait = makePortrait;

  // ---------- модальные окна ----------
  let currentModal = null;
  U.modalOpen = () => !!currentModal;
  U.current = () => currentModal;
  U.openModal = function (name, html, mount, opts = {}) {
    // новый контейнер — чтобы не копились обработчики событий прошлых окон
    const old = $('#modal-root');
    const root = old.cloneNode(false);
    old.replaceWith(root);
    root.className = opts.full ? 'full' : '';
    root.innerHTML = html;
    currentModal = name;
    modalRefresh = null;
    root.querySelectorAll('[data-close]').forEach(b => b.onclick = U.closeModal);
    if (mount) mount(root);
  };
  U.closeModal = function () {
    $('#modal-root').innerHTML = '';
    $('#modal-root').className = '';
    currentModal = null;
    modalRefresh = null;
    U.refresh();
  };
  U.toggle = function (name, open) {
    if (currentModal === name) { U.closeModal(); return; }
    if (currentModal === 'create' || currentModal === 'title' || currentModal === 'dead') return;
    open();
  };

  function itemIcon(id) {
    const it = ITEMS[id];
    return (it.type === 'weapon' ? ICONS.WEAPON[it.icon] : ICONS.ITEM[it.icon]) || '';
  }
  function itemSub(id) {
    const it = ITEMS[id];
    if (it.type === 'weapon') return `урон ${it.dmg[0]}–${it.dmg[1]} · ОД ${it.ap}${it.range > 1 ? ' · дальн. ' + it.range : ''} · ${it.weight} кг`;
    if (it.type === 'armor') return `КБ +${it.ac} · ПУ ${it.dt} · СУ ${it.dr}% · ${it.weight} кг`;
    if (it.type === 'aid') return `лечит ${R.healAmount(G.player, id)} ОЗ · ${it.weight} кг`;
    if (it.type === 'throw') return `урон ${it.dmg[0]}–${it.dmg[1]} · ОД ${it.ap} · бросок ${it.range}${it.radius ? ' · радиус ' + it.radius : ''} · ${it.weight} кг`;
    return `${it.weight} кг`;
  }
  function itemRow(id, n, extra = '', cls = '', data = '') {
    return `<div class="item ${cls}" ${data}><div class="ico">${itemIcon(id)}</div><div><div class="nm"${ITEMS[id].unique ? ' style="color:#ffcf40"' : ''}>${ITEMS[id].unique ? '★ ' : ''}${ITEMS[id].name}</div><div class="sub">${itemSub(id)}</div></div><div class="qty">${n > 1 ? '×' + n : ''}${extra}</div></div>`;
  }
  U.itemIcon = itemIcon;

  // ---------- инвентарь ----------
  U.openInventory = function () {
    let sel = null;
    TUT.mark('panel');
    U.openModal('inventory', `<div class="modal" style="width:780px;height:min(560px,100%)">
      <h2>Инвентарь <button class="close" data-close>✕ [I]</button></h2>
      <div class="cols" style="flex:1;min-height:0">
        <div class="screen" style="flex:1.3" id="inv-list"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;min-height:0">
          <div class="cols"><div class="slot" id="slot-w" data-tip="Клик — снять"></div><div class="slot" id="slot-a" data-tip="Клик — снять"></div></div>
          <div class="screen" id="inv-stats"></div>
          <div class="screen desc-box" id="inv-desc" style="flex:1"></div>
          <div class="cols" id="inv-btns"></div>
        </div>
      </div></div>`, root => {
      const draw = () => {
        const p = G.player;
        const list = p.inv.slice().sort((a, b) => order(a.id) - order(b.id));
        root.querySelector('#inv-list').innerHTML = list.length ? `<div class="inv-list">${list.map(s => itemRow(s.id, s.n, '', s.id === sel ? 'sel' : '', `data-id="${s.id}"`)).join('')}</div>` : '<div class="muted">Пусто</div>';
        const w = p.weapon, a = p.armor;
        root.querySelector('#slot-w').innerHTML = `<div class="lbl">Оружие в руке</div>${w ? itemIcon(w) + `<div class="nm">${ITEMS[w].name}</div>` : '<div class="muted">Кулаки</div>'}`;
        root.querySelector('#slot-a').innerHTML = `<div class="lbl">Броня</div>${a ? itemIcon(a) + `<div class="nm">${ITEMS[a].name}</div>` : '<div class="muted">Нет</div>'}`;
        const wt = R.weight(p), cm = R.carryMax(p);
        root.querySelector('#inv-stats').innerHTML = `<div>Вес: <b class="${wt > cm ? 'bad' : ''}">${wt}</b> / ${cm} кг</div><div class="bar ${wt > cm ? 'over' : ''}"><i style="width:${Math.min(100, wt / cm * 100)}%"></i></div>
          <div style="margin-top:6px">Крышки: <b class="warn">${p.caps}</b> · ОЗ ${p.hp}/${R.maxHP(p)} · КБ ${R.AC(p)} · ПУ ${R.DT(p)} · СУ ${R.DR(p)}%</div>`;
        const it = sel && ITEMS[sel];
        root.querySelector('#inv-desc').innerHTML = it ? `<b class="warn">${it.name}</b><br>${it.desc || ''}<br><span class="muted">${itemSub(sel)} · цена ${it.value}</span>` : '<span class="muted">Выберите предмет. Двойной клик — использовать / надеть.</span>';
        const btns = [];
        if (it) {
          if (it.type === 'weapon' || it.type === 'armor') btns.push('<button class="primary" data-b="equip">Надеть / взять в руку</button>');
          if (it.type === 'throw') { btns.push('<button class="primary" data-b="use">Бросить</button>'); btns.push('<button data-b="q0">→1</button><button data-b="q1">→2</button><button data-b="q2">→3</button>'); }
          if (it.type === 'aid') { btns.push('<button class="primary" data-b="use">Использовать</button>'); btns.push('<button data-b="q0">→1</button><button data-b="q1">→2</button><button data-b="q2">→3</button>'); }
          if (it.type !== 'quest') btns.push('<button data-b="drop">Выбросить</button>');
        }
        root.querySelector('#inv-btns').innerHTML = btns.join('');
      };
      const act = b => {
        if (!sel) return;
        if (b === 'equip') G.equip(sel);
        if (b === 'use') G.useItem(sel);
        if (b && b[0] === 'q') { G.quickSlots()[+b[1]] = sel; G.log(`${ITEMS[sel].name} — в быстрый слот ${+b[1] + 1}.`, 'sys'); }
        if (b === 'drop') { const s = G.player.inv.find(i => i.id === sel); if (s) { R.removeItem(G.player, sel, s.n); G.log(`Выброшено: ${ITEMS[sel].name}.`, 'sys'); } }
        if (!G.player.inv.find(i => i.id === sel)) sel = null;
        U.refresh();
      };
      root.addEventListener('click', e => {
        const row = e.target.closest('.item');
        if (row) { sel = row.dataset.id; draw(); return; }
        const b = e.target.closest('[data-b]');
        if (b) { act(b.dataset.b); return; }
        if (e.target.closest('#slot-w')) { G.unequip('weapon'); U.refresh(); }
        if (e.target.closest('#slot-a')) { G.unequip('armor'); U.refresh(); }
      });
      root.addEventListener('dblclick', e => {
        const row = e.target.closest('.item');
        if (!row) return;
        sel = row.dataset.id;
        const t = ITEMS[sel].type;
        act(t === 'aid' || t === 'throw' ? 'use' : (t === 'weapon' || t === 'armor') ? 'equip' : '');
      });
      modalRefresh = draw;
      draw();
    });
  };
  const ORDER = { weapon: 0, armor: 1, aid: 2, ammo: 3, quest: 4, misc: 5 };
  const order = id => ORDER[ITEMS[id].type] * 100 + (ITEMS[id].value > 0 ? 0 : 1);

  // ---------- лут / контейнеры ----------
  U.openLoot = function (src) {
    const comp = !!src.isCompanion;
    const title = src.fw != null ? (src.name || 'Контейнер') : src.isCompanion ? `Вещи напарника: ${src.name}` : `Тело: ${src.name}`;
    U.openModal('loot', `<div class="modal" style="width:760px;height:min(520px,100%)">
      <h2>${title} <button class="close" data-close>✕</button></h2>
      <div class="cols" style="flex:1;min-height:0">
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-height:0"><div class="warn">${comp ? 'У напарника' : 'Содержимое'}</div><div class="screen" id="l-src" style="flex:1"></div></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-height:0"><div class="warn">Ваш инвентарь</div><div class="screen" id="l-me" style="flex:1"></div></div>
      </div>
      <div class="cols" style="margin-top:8px;justify-content:space-between"><span class="muted" id="l-w"></span><span><button class="primary" id="l-all">Взять всё</button> <button data-close>Закрыть</button></span></div>
    </div>`, root => {
      const draw = () => {
        const p = G.player;
        const caps = src.caps ? `<div class="item" data-caps="1"><div class="ico">${ICONS.ITEM.caps}</div><div><div class="nm">Крышки</div><div class="sub">валюта</div></div><div class="qty">${src.caps}</div></div>` : '';
        const btns = (n, k, id) => comp && n > 1 ? ` <button data-${k}1="${id}" style="padding:0 5px;font-size:11px">1</button> <button data-${k}a="${id}" style="padding:0 5px;font-size:11px">все</button>` : '';
        root.querySelector('#l-src').innerHTML = (caps + src.inv.map(s => itemRow(s.id, s.n, btns(s.n, 's', s.id), '', `data-id="${s.id}"`)).join('')) || '<div class="muted">Пусто</div>';
        root.querySelector('#l-me').innerHTML = p.inv.map(s => itemRow(s.id, s.n, btns(s.n, 'm', s.id), '', `data-mine="${s.id}"`)).join('') || '<div class="muted">Пусто</div>';
        if (comp) root.querySelector('#l-w').textContent = `Вы: ${R.weight(p)}/${R.carryMax(p)} кг · ${src.name}: ${R.weight(src)}/${R.carryMax(src)} кг · клик по предмету — 1 шт., «все» — всю стопку`;
        root.querySelector('#l-w').textContent = `Вес: ${R.weight(p)} / ${R.carryMax(p)} кг · Крышки: ${p.caps}`;
      };
      root.addEventListener('click', e => {
        const p = G.player;
        const bs = e.target.closest('[data-s1],[data-sa],[data-m1],[data-ma]');
        if (bs) {
          const d = bs.dataset, mine = d.m1 || d.ma, id = d.s1 || d.sa || mine;
          const from = mine ? p : src, to = mine ? src : p;
          if (mine && ITEMS[id].type === 'quest') return;
          const n = (d.sa || d.ma) ? R.count(from, id) : 1;
          R.removeItem(from, id, n); R.addItem(to, id, n); SND.play('pickup'); NET.touch(src); U.refresh(); return;
        }
        const r = e.target.closest('.item');
        if (!r) return;
        SND.play('pickup');
        if (comp && (r.dataset.id || r.dataset.mine)) {
          const id = r.dataset.id || r.dataset.mine, from = r.dataset.id ? src : p, to = r.dataset.id ? p : src;
          if (r.dataset.mine && ITEMS[id].type === 'quest') return;
          R.removeItem(from, id, 1); R.addItem(to, id, 1); U.refresh(); return;
        }
        if (r.dataset.caps) { p.caps += src.caps; src.caps = 0; }
        else if (r.dataset.id) { const s = src.inv.find(i => i.id === r.dataset.id); const n = s.n; R.removeItem(src, s.id, n); R.addItem(p, s.id, n); }
        else if (r.dataset.mine) { const s = p.inv.find(i => i.id === r.dataset.mine); if (ITEMS[s.id].type === 'quest') return; const n = s.n; R.removeItem(p, s.id, n); R.addItem(src, s.id, n); }
        NET.touch(src);
        if (G.hasItem('pump_core') && !G.flags.westEnd) G.westCore('stolen');
        U.refresh();
      });
      root.querySelector('#l-all').onclick = () => {
        const p = G.player;
        p.caps += src.caps || 0; src.caps = 0;
        for (const s of src.inv.slice()) { const n = s.n; R.removeItem(src, s.id, n); R.addItem(p, s.id, n); }
        NET.touch(src);
        if (G.hasItem('pump_core') && !G.flags.westEnd) G.westCore('stolen');
        U.closeModal();
      };
      modalRefresh = draw;
      draw();
    });
  };

  // ---------- кража ----------
  U.openSteal = function (npc) {
    U.openModal('steal', `<div class="modal" style="width:560px;height:min(500px,100%)">
      <h2>Кража: ${npc.name} <button class="close" data-close>✕</button></h2>
      <div class="muted" style="margin-bottom:6px">Ваш навык Кражи: ${R.skill(G.player, 'steal')}%. ${G.sneaking ? 'Вы крадётесь (+20%).' : 'Режим скрытности дал бы +20%.'} Каждая попытка повышает подозрительность.</div>
      <div class="screen" id="s-list" style="flex:1"></div>
      <div style="margin-top:8px;text-align:right"><button data-close>Уйти</button></div></div>`, root => {
      const draw = () => {
        const rows = [];
        if (npc.caps) rows.push(`<div class="item" data-id="caps"><div class="ico">${ICONS.ITEM.caps}</div><div><div class="nm">Крышки</div><div class="sub">${npc.caps} шт.</div></div><div class="qty">${WORLD_API.stealChance(G, npc, 'caps', npc.caps)}%</div></div>`);
        for (const s of npc.inv) rows.push(itemRow(s.id, s.n, ` · <b>${WORLD_API.stealChance(G, npc, s.id, s.id.startsWith('ammo') || s.id === 'shells' ? s.n : 1)}%</b>`, '', `data-id="${s.id}"`));
        if (npc.weapon) rows.push(`<div class="item" style="opacity:.5;cursor:default"><div class="ico">${itemIcon(npc.weapon)}</div><div><div class="nm">${ITEMS[npc.weapon].name}</div><div class="sub">в руках — не украсть</div></div><div></div></div>`);
        root.querySelector('#s-list').innerHTML = rows.join('') || '<div class="muted">Карманы пусты.</div>';
      };
      root.addEventListener('click', e => {
        const r = e.target.closest('.item[data-id]');
        if (!r) return;
        WORLD_API.steal(G, npc, r.dataset.id);
        U.refresh();
      });
      modalRefresh = draw;
      draw();
    });
  };

  // ---------- торговля ----------
  U.openTrade = function (npc) {
    const disc = npc.tpl === 'semyon' ? (G.flags.semDiscount || 0) : 0;
    const rm = npc.faction === 'town' ? G.repLevel().mult : 1;
    const buyP = id => Math.max(1, Math.ceil(ITEMS[id].value * R.buyMult(G.player, disc) * rm));
    const sellP = id => Math.max(ITEMS[id].value > 0 ? 1 : 0, Math.floor(ITEMS[id].value * R.sellMult(G.player) / rm));
    const pack = (id, have) => (ITEMS[id].type === 'ammo' ? Math.min(10, have) : 1);
    U.openModal('trade', `<div class="modal" style="width:820px;height:min(560px,100%)">
      <h2>Торговля: ${npc.name} <button class="close" data-close>✕</button></h2>
      <div class="muted" style="margin-bottom:6px">Торговля ${R.skill(G.player, 'barter')}% · Харизма ${G.player.stats.cha}${disc ? ' · скидка ' + Math.round(disc * 100) + '%' : ''}. Клик — купить/продать (патроны по 10).</div>
      <div class="cols" style="flex:1;min-height:0">
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-height:0"><div class="warn" id="t-hc"></div><div class="screen" id="t-his" style="flex:1"></div></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-height:0"><div class="warn" id="t-mc"></div><div class="screen" id="t-mine" style="flex:1"></div></div>
      </div>
      <div style="margin-top:8px;text-align:right"><button data-close>Готово</button></div></div>`, root => {
      const draw = () => {
        const p = G.player;
        root.querySelector('#t-hc').textContent = `Товар (${npc.caps} крышек у торговца)`;
        root.querySelector('#t-mc').textContent = `Ваше (${p.caps} крышек)`;
        root.querySelector('#t-his').innerHTML = npc.inv.map(s => itemRow(s.id, s.n, ` · <b>${buyP(s.id) * pack(s.id, s.n)}¢</b>`, buyP(s.id) * pack(s.id, s.n) > p.caps ? 'dim' : '', `data-buy="${s.id}"`)).join('') || '<div class="muted">Пусто</div>';
        root.querySelector('#t-mine').innerHTML = p.inv.filter(s => ITEMS[s.id].type !== 'quest').map(s => itemRow(s.id, s.n, ` · <b>${sellP(s.id) * pack(s.id, s.n)}¢</b>`, '', `data-sell="${s.id}"`)).join('') || '<div class="muted">Нечего продать</div>';
      };
      root.addEventListener('click', e => {
        const r = e.target.closest('.item');
        if (!r) return;
        const p = G.player;
        if (r.dataset.buy) {
          const id = r.dataset.buy, n = pack(id, R.count(npc, id)), price = buyP(id) * n;
          if (p.caps < price) { G.hint('Не хватает крышек'); return; }
          p.caps -= price; npc.caps += price; R.removeItem(npc, id, n); R.addItem(p, id, n); SND.play('cash');
          G.log(`Куплено: ${ITEMS[id].name}${n > 1 ? ' ×' + n : ''} за ${price}¢.`, 'sys');
        } else if (r.dataset.sell) {
          const id = r.dataset.sell, n = pack(id, R.count(p, id)), price = sellP(id) * n;
          if (npc.caps < price) { G.hint('У торговца нет столько крышек'); return; }
          p.caps += price; npc.caps -= price; R.removeItem(p, id, n); R.addItem(npc, id, n); SND.play('cash');
          G.log(`Продано: ${ITEMS[id].name}${n > 1 ? ' ×' + n : ''} за ${price}¢.`, 'sys');
        }
        NET.syncEnt(npc);
        U.refresh();
      });
      modalRefresh = draw;
      draw();
    });
  };

  // ---------- персонаж / создание ----------
  U.openCharacter = function (create, onDone) {
    if (!create) TUT.mark('panel');
    const p = create ? R.newPlayer('Странник', { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 5, luck: 5 }, []) : G.player;
    let pool = create ? 5 : 0;
    let desc = create ? 'Выберите профиль, распределите 5 очков между характеристиками и отметьте 3 профильных навыка (+20%, и каждое очко навыка даёт +2%). Навык профиля отмечен всегда.' : '';
    if (create && !p.tags.includes('auto')) { p.cls = 'auto'; p.tags.push('auto'); }
    const SK_LIST = SKILLS.filter(s => !s.npc);
    U.openModal(create ? 'create' : 'character', `<div class="modal" style="width:min(980px,96vw);height:min(600px,100%)">
      <h2>${create ? 'Создание персонажа' : 'Персонаж'} ${create ? '' : '<button class="close" data-close>✕ [C]</button>'}</h2>
      <div class="cols" style="flex:1;min-height:0">
        <div class="screen" style="flex:1" id="c-special"></div>
        <div class="screen" style="flex:0.9" id="c-derived"></div>
        <div class="screen" style="flex:1.2" id="c-skills"></div>
      </div>
      ${create ? `<div class="cols" id="c-cls" style="margin-top:8px;gap:6px"></div>` : ''}
      <div class="screen desc-box" id="c-desc" style="margin-top:8px"></div>
      ${create ? `<div class="cols" style="margin-top:8px;justify-content:space-between;align-items:center"><label>Имя: <input id="c-name" value="Странник" maxlength="18" style="font-family:var(--font);background:#0d150c;color:var(--green);border:1px solid var(--green-dim);padding:4px"></label><button class="primary" id="c-go">Начать игру ▶</button></div>` : ''}
    </div>`, root => {
      const draw = () => {
        root.querySelector('#c-special').innerHTML = `<div class="warn" style="margin-bottom:4px">Характеристики${create ? ` · осталось очков: <b>${pool}</b>` : ''}</div>` + SPECIAL.map(s => `
          <div class="stat-row" data-desc="${s.id}"><span>${s.name}</span><b>${p.stats[s.id]}</b><span class="pm">${create ? `<button data-st="${s.id}" data-d="-1">−</button><button data-st="${s.id}" data-d="1">+</button>` : ''}</span></div>`).join('');
        const lvlNext = R.xpForLevel(p.level);
        root.querySelector('#c-derived').innerHTML = `<div class="warn" style="margin-bottom:4px">${create ? 'Производные' : `${p.name} · уровень ${p.level}`}</div>
          ${create ? '' : `<div class="stat-row"><span>Опыт</span><b>${p.xp}</b><span class="muted">/${lvlNext}</span></div>`}
          ${[['Очки здоровья', R.maxHP(p), 'hp'], ['Очки действия', R.maxAP(p), 'ap'], ['Класс брони', R.AC(p), 'ac'], ['Грузоподъёмность', R.carryMax(p) + ' кг', 'carry'],
             ['Урон в ближнем', '+' + R.meleeBonus(p), 'mb'], ['Шанс крита', R.critChance(p) + '%', 'crit'], ['Порядок хода', R.sequence(p), 'seq'], ['Лечение/час', R.healRate(p), 'heal'],
             ['Очков навыков/ур.', R.skillPerLevel(p), 'spl']]
            .map(([n, v, k]) => `<div class="stat-row" data-desc="d_${k}"><span>${n}</span><b>${v}</b><span></span></div>`).join('')}
          ${create ? '' : `<div class="stat-row" data-desc="d_rep"><span>Репутация в Ручье</span><b class="${G.repLevel().cls}">${G.rep() > 0 ? '+' : ''}${G.rep()}</b><span class="${G.repLevel().cls}" style="font-size:11px">${G.repLevel().name}</span></div>`}
          ${create ? '' : `<div style="margin-top:8px" class="warn">Перки</div><div class="muted" style="font-size:12px">${(p.perks || []).map(id => (DATA.PERKS.find(k => k.id === id) || {}).name).join(', ') || 'нет'}</div>
          ${p.perkPts > 0 ? `<button class="primary" id="c-perk" style="margin-top:4px">Выбрать перк (${p.perkPts})</button>` : '<div class="muted" style="font-size:11px">Новый перк — на каждом чётном уровне.</div>'}
          <div style="margin-top:8px" class="warn">Задания <button id="c-journal" style="font-size:11px;padding:0 6px">Журнал [J]</button></div><div class="muted" style="font-size:12px">${questText()}</div>`}`;
        if (create) root.querySelector('#c-cls').innerHTML = '<span class="warn" style="align-self:center">Профиль:</span>' + DATA.CLASSES.map(c => `<button data-cls="${c.id}" data-desc="cls_${c.id}" class="${p.cls === c.id ? 'primary' : ''}" style="flex:1">${c.name} · ${SKILLS.find(s => s.id === c.skill).name}</button>`).join('');
        root.querySelector('#c-skills').innerHTML = `<div class="warn" style="margin-bottom:4px">Навыки${create ? ` · профильных: ${p.tags.length}/3` : p.freePts ? ` · свободных очков: <b>${p.freePts}</b>` : ''}</div>` + SK_LIST.map(s => `
          <div class="stat-row skill-row" data-desc="${s.id}">${create ? `<span class="tagbox ${p.tags.includes(s.id) ? 'on' : ''}" data-tag="${s.id}"></span>` : `<span>${p.tags.includes(s.id) ? '<span class="warn">★</span>' : ''}</span>`}
          <span>${s.name}</span><b>${R.skill(p, s.id)}%</b><span class="pm">${!create && p.freePts > 0 ? `<button data-sk="${s.id}">+</button>` : ''}</span></div>`).join('');
        root.querySelector('#c-desc').innerHTML = desc;
        const go = root.querySelector('#c-go');
        if (go) go.disabled = pool !== 0 || p.tags.length !== 3;
      };
      const DERIVED = { hp: 'Очки здоровья: 20 + СИЛ + 2×ВЫН (+ за уровни).', ap: 'Очки действия в бою: 5 + ЛОВ/2. Шаг — 1 ОД, выстрел/удар — по оружию, аптечка — 2 ОД.', ac: 'Класс брони: ЛОВ + броня. Снижает шанс попадания по вам.', carry: 'Грузоподъёмность: 15 + 8×СИЛ кг. При перегрузе двигаться нельзя.', mb: 'Бонус урона в ближнем бою: СИЛ − 5 (минимум 1).', crit: 'Шанс критического попадания (×1.5 урона, частично игнорирует броню): Удача + бонус оружия. Атака из скрытности: +30% к шансу и ×2.5 урона.', seq: 'Порядок хода: 2×ВСП. Кто выше — ходит раньше.', heal: 'Сколько ОЗ восстанавливается за час отдыха: ВЫН/3.', spl: 'Очки навыков за уровень: 5 + 2×ИНТ.', rep: 'Как к вам относятся в Ржавом Ручье. Растёт за помощь жителям, падает за кражи и убийства. Влияет на цены (−20%…+30%), реплики и лечение у Ирины. Враг Ручья — с вами не торгуют, а охрана стреляет.' };
      root.addEventListener('mouseover', e => {
        const r = e.target.closest('[data-desc]');
        if (!r) return;
        const k = r.dataset.desc;
        const s = SPECIAL.find(x => x.id === k) || SKILLS.find(x => x.id === k);
        const cl = k.startsWith('cls_') && DATA.CLASSES.find(c => 'cls_' + c.id === k);
        desc = cl ? `<b class="warn">${cl.name}</b> — профильный навык «${SKILLS.find(x => x.id === cl.skill).name}». В багажнике: ${cl.desc}` : s ? `<b class="warn">${s.name}</b> — ${s.desc}` : DERIVED[k.slice(2)] || '';
        root.querySelector('#c-desc').innerHTML = desc;
      });
      root.addEventListener('click', e => {
        const st = e.target.closest('[data-st]');
        if (st) {
          const k = st.dataset.st, d = +st.dataset.d;
          if (d > 0 && pool > 0 && p.stats[k] < 10) { p.stats[k]++; pool--; }
          if (d < 0 && p.stats[k] > 1) { p.stats[k]--; pool++; }
          draw(); return;
        }
        const cb = e.target.closest('[data-cls]');
        if (cb && create) {
          const old = DATA.CLASSES.find(c => c.id === p.cls), nw = DATA.CLASSES.find(c => c.id === cb.dataset.cls);
          if (old && p.tags.includes(old.skill)) p.tags.splice(p.tags.indexOf(old.skill), 1);
          p.cls = nw.id;
          if (!p.tags.includes(nw.skill)) { if (p.tags.length >= 3) p.tags.pop(); p.tags.push(nw.skill); }
          desc = `<b class="warn">${nw.name}</b> — профильный навык «${SKILLS.find(x => x.id === nw.skill).name}». В багажнике: ${nw.desc}`;
          draw(); return;
        }
        const tg = e.target.closest('[data-tag]');
        if (tg) {
          const k = tg.dataset.tag;
          if (create && (DATA.CLASSES.find(c => c.id === p.cls) || {}).skill === k) { G.hint('Навык профиля отмечен всегда'); return; }
          if (p.tags.includes(k)) p.tags.splice(p.tags.indexOf(k), 1);
          else if (p.tags.length < 3) p.tags.push(k);
          draw(); return;
        }
        const sk = e.target.closest('[data-sk]');
        if (sk && p.freePts > 0) {
          const k = sk.dataset.sk;
          p.skillPts[k] = (p.skillPts[k] || 0) + 1; p.freePts--;
          draw(); U.refresh(); return;
        }
        if (e.target.id === 'c-perk') { U.openPerks(); return; }
        if (e.target.id === 'c-journal') { U.openJournal(); return; }
        if (e.target.id === 'c-go') {
          p.name = root.querySelector('#c-name').value.trim() || 'Странник';
          p.hp = R.maxHP(p);
          U.closeModal();
          onDone && onDone(p);
        }
      });
      draw();
      if (!create) modalRefresh = draw;
    }, { full: create });
  };

  function questText() {
    const rows = [];
    const q = G.quests.meds;
    if (q >= 3) rows.push('<div class="muted">✔ Лекарства для Ручья</div>');
    else if (G.hasItem('meds')) rows.push('<div>► <b>Лекарства для Ручья</b>: верните ящик медикаментов Михалычу.</div>');
    else if (q) rows.push('<div>► <b>Лекарства для Ручья</b>: найдите ящик медикаментов на Блокпосту 17 (северо-восток).</div>');
    for (const [id, d] of Object.entries(DATA.QUESTS)) {
      const st = G.q(id);
      if (!st) continue;
      if (st >= 9) rows.push(`<div class="muted">✔ ${d.title}</div>`);
      else rows.push(`<div>► <b>${d.title}</b>: ${d.steps[st] || d.steps[1]}</div>`);
    }
    rows.sort((a, b) => a.includes('✔') - b.includes('✔'));
    return rows.join('') || 'Нет заданий. Ищите жителей со значком «!» над головой.';
  }

  // ---------- заставка / смерть ----------
  U.openTitle = function (hasSave, onNew, onLoad) {
    U._onNew = onNew; U._onLoad = onLoad;
    U.openModal('title', `<div class="title-screen">
      <h1>ПУСТОШЬ</h1><div class="sub">РЖАВЫЙ РУЧЕЙ · ДЕМО</div>
      <button class="primary" id="t-new">Новая игра</button>
      <button id="t-load" ${hasSave ? '' : 'disabled'}>Загрузить</button>
      <button id="t-mp">Сетевая игра</button>
      <button id="t-set">Настройки</button>
      ${window.desktop ? '<button id="t-quit">Выход</button>' : ''}
      <div class="muted" style="margin-top:22px;font-size:12px;line-height:1.6">ЛКМ — идти / действие · ПКМ — отменить режим · колесо — масштаб · 1–3 — быстрые слоты<br>
      Q ходить · A атака · S красться · K кража · L взлом · X осмотр · H лечить · R перезарядка<br>I инвентарь · C персонаж · M карта · N мини-карта · Пробел — конец хода · F5/F9 — сохранить/загрузить</div>
    </div>
    <div class="version-box"><button id="t-upd" class="upd hidden" data-tip="Доступно обновление">!</button><span>${window.GAME_VERSION}</span></div>`, root => {
      root.querySelector('#t-new').onclick = onNew;
      root.querySelector('#t-load').onclick = onLoad;
      root.querySelector('#t-mp').onclick = () => U.openMultiplayer();
      root.querySelector('#t-set').onclick = () => U.openSettings();
      SND.setScene('menu');
      const q = root.querySelector('#t-quit');
      if (q) q.onclick = () => window.desktop.quit();
      const upd = root.querySelector('#t-upd');
      const show = info => {
        if (!info || !info.newer || !upd.isConnected) return;
        upd.classList.remove('hidden');
        upd.dataset.tip = `Доступно обновление ${info.tag}`;
        upd.onclick = () => U.openUpdate(info);
      };
      if (UPD.latest) show(UPD.latest); else UPD.check().then(show);
    }, { full: true });
  };
  U.openUpdate = function (info) {
    const auto = !!(window.desktop && window.desktop.canAutoUpdate && /\.zip$/i.test(info.url));
    const back = () => U.openTitle(G.hasSave(), U._onNew, U._onLoad);
    U.openModal('update', `<div class="modal" style="width:540px">
      <h2>Обновление ${info.tag}</h2>
      <div class="screen" style="max-height:260px;white-space:pre-line;margin-bottom:10px">Текущая версия: ${window.GAME_VERSION}
Новая версия: ${info.tag}

${(info.notes || '').replace(/</g, '&lt;')}</div>
      <div class="muted" id="u-hint" style="font-size:12px;margin-bottom:10px">${auto ? 'Игра скачает обновление, установит его и перезапустится сама. Сохранения не пострадают.' : 'Скачайте архив, распакуйте его поверх старой папки и запустите Poostosh.exe. Сохранения не пострадают.'}</div>
      <div id="u-prog" class="hidden" style="margin-bottom:10px"><div class="bar" style="height:14px"><i id="u-bar" style="width:0%;background:var(--amber)"></i></div><div id="u-st" class="warn" style="font-size:12px;margin-top:4px"></div></div>
      <div class="cols" id="u-btns" style="justify-content:flex-end"><button id="u-back">Назад</button><button id="u-page">Страница релиза</button><button class="primary" id="u-dl">${auto ? 'Обновить' : 'Скачать'}</button></div></div>`, root => {
      root.querySelector('#u-back').onclick = back;
      root.querySelector('#u-page').onclick = () => UPD.open(info.page);
      const st = root.querySelector('#u-st'), bar = root.querySelector('#u-bar');
      root.querySelector('#u-dl').onclick = async () => {
        if (!auto) { UPD.open(info.url); return; }
        root.querySelector('#u-btns').classList.add('hidden');
        root.querySelector('#u-prog').classList.remove('hidden');
        st.textContent = 'Подключение...';
        window.desktop.onUpdateProgress(d => {
          if (d.stage === 'download') {
            const mb = x => (x / 1048576).toFixed(1);
            bar.style.width = d.total ? Math.round(d.got / d.total * 100) + '%' : '50%';
            st.textContent = `Загрузка: ${mb(d.got)} из ${d.total ? mb(d.total) : '?'} МБ`;
          } else if (d.stage === 'extract') { bar.style.width = '100%'; st.textContent = 'Распаковка...'; }
          else if (d.stage === 'restart') st.textContent = 'Установка и перезапуск игры...';
        });
        const r = await window.desktop.installUpdate(info.url);
        if (!r.ok) {
          st.innerHTML = `<span class="bad">Ошибка: ${r.error}</span>`;
          root.querySelector('#u-btns').classList.remove('hidden');
        }
      };
    }, { full: true });
  };

  U.openMultiplayer = function () {
    let last = {};
    try { last = JSON.parse(localStorage.getItem('mp_last') || '{}'); } catch (e) { /* */ }
    const servedByGame = location.protocol.startsWith('http') && location.port && location.port !== '8123';
    const host = last.host || (servedByGame ? location.hostname : '127.0.0.1');
    const port = last.port || (servedByGame ? location.port : '7777');
    const back = () => U.openTitle(G.hasSave(), U._onNew, U._onLoad);
    U.openModal('mp', `<div class="modal" style="width:min(720px,96vw)">
      <h2>Сетевая игра <button class="close" id="mp-back">✕</button></h2>
      <div class="screen" style="margin-bottom:8px">
        <div class="cols" style="justify-content:space-between;align-items:center"><span class="warn">Серверы</span>
          <span><button id="sl-refresh">Обновить</button> <button id="sl-fav" data-tip="Добавить адрес из поля «Адрес сервера» в избранное">★ В избранное</button></span></div>
        <div id="sl-list" style="max-height:190px;overflow:auto;margin-top:6px"><div class="muted">Загрузка списка...</div></div>
        <div class="muted" style="font-size:11px;margin-top:4px">Клик — выбрать сервер, двойной клик — подключиться. Общий список серверов — файл servers.json в репозитории игры.</div>
      </div>
      <div class="cols">
        <div class="screen" style="flex:1">
          <div class="warn">Подключиться к серверу</div>
          <label>Адрес сервера (IP)</label><input type="text" id="mp-host" value="${host}">
          <label>Порт</label><input type="number" id="mp-port" value="${port}">
          <label>Пароль</label><input type="password" id="mp-pass" value="">
          <label>Имя персонажа</label><input type="text" id="mp-name" maxlength="18" value="${last.name || 'Странник'}">
          <label data-tip="Задайте пароль персонажа, чтобы входить им с любого компьютера. Без пароля персонаж привязан к этому компьютеру.">Пароль персонажа (для входа с других ПК)</label><input type="password" id="mp-cpass" value="">
          <div style="margin-top:10px"><button class="primary" id="mp-join">Подключиться</button></div>
        </div>
        <div class="screen" style="flex:1">
          <div class="warn">Создать сервер на этом компьютере</div>
          ${window.desktop ? `<label>Порт</label><input type="number" id="sv-port" value="${last.svPort || 7777}">
          <label>Пароль для входа</label><input type="text" id="sv-pass" value="">
          <div style="margin-top:10px"><button class="primary" id="sv-start">Запустить и войти</button></div>
          <div class="muted" style="font-size:12px;margin-top:10px;line-height:1.5">Друзья подключаются по вашему IP и паролю. В локальной сети — по адресу ниже, через интернет — откройте порт на роутере. Отдельный сервер без игры: «Сервер.bat» в папке игры.</div>
          <div id="sv-addr" class="good" style="margin-top:6px"></div>`
          : `<div class="muted" style="font-size:12px;line-height:1.6;margin-top:6px">Сервер запускается из Windows-версии игры (кнопка здесь или «Сервер.bat»), либо командой<br><b>node server/server.js --port 7777 --password пароль</b></div>`}
        </div>
      </div>
      <div id="mp-status" class="warn" style="margin-top:8px;min-height:18px"></div>
    </div>`, root => {
      const st = root.querySelector('#mp-status');
      root.querySelector('#mp-back').onclick = back;
      const join = async (h, pt, pw, nm) => {
        st.textContent = 'Подключение...';
        try { localStorage.setItem('mp_last', JSON.stringify({ ...last, host: h, port: pt, name: nm, svPort: root.querySelector('#sv-port') ? root.querySelector('#sv-port').value : last.svPort })); } catch (e) { /* */ }
        try { await G.startMultiplayer(h, pt, pw, nm, root.querySelector('#mp-cpass').value); }
        catch (e) { st.textContent = 'Ошибка: ' + e; }
      };
      root.querySelector('#mp-join').onclick = () => join(root.querySelector('#mp-host').value.trim(), +root.querySelector('#mp-port').value || 7777, root.querySelector('#mp-pass').value, root.querySelector('#mp-name').value.trim() || 'Странник');
      // ---------- список серверов ----------
      const load = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } };
      const listEl = root.querySelector('#sl-list');
      const fill = s => { root.querySelector('#mp-host').value = s.host; root.querySelector('#mp-port').value = s.port; };
      async function probe(s) {
        const ctl = new AbortController(), t0 = performance.now();
        const to = setTimeout(() => ctl.abort(), 3000);
        try {
          const r = await fetch(`http://${s.host}:${s.port}/info`, { signal: ctl.signal, cache: 'no-store' });
          const i = await r.json();
          return { ...s, info: i, ping: Math.round(performance.now() - t0) };
        } catch (e) { return { ...s, info: null }; } finally { clearTimeout(to); }
      }
      async function refresh() {
        listEl.innerHTML = '<div class="muted">Опрос серверов...</div>';
        let pub = [];
        try { pub = ((await (await fetch(`https://raw.githubusercontent.com/${window.GAME_REPO}/main/servers.json`, { cache: 'no-store' })).json()).servers || []).map(s => ({ ...s, src: 'список' })); } catch (e) { /* нет сети */ }
        const all = [...load('mp_favs').map(s => ({ ...s, src: '★' })), ...pub, ...load('mp_recent').map(s => ({ ...s, src: 'недавний' })), { host: '127.0.0.1', port: 7777, name: 'Этот компьютер', src: 'локальный' }];
        const seen = new Set(), uniq = all.filter(s => { const k = s.host + ':' + s.port; if (seen.has(k)) return false; seen.add(k); return true; });
        const res = await Promise.all(uniq.map(probe));
        res.sort((a, b) => (!!b.info - !!a.info) || ((b.info ? b.info.players.length : 0) - (a.info ? a.info.players.length : 0)));
        listEl.innerHTML = res.map((s, i) => {
          const i2 = s.info, ver = i2 && i2.version !== window.GAME_VERSION;
          return `<div class="item" data-sl="${i}" style="grid-template-columns:1fr auto auto;${i2 ? '' : 'opacity:.5'}">
            <div><div class="nm">${i2 && i2.locked ? '🔒 ' : ''}${(i2 && i2.name) || s.name || s.host}</div><div class="sub">${s.host}:${s.port} · ${s.src}${i2 && i2.motd ? ' · ' + i2.motd.replace(/</g, '&lt;').slice(0, 60) : ''}</div></div>
            <div class="qty">${i2 ? `${i2.players.length}/${i2.max || '?'} · <span class="${ver ? 'bad' : ''}" data-tip="${ver ? 'Версия отличается от вашей' : ''}">${i2.version}</span> · ${s.ping} мс` : 'не отвечает'}</div>
            <div>${s.src === '★' ? `<button data-unfav="${s.host}:${s.port}" style="padding:0 6px">✕</button>` : ''}</div></div>`;
        }).join('') || '<div class="muted">Серверов нет. Создайте свой или введите адрес вручную.</div>';
        listEl._res = res;
      }
      listEl.addEventListener('click', e => {
        const un = e.target.closest('[data-unfav]');
        if (un) { localStorage.setItem('mp_favs', JSON.stringify(load('mp_favs').filter(s => s.host + ':' + s.port !== un.dataset.unfav))); refresh(); return; }
        const r = e.target.closest('[data-sl]'); if (r) fill(listEl._res[+r.dataset.sl]);
      });
      listEl.addEventListener('dblclick', e => {
        const r = e.target.closest('[data-sl]'); if (!r) return;
        fill(listEl._res[+r.dataset.sl]);
        root.querySelector('#mp-join').click();
      });
      root.querySelector('#sl-refresh').onclick = refresh;
      root.querySelector('#sl-fav').onclick = () => {
        const host = root.querySelector('#mp-host').value.trim(), port = +root.querySelector('#mp-port').value || 7777;
        if (!host) return;
        const f = load('mp_favs').filter(s => s.host + ':' + s.port !== host + ':' + port);
        f.unshift({ host, port, name: host });
        localStorage.setItem('mp_favs', JSON.stringify(f.slice(0, 20)));
        refresh();
      };
      refresh();
      const sv = root.querySelector('#sv-start');
      if (sv) sv.onclick = async () => {
        const pt = +root.querySelector('#sv-port').value || 7777, pw = root.querySelector('#sv-pass').value;
        st.textContent = 'Запуск сервера...';
        const r = await window.desktop.startServer({ port: pt, password: pw });
        if (!r || !r.ok) { st.textContent = 'Не удалось запустить сервер: ' + (r && r.error); return; }
        root.querySelector('#sv-addr').innerHTML = 'Адрес для друзей: ' + (r.addresses || []).map(a => `<b>${a}:${r.port}</b>`).join(', ');
        setTimeout(() => join('127.0.0.1', r.port, pw, root.querySelector('#mp-name').value.trim() || 'Странник'), 600);
      };
    }, { full: true });
  };

  U.openSettings = function (fromPause) {
    const back = fromPause ? () => U.openPause() : () => U.openTitle(G.hasSave(), U._onNew, U._onLoad);
    const pct = v => Math.round(v * 100);
    U.openModal('settings', `<div class="modal" style="width:min(520px,94vw)">
      <h2>Настройки <button class="close" id="s-back">✕</button></h2>
      <div class="screen">
        <div class="settings-row"><span>Звуки</span><input type="range" id="s-sfx" min="0" max="100" value="${pct(SND.opts.sfx)}"><b id="s-sfx-v">${pct(SND.opts.sfx)}</b></div>
        <div class="settings-row"><span>Музыка</span><input type="range" id="s-music" min="0" max="100" value="${pct(SND.opts.music)}"><b id="s-music-v">${pct(SND.opts.music)}</b></div>
        <div class="settings-row"><span>Без звука</span><input type="checkbox" id="s-mute" ${SND.opts.mute ? 'checked' : ''}><span></span></div>
        <div class="settings-row"><span>Подсказки</span><input type="checkbox" id="s-tips" ${TUT.enabled() ? 'checked' : ''}><span></span></div>
        <div class="settings-row"><span>Мини-карта</span><input type="checkbox" id="s-mini" ${MINI.visible ? 'checked' : ''}><span></span></div>
        <div class="muted" style="font-size:12px">Подсказки начинаются заново в новой игре. Кнопка 🔊 в правом верхнем углу быстро выключает звук.</div>
      </div>
      <div style="text-align:right;margin-top:10px"><button class="primary" id="s-ok">Готово</button></div></div>`, root => {
      root.querySelector('#s-back').onclick = back;
      root.querySelector('#s-ok').onclick = back;
      for (const k of ['sfx', 'music']) root.querySelector('#s-' + k).oninput = e => { SND.set(k, e.target.value / 100); root.querySelector(`#s-${k}-v`).textContent = e.target.value; if (k === 'sfx') SND.play('pickup'); };
      root.querySelector('#s-mute').onchange = e => SND.set('mute', e.target.checked);
      root.querySelector('#s-tips').onchange = e => TUT.setEnabled(e.target.checked);
      root.querySelector('#s-mini').onchange = e => { if (MINI.visible !== e.target.checked) MINI.toggle(); };
    }, { full: true });
  };

  U.cycleAim = function () {
    const keys = Object.keys(DATA.AIM);
    G.ui.aim = keys[(keys.indexOf(G.ui.aim || 'torso') + 1) % keys.length];
    G.hint('Прицел: ' + DATA.AIM[G.ui.aim].name);
    U.refresh();
  };

  U.openPerks = function () {
    const p = G.player;
    U.openModal('perks', `<div class="modal" style="width:min(640px,96vw);max-height:100%">
      <h2>Выбор перка <button class="close" id="pk-back">✕</button></h2>
      <div class="muted" style="margin-bottom:6px">Доступно выборов: ${p.perkPts || 0}. Перк выбирается навсегда.</div>
      <div class="screen" style="flex:1" id="pk-list"></div></div>`, root => {
      const draw = () => {
        root.querySelector('#pk-list').innerHTML = DATA.PERKS.map(k => {
          const taken = R.has(p, k.id);
          const lvlOk = p.level >= k.level, statOk = !k.stat || p.stats[k.stat[0]] >= k.stat[1];
          const ok = !taken && lvlOk && statOk && p.perkPts > 0;
          const req = `ур. ${k.level}${k.stat ? ', ' + DATA.SPECIAL.find(s => s.id === k.stat[0]).name + ' ' + k.stat[1] : ''}`;
          return `<div class="item" style="grid-template-columns:1fr auto;cursor:default"><div><div class="nm">${taken ? '✔ ' : ''}${k.name}</div><div class="sub">${k.desc} <span class="${lvlOk && statOk ? 'muted' : 'bad'}">(${req})</span></div></div>
            <div>${taken ? '<span class="good">взят</span>' : `<button ${ok ? '' : 'disabled'} data-pk="${k.id}">Выбрать</button>`}</div></div>`;
        }).join('');
      };
      root.querySelector('#pk-back').onclick = () => U.openCharacter(false);
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-pk]');
        if (!b) return;
        p.perks = p.perks || [];
        p.perks.push(b.dataset.pk); p.perkPts--;
        if (b.dataset.pk === 'tough') p.hp += 12;
        G.log(`Новый перк: «${DATA.PERKS.find(k => k.id === b.dataset.pk).name}».`, 'good');
        SND.play('quest');
        U.openCharacter(false);
      });
      draw();
    });
  };

  U.openCraft = function (npc, own) {
    U.openModal('craft', `<div class="modal" style="width:min(680px,96vw);max-height:100%">
      <h2>Мастерская: ${npc.name} <button class="close" data-close>✕</button></h2>
      <div class="muted" style="margin-bottom:6px">${own ? 'Свой верстак: работа бесплатная, нужны только материалы.' : 'Борис делает полезное из хлама. Хлам находится при обыске и у торговцев.'}</div>
      <div class="screen" style="flex:1" id="cr-list"></div>
      ${own ? '<button id="cr-guns" style="margin-top:6px">Модификации оружия…</button>' : '<div class="muted" style="margin-top:6px">Улучшение оружия и обвес — у оружейника Константина у гаража.</div>'}
      <div class="muted" style="margin-top:6px" id="cr-st"></div></div>`, root => {
      const p = G.player;
      const draw = () => {
        root.querySelector('#cr-st').textContent = `Крышки: ${p.caps} · Хлам: ${R.count(p, 'junk')}`;
        root.querySelector('#cr-list').innerHTML = DATA.RECIPES.map((r, i) => {
          const needs = r.need.map(([id, n]) => `<span class="${R.count(p, id) >= n ? '' : 'bad'}">${ITEMS[id].name} ×${n} (${R.count(p, id)})</span>`).join(', ');
          const cost = own ? 0 : r.caps;
          const ok = r.need.every(([id, n]) => R.count(p, id) >= n) && p.caps >= cost;
          return `<div class="item" style="grid-template-columns:40px 1fr auto;cursor:default"><div class="ico">${itemIcon(r.id)}</div>
            <div><div class="nm">${ITEMS[r.id].name}${r.n > 1 ? ' ×' + r.n : ''}</div><div class="sub">${r.desc}<br>Нужно: ${needs}${cost ? `, <span class="${p.caps >= cost ? '' : 'bad'}">${cost} крышек</span>` : ''}</div></div>
            <div><button ${ok ? '' : 'disabled'} data-cr="${i}">Сделать</button></div></div>`;
        }).join('');
      };
      root.addEventListener('click', e => {
        if (e.target.closest('#cr-guns')) { U.openGunsmith({ name: 'Ваш верстак' }, true); return; }
        const b = e.target.closest('[data-cr]');
        if (!b) return;
        const r = DATA.RECIPES[+b.dataset.cr];
        const cost = own ? 0 : r.caps;
        if (!r.need.every(([id, n]) => R.count(p, id) >= n) || p.caps < cost) return;
        r.need.forEach(([id, n]) => R.removeItem(p, id, n));
        p.caps -= cost;
        R.addItem(p, r.id, r.n);
        G.log(`${own ? 'Сделано' : 'Борис сделал'}: ${ITEMS[r.id].name}${r.n > 1 ? ' ×' + r.n : ''}.`, 'good');
        SND.play('reload');
        U.refresh();
      });
      modalRefresh = draw;
      draw();
    });
  };

  // ---------- оружейник: улучшение (из двух одинаковых стволов — один лучший) и обвес ----------
  U.openGunsmith = function (npc, own) {
    U.openModal('gunsmith', `<div class="modal" style="width:min(760px,96vw);max-height:100%">
      <h2>${own ? 'Верстак: оружие' : 'Оружейник: ' + npc.name} <button class="close" data-close>✕</button></h2>
      <div class="muted" style="margin-bottom:6px">${own ? 'Свой верстак: обвес ставится и снимается бесплатно, нужны только материалы. Улучшение стволов — у Константина.' : 'Улучшение: нужны 2 одинаковых ствола (один уходит на детали) и 30% цены ствола. Обвес: материалы и крышки. Снятый обвес лежит в запасе — перестановка бесплатная.'}</div>
      <div class="screen" style="flex:1" id="gs-list"></div>
      <div class="muted" style="margin-top:6px" id="gs-st"></div></div>`, root => {
      const p = G.player;
      const copies = wid => R.count(p, wid) + (p.weapon === wid ? 1 : 0);
      const fits = (m, w) => m.for === 'melee' ? w.melee : !w.melee && (m.for !== 'mag' || w.mag) && (m.for !== 'long' || w.icon !== 'pistol');
      const upCost = wid => Math.ceil(ITEMS[wid].value * 0.3);
      const draw = () => {
        p.wmods = p.wmods || {}; p.wlvl = p.wlvl || {}; p.modStash = p.modStash || {};
        const stash = Object.entries(p.modStash).filter(([, n]) => n > 0).map(([id, n]) => `${DATA.WMODS.find(m => m.id === id).name} ×${n}`);
        root.querySelector('#gs-st').textContent = `Крышки: ${p.caps} · Хлам: ${R.count(p, 'junk')} · Обвес в запасе: ${stash.join(', ') || 'нет'}`;
        const wids = [...new Set([p.weapon, ...p.inv.map(s => s.id)].filter(id => id && ITEMS[id] && ITEMS[id].type === 'weapon' && !ITEMS[id].hidden))];
        if (!wids.length) { root.querySelector('#gs-list').innerHTML = '<div class="muted">У вас нет оружия.</div>'; return; }
        root.querySelector('#gs-list').innerHTML = wids.map(wid => {
          const w = ITEMS[wid], lvl = p.wlvl[wid] || 0, have = p.wmods[wid] || {}, n = copies(wid), cost = upCost(wid);
          const wo = R.weaponOf({ weapon: wid, wmods: p.wmods, wlvl: p.wlvl });
          let up = '';
          if (!own) {
            const ok = lvl < DATA.WMAX_LVL && n >= 2 && p.caps >= cost;
            up = lvl >= DATA.WMAX_LVL ? '<div class="sub good">Улучшено до предела.</div>'
              : `<div class="item" style="grid-template-columns:1fr auto;cursor:default;margin:2px 0"><div><div class="nm">Улучшить до +${lvl + 1}</div>
                <div class="sub">Урон ${wo.dmg[0]}–${wo.dmg[1]} → ${Math.round(w.dmg[0] * (1 + 0.15 * (lvl + 1))) + (have.sharp ? 2 : 0)}–${Math.round(w.dmg[1] * (1 + 0.15 * (lvl + 1))) + (have.sharp ? 2 : 0)}, крит +2%.
                Нужно: <span class="${n >= 2 ? '' : 'bad'}">2 одинаковых (есть ${n})</span>, <span class="${p.caps >= cost ? '' : 'bad'}">${cost} крышек</span></div></div>
                <div><button ${ok ? '' : 'disabled'} data-up="${wid}">Улучшить</button></div></div>`;
          }
          const mods = DATA.WMODS.filter(m => fits(m, w)).map(m => {
            const inSlot = DATA.WMODS.find(x => x.slot === m.slot && x.id !== m.id && have[x.id]);
            if (have[m.id]) return `<div class="item" style="grid-template-columns:1fr auto;cursor:default;margin:2px 0"><div><div class="nm good">✔ ${m.name}</div><div class="sub">${m.desc}</div></div>
              <div><button data-off="${m.id}" data-w="${wid}">Снять в запас</button></div></div>`;
            const fromStash = (p.modStash[m.id] || 0) > 0, mcost = own ? 0 : m.caps;
            const needs = m.need.map(([id, k]) => `<span class="${R.count(p, id) >= k ? '' : 'bad'}">${ITEMS[id].name} ×${k} (${R.count(p, id)})</span>`).join(', ');
            const ok = fromStash || (m.need.every(([id, k]) => R.count(p, id) >= k) && p.caps >= mcost);
            return `<div class="item" style="grid-template-columns:1fr auto;cursor:default;margin:2px 0"><div><div class="nm">${m.name}</div>
              <div class="sub">${m.desc}${inSlot ? ` <span class="warn">Заменит: ${inSlot.name} (уйдёт в запас).</span>` : ''}<br>${fromStash ? '<span class="good">Есть в запасе — поставить бесплатно.</span>' : `Нужно: ${needs}${mcost ? `, <span class="${p.caps >= mcost ? '' : 'bad'}">${mcost} крышек</span>` : ''}`}</div></div>
              <div><button ${ok ? '' : 'disabled'} data-on="${m.id}" data-w="${wid}">${fromStash ? 'Поставить' : 'Сделать'}</button></div></div>`;
          }).join('');
          return `<div style="border:1px solid #3e8a34;border-radius:4px;padding:6px;margin-bottom:8px">
            <div style="display:flex;gap:8px;align-items:center"><div class="ico" style="width:40px">${itemIcon(wid)}</div>
            <div><div class="nm" style="color:var(--amber)">${wo.name}${p.weapon === wid ? ' · в руках' : ''}</div>
            <div class="sub">Урон ${wo.dmg[0]}–${wo.dmg[1]}${w.melee ? '' : ` · дальн. ${wo.range}${wo.mag ? ` · магазин ${wo.mag}` : ''}`} · уровень ${lvl}/${DATA.WMAX_LVL} · стволов: ${n}</div></div></div>
            ${up}${mods}</div>`;
        }).join('');
      };
      root.addEventListener('click', e => {
        const bu = e.target.closest('[data-up]'), bon = e.target.closest('[data-on]'), boff = e.target.closest('[data-off]');
        if (bu && !own) {
          const wid = bu.dataset.up, lvl = p.wlvl[wid] || 0, cost = upCost(wid);
          if (lvl >= DATA.WMAX_LVL || copies(wid) < 2 || p.caps < cost || !R.count(p, wid)) return;
          R.removeItem(p, wid, 1); p.caps -= cost; p.wlvl[wid] = lvl + 1;
          if (npc && npc.tpl === 'konst' && npc.x != null) {
            // Константин уходит к верстаку: стучит, искрит, потом проверяет ствол на прицел
            U.closeModal(); SND.play('cash');
            G.log(`${npc.name} забирает оба ствола и уходит к верстаку...`, 'sys');
            npc.workT = 2.8; npc.workStart = performance.now();
            setTimeout(() => {
              G.log(`${npc.name}: «Готово. ${ITEMS[wid].name} теперь +${lvl + 1}. Второй ствол ушёл на детали.»`, 'good');
              SND.play('reload'); U.refresh();
              if (!G.combat && G.scene === 'local') U.openGunsmith(npc, false);
            }, 2900);
            return;
          }
          G.log(`${npc.name} перебрал ${ITEMS[wid].name}: теперь +${lvl + 1}. Второй ствол ушёл на детали.`, 'good');
        } else if (bon) {
          const m = DATA.WMODS.find(x => x.id === bon.dataset.on), wid = bon.dataset.w, have = p.wmods[wid] = p.wmods[wid] || {};
          if (have[m.id]) return;
          if ((p.modStash[m.id] || 0) > 0) p.modStash[m.id]--;
          else {
            const mcost = own ? 0 : m.caps;
            if (!m.need.every(([id, k]) => R.count(p, id) >= k) || p.caps < mcost) return;
            m.need.forEach(([id, k]) => R.removeItem(p, id, k)); p.caps -= mcost;
          }
          // в слоте может стоять другая модификация — уходит в запас
          for (const x of DATA.WMODS) if (x.slot === m.slot && have[x.id]) { delete have[x.id]; p.modStash[x.id] = (p.modStash[x.id] || 0) + 1; }
          have[m.id] = 1;
          if (npc && npc.tpl === 'konst') { npc.workT = 1.2; npc.workStart = performance.now(); }
          G.log(`Установлено: ${m.name} → ${ITEMS[wid].name}.`, 'good');
        } else if (boff) {
          const id = boff.dataset.off, wid = boff.dataset.w, have = p.wmods[wid] || {};
          if (!have[id]) return;
          delete have[id]; p.modStash[id] = (p.modStash[id] || 0) + 1;
          if (id === 'mag') { const w = R.weaponOf(p); if (p.weapon === wid && w.mag && p.loaded > w.mag) { R.addItem(p, w.ammo, p.loaded - w.mag); p.loaded = w.mag; } }
          G.log(`Снято в запас: ${DATA.WMODS.find(m => m.id === id).name}.`, 'sys');
        } else return;
        SND.play('reload');
        U.refresh();
      });
      modalRefresh = draw;
      draw();
    });
  };

  // ---------- интро новой игры ----------
  // Фраза белым по чёрному → кадр (медленный наезд камеры) → … → «Утро...», затем игра.
  // Каждая фраза проявляется из темноты своей строкой, с небольшим подъёмом, следующая — чуть позже.
  // Клик / Пробел / Enter — следующий слайд, Esc — пропустить интро.
  const INTRO = [
    { text: ['Езда по серпантину...', 'Ночь, дождь, фары выхватывают мокрый асфальт...'] },
    { image: 'intro_0001.jpg' },
    { text: ['Вспышки в кустах у обочины...'] },
    { image: 'intro_0002.jpg' },
    { text: ['Звон стекла...', 'Руль вырывается из рук...'] },
    { image: 'intro_0003.jpg' },
    { text: ['Удар...', 'Темнота...'] },
    { image: 'intro_0004.jpg' },
    { text: ['Утро...', 'Пахнет бензином и мокрой хвоей...', 'Вы живы...'] },
  ];
  const IN = { image: 6, hold: 2.6, lineFade: 1.6, lineStep: 1.3, rise: 14, fadeIn: 0.9, fadeOut: 0.7, zoom: 1.07 };
  U.openIntro = function (done) {
    INTRO.forEach(s => { if (s.image) { const im = new Image(); im.src = 'assets/intro/' + s.image; } });
    const el = document.createElement('div');
    el.id = 'intro';
    el.innerHTML = `<img id="in-pic" alt=""><div id="in-text"></div><div id="in-fade"></div><div id="in-hint">Клик — дальше  ·  Esc — пропустить</div>`;
    document.body.appendChild(el);
    const pic = el.querySelector('#in-pic'), text = el.querySelector('#in-text'), fade = el.querySelector('#in-fade');
    let idx = -1, timers = [], finished = false;
    const later = (fn, s) => timers.push(setTimeout(fn, s * 1000));
    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      removeEventListener('keydown', onKey, true);
      fade.style.transition = `opacity ${IN.fadeOut}s ease`; fade.style.opacity = 1;
      setTimeout(() => { el.remove(); done && done(); }, IN.fadeOut * 1000);
    };
    const next = () => {
      if (finished) return;
      timers.forEach(clearTimeout); timers = [];
      idx++;
      if (idx >= INTRO.length) { finish(); return; }
      const s = INTRO[idx];
      // из темноты
      fade.style.transition = 'none'; fade.style.opacity = 1; void fade.offsetWidth;
      fade.style.transition = `opacity ${IN.fadeIn}s ease-in-out`; fade.style.opacity = 0;
      let dur;
      if (s.image) {
        text.style.display = 'none'; pic.style.display = 'block';
        pic.src = 'assets/intro/' + s.image;
        pic.style.transition = 'none'; pic.style.transform = 'scale(1)'; void pic.offsetWidth;
        pic.style.transition = `transform ${IN.image}s cubic-bezier(.39,.58,.57,1)`; pic.style.transform = `scale(${IN.zoom})`;
        dur = IN.image;
      } else {
        pic.style.display = 'none'; text.style.display = 'flex';
        text.innerHTML = s.text.map(t => `<div class="in-line">${t}</div>`).join('');
        [...text.children].forEach((ln, i) => {
          const d = IN.fadeIn * 0.5 + i * IN.lineStep;
          ln.style.transition = `opacity ${IN.lineFade}s ease-in-out ${d}s, transform ${IN.lineFade + 0.4}s cubic-bezier(.17,.84,.44,1) ${d}s`;
          void ln.offsetWidth; // фиксируем начальное состояние, чтобы сработал переход
          ln.style.opacity = 1; ln.style.transform = 'translateY(0)';
        });
        dur = IN.fadeIn * 0.5 + (s.text.length - 1) * IN.lineStep + IN.lineFade + IN.hold + IN.fadeOut;
      }
      // в темноту перед следующим слайдом
      later(() => { fade.style.transition = `opacity ${IN.fadeOut}s ease-in-out`; fade.style.opacity = 1; }, dur - IN.fadeOut);
      later(next, dur);
    };
    const onKey = e => {
      if (finished) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); next(); }
      else e.stopImmediatePropagation();
    };
    addEventListener('keydown', onKey, true);
    el.addEventListener('mousedown', e => { e.preventDefault(); if (e.button === 0 || e.button === 2) next(); });
    el.addEventListener('contextmenu', e => e.preventDefault());
    next();
  };

  // ---------- меню паузы (Esc) ----------
  U.openPause = function () {
    const mp = NET.active;
    U.openModal('pause', `<div class="title-screen">
      <h1 style="font-size:34px">ПАУЗА</h1><div class="sub">${G.loc ? G.loc.def.name : 'Карта мира'} · ${G.clockText()}</div>
      <button class="primary" data-p="go">Продолжить</button>
      <button data-p="save" ${G.combat && !mp ? 'disabled data-tip="Нельзя сохраняться в бою"' : ''}>${mp ? 'Сохранить персонажа' : 'Сохранить игру'}</button>
      <button data-p="load" ${mp || !G.hasSave() ? 'disabled' : ''}>Загрузить</button>
      <button data-p="journal">Журнал заданий</button>
      <button data-p="char">Персонаж</button>
      ${mp ? '<button data-p="leaders">Таблица лидеров</button>' : ''}
      <button data-p="set">Настройки</button>
      <button data-p="menu">${mp ? 'Отключиться и выйти в меню' : 'Главное меню'}</button>
      ${window.desktop ? '<button data-p="quit">Выйти из игры</button>' : ''}
      <div class="muted" style="margin-top:14px;font-size:12px">Esc — закрыть меню</div></div>`, root => {
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-p]'); if (!b || b.disabled) return;
        SND.play('ui');
        switch (b.dataset.p) {
          case 'go': U.closeModal(); break;
          case 'save': G.save(); U.closeModal(); break;
          case 'load': G.load(); break;
          case 'journal': U.openJournal(); break;
          case 'char': U.openCharacter(false); break;
          case 'leaders': U.openLeaders(); break;
          case 'set': U.openSettings(true); break;
          case 'menu': U.confirm(mp ? 'Отключиться от сервера? Персонаж сохранится.' : 'Выйти в главное меню? Несохранённый прогресс будет потерян (автосохранение — при входе в локацию).',
            () => { if (mp) { G.saveMP(true); NET.disconnect(); } location.reload(); }, () => U.openPause()); break;
          case 'quit': U.confirm('Выйти из игры?', () => { if (!mp) G.save(true); else G.saveMP(true); window.desktop.quit(); }, () => U.openPause()); break;
        }
      });
    }, { full: true });
  };
  U.confirm = function (text, yes, no) {
    U.openModal('confirm', `<div class="modal" style="width:min(460px,94vw)"><h2>Подтверждение</h2>
      <div class="screen" style="margin-bottom:10px">${text}</div>
      <div class="cols" style="justify-content:flex-end"><button id="cf-no">Отмена</button><button class="primary" id="cf-yes">Да</button></div></div>`, root => {
      root.querySelector('#cf-yes').onclick = () => { U.closeModal(); yes(); };
      root.querySelector('#cf-no').onclick = () => { U.closeModal(); no && no(); };
    }, { full: true });
  };

  // ---------- журнал заданий ----------
  const SITE_OF = {
    meds: g => g.hasItem('meds') ? 'camp' : 'post', pelts: g => R.count(g.player, 'wolf_pelt') >= 3 ? 'camp' : 'forest', debt: 'camp', tools: 'camp', wounded: 'camp', marauder: 'camp', ration: 'camp', south: g => ({ 1: g.flags.obsDone === 'dark' ? 'hive' : 'fort', 2: g.flags.obsDone === 'dark' ? 'hive' : 'fort', 3: 'rassvet' })[g.q('south')], obs: g => ({ 1: 'observatory', 2: 'observatory', 3: 'observatory', 4: 'rassvet' })[g.q('obs')], north: g => ({ 1: 'mine', 2: 'mine', 3: 'bastion', 4: 'rassvet' })[g.q('north')], west: g => ({ 1: 'oasis', 2: 'solar', 3: 'oasis' })[g.q('west')], rats: 'camp', column: g => ({ 1: 'city', 2: 'city', 3: 'city', 4: 'city' })[g.q('column')],
    battery: g => g.hasItem('battery') ? 'camp' : 'zarya', crate: g => g.hasItem('sealed_crate') ? 'camp' : ({ 1: 'camp', 2: 'camp', 3: 'post' })[g.q('crate')], zarya: g => ({ 1: 'zarya', 2: 'zarya', 3: 'zarya', 4: 'camp' })[g.q('zarya')],
    thread: g => ({ 1: g.flags.bridgeOpen ? 'rassvet' : 'bridge', 2: 'object9', 3: 'object9', 4: 'rassvet' })[g.q('thread')], mast: 'rassvet',
  };
  const WHERE_HINT = { camp_cellar: 'подвал водокачки в Ржавом Ручье' };
  function npcHome(tpl) {
    for (const [id, L] of Object.entries(DATA.LOCATIONS)) if ((L.npcs || []).some(n => n[0] === tpl)) return L.name;
    return '';
  }
  function questList() {
    const list = [];
    const m = G.quests.meds;
    if (m) list.push({ id: 'meds', title: 'Лекарства для Ручья', giver: 'mihalych', done: m >= 3,
      text: G.hasItem('meds') ? 'Верните ящик медикаментов старосте Михалычу.' : 'Найдите ящик медикаментов на Блокпосту 17 (северо-восток). Его держит банда Клыка.' });
    for (const [id, d] of Object.entries(DATA.QUESTS)) {
      const st = G.q(id);
      if (st) list.push({ id, title: d.title, giver: d.giver, done: st >= 9, text: d.steps[st] || d.steps[1] });
    }
    return list;
  }
  U.openJournal = function (tab = 'active') {
    U.openModal('journal', `<div class="modal" style="width:min(760px,96vw);height:min(560px,100%)">
      <h2>Журнал заданий <button class="close" data-close>✕ [J]</button></h2>
      <div class="cols" style="margin-bottom:8px"><button data-tab="active">Активные</button><button data-tab="done">Завершённые</button></div>
      <div class="screen" style="flex:1" id="jr-list"></div></div>`, root => {
      const draw = () => {
        root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('primary', b.dataset.tab === tab));
        const items = questList().filter(q => (tab === 'done') === q.done);
        root.querySelector('#jr-list').innerHTML = items.map(q => {
          const giver = DATA.NPCS[q.giver];
          const f = SITE_OF[q.id], site = q.done ? null : typeof f === 'function' ? f(G) : f;
          const s = site && DATA.WORLD.sites.find(x => x.id === site);
          const targeted = G.world && G.world.target === site;
          return `<div style="padding:8px 4px;border-bottom:1px dashed #1f3a1a">
            <div class="${q.done ? 'muted' : 'warn'}" style="font-weight:bold">${q.done ? '✔ ' : '► '}${q.title}</div>
            <div class="muted" style="font-size:12px">Выдал: ${giver ? giver.name : '—'}${giver ? ' (' + npcHome(q.giver) + ')' : ''}</div>
            ${q.done ? '' : `<div style="margin:4px 0;line-height:1.4">${q.text}</div>`}
            ${s ? `<div class="cols" style="align-items:center;gap:8px"><span class="good" style="font-size:12px">Где цель: ${s.name}</span>
              <button data-tgt="${site}" style="font-size:11px;padding:1px 8px">${targeted ? '✔ Отмечено на карте' : 'Отметить на карте мира'}</button></div>` : ''}
          </div>`;
        }).join('') || `<div class="muted">${tab === 'done' ? 'Пока ничего не выполнено.' : 'Активных заданий нет. Ищите жителей со значком «!» над головой.'}</div>`;
      };
      root.addEventListener('click', e => {
        const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; draw(); return; }
        const g = e.target.closest('[data-tgt]');
        if (g) { G.world.target = G.world.target === g.dataset.tgt ? null : g.dataset.tgt; WMAP.siteState(G, g.dataset.tgt).known = true; G.hint(G.world.target ? 'Цель отмечена на карте мира' : 'Отметка снята'); draw(); }
      });
      modalRefresh = draw;
      draw();
    });
  };

  U.openCaravan = function (from) {
    const routes = G.caravanRoutes(from);
    const c = G.flags.caravan;
    U.openModal('caravan', `<div class="modal" style="width:min(600px,95vw)">
      <h2>Свой караван <button class="close" data-close>✕</button></h2>
      ${c ? `<div class="screen">Караван в пути: «${DATA.LOCATIONS[c.from].name}» → «${DATA.LOCATIONS[c.to].name}». ${c.escort ? 'Вы сопровождаете его лично.' : `Вернётся через ${Math.max(0, Math.ceil((c.eta - G.time) / 60))} ч. Ожидаемая выручка: ${c.payout} крышек, риск: ${c.risk}%.`}</div>`
        : !routes.length ? '<div class="screen">Пока некуда отправлять: откройте путь к станции «Рассвет».</div>'
        : `<div class="screen">
          <label>Маршрут</label><select id="cv-route" style="width:100%;font-family:var(--font);background:#050a05;color:var(--green);border:1px solid var(--green-dim);padding:4px">${routes.map((r, i) => `<option value="${i}">${DATA.LOCATIONS[from].name} → ${DATA.LOCATIONS[r.to].name} (${r.hours} ч)</option>`).join('')}</select>
          <label>Товар (вложение, крышек)</label><select id="cv-inv" style="width:100%;font-family:var(--font);background:#050a05;color:var(--green);border:1px solid var(--green-dim);padding:4px"><option>100</option><option selected>250</option><option>500</option><option>1000</option></select>
          <label>Охрана (25 крышек за бойца, −12% риска)</label><select id="cv-guard" style="width:100%;font-family:var(--font);background:#050a05;color:var(--green);border:1px solid var(--green-dim);padding:4px"><option value="0">без охраны</option><option value="1">1 охранник</option><option value="2" selected>2 охранника</option></select>
          <div id="cv-quote" class="good" style="margin-top:8px"></div><div class="muted" id="cv-note" style="font-size:12px"></div></div>
          ${NET.active && Object.keys(SOC.party).length ? '<label style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="cv-party" checked> Совместно с отрядом: участники вкладываются, прибыль делится по долям</label>' : ''}
          <div class="cols" style="justify-content:flex-end;margin-top:8px"><button id="cv-escort" data-tip="Без риска и +20% к выручке, но по дороге будет бой">Сопровождать лично</button><button class="primary" id="cv-send">Отправить</button></div>`}
      <div id="cv-msg" class="warn" style="min-height:16px;margin-top:6px"></div></div>`, root => {
      const sel = () => ({ route: routes[+root.querySelector('#cv-route').value], invest: +root.querySelector('#cv-inv').value, guards: +root.querySelector('#cv-guard').value });
      const quote = () => {
        if (!root.querySelector('#cv-route')) return;
        const v = sel(), q = G.caravanQuote(v.route, v.invest, v.guards);
        root.querySelector('#cv-quote').textContent = `Вложение ${v.invest + v.guards * 25} → выручка ≈ ${q.profit} крышек · риск нападения ${q.risk}%`;
        root.querySelector('#cv-note').textContent = v.route.need || `Прибыль растёт с Торговлей, репутацией и опытом караванов (рейсов: ${G.flags.caravanRuns || 0}).`;
      };
      root.addEventListener('change', quote);
      const go = esc => { const v = sel();
        const pc = root.querySelector('#cv-party');
        if (!esc && pc && pc.checked) { const r = SOC.startPartyCaravan(from, v.route, v.invest, v.guards); root.querySelector('#cv-msg').textContent = r || 'Предложение отправлено отряду. Ждём вклады 15 секунд...'; if (!r) setTimeout(() => U.closeModal(), 1500); return; }
        const r = G.sendCaravan(from, v.route, v.invest, esc ? 0 : v.guards, esc); if (r) root.querySelector('#cv-msg').textContent = r; else if (!esc) U.closeModal(); };
      const s = root.querySelector('#cv-send'); if (s) s.onclick = () => go(false);
      const e = root.querySelector('#cv-escort'); if (e) e.onclick = () => go(true);
      quote();
    });
  };

  U.openLeaders = function () {
    U.openModal('leaders', `<div class="modal" style="width:min(620px,95vw)"><h2>Таблица лидеров сервера <button class="close" data-close>✕</button></h2>
      <div class="screen" id="ld-body">Загрузка...</div></div>`, root => {
      NET.onLeaders = list => {
        const el = root.querySelector('#ld-body'); if (!el) return;
        el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr class="warn"><td>#</td><td>Игрок</td><td>Вторжения</td><td>Контракты</td><td>Караваны</td><td>Охрана</td><td>Грабежи</td><td>Убито</td></tr>${list.map((r, i) => `<tr style="${r.name === NET.name ? 'color:#fff' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${r.invasions || 0}</td><td>${r.contracts || 0}</td><td>${r.caravans || 0}</td><td>${r.escorts || 0}</td><td>${r.robberies || 0}</td><td>${r.kills || 0}</td></tr>`).join('')}</table>` + (list.length ? '' : '<div class="muted">Пока пусто.</div>');
      };
      NET.send({ t: 'leaders' });
    });
  };

  U.openDefense = function (loc) {
    const name = DATA.LOCATIONS[loc].name;
    U.openModal('defense', `<div class="modal" style="width:min(560px,94vw)">
      <h2>Оборона: ${name} <button class="close" data-close>✕</button></h2>
      <div class="muted" style="margin-bottom:6px">${NET.active ? 'Укрепления общие для всех игроков сервера.' : 'Укрепления помогают отбивать вторжения.'} Стены: на 1 нападающего меньше за уровень. Турели: каждый раунд боя стреляют по нападающим.</div>
      <div class="screen" id="df-body"></div><div id="df-msg" class="warn" style="margin-top:6px;min-height:16px"></div></div>`, root => {
      const draw = () => {
        const d = G.defense(loc);
        root.querySelector('#df-body').innerHTML = [['walls', 'Стены и заграждения'], ['turrets', 'Пулемётные турели']].map(([k, t]) => {
          const lvl = d[k] || 0, c = G.defenseCost(k, lvl + 1);
          return `<div class="item" style="grid-template-columns:1fr auto;cursor:default"><div><div class="nm">${t}: ${'■'.repeat(lvl)}${'□'.repeat(3 - lvl)} (${lvl}/3)</div>
            <div class="sub">${lvl >= 3 ? 'Максимум' : `Следующий уровень: ${c.junk} хлама, ${c.caps} крышек${c.ammo ? ', ' + c.ammo + ' патронов 7.62' : ''}`}</div></div>
            <div>${lvl >= 3 ? '' : `<button data-df="${k}">Построить</button>`}</div></div>`;
        }).join('');
      };
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-df]'); if (!b) return;
        const r = G.upgradeDefense(loc, b.dataset.df);
        root.querySelector('#df-msg').textContent = r || 'Построено!';
        setTimeout(draw, 300); U.refresh();
      });
      modalRefresh = draw;
      draw();
    });
  };

  U.openCompanion = function () {
    const c = G.companion;
    if (!c) return;
    const SK = ['guns', 'melee', 'medic', 'sneak'];
    U.openModal('companion', `<div class="modal" style="width:min(520px,94vw)">
      <h2>Напарник: ${c.name} <button class="close" data-close>✕</button></h2><div class="screen" id="cp-body"></div></div>`, root => {
      const draw = () => {
        c.level = c.level || 1; c.xp = c.xp || 0; c.freePts = c.freePts || 0;
        root.querySelector('#cp-body').innerHTML = `
          <div class="stat-row"><span>Уровень</span><b>${c.level}</b><span class="muted">${c.xp}/${R.xpForLevel(c.level)}</span></div>
          <div class="stat-row"><span>Очки здоровья</span><b>${c.hp}/${R.maxHP(c)}</b><span></span></div>
          <div class="stat-row"><span>Оружие · броня</span><b style="font-size:11px">${c.weapon ? ITEMS[c.weapon].name : 'кулаки'}</b><span style="font-size:11px">${c.armor ? ITEMS[c.armor].name : '—'}</span></div>
          <div class="warn" style="margin:8px 0 4px">Навыки${c.freePts ? ' · свободных очков: <b>' + c.freePts + '</b> (+4% за очко)' : ''}</div>
          ${SK.map(k => `<div class="stat-row skill-row"><span></span><span>${DATA.SKILLS.find(s => s.id === k).name}</span><b>${R.skill(c, k)}%</b><span class="pm">${c.freePts ? `<button data-cs="${k}">+</button>` : ''}</span></div>`).join('')}
          <div class="muted" style="font-size:11px;margin-top:8px">Напарник получает 60% вашего опыта. Каждый уровень: +3 очка навыков и +5 ОЗ.</div>`;
      };
      root.addEventListener('click', e => { const b = e.target.closest('[data-cs]'); if (b) { G.companionSkillUp(b.dataset.cs); draw(); } });
      draw();
    });
  };

  // эпилог финала и титры
  U.openEpilogue = function (slides) {
    let i = 0;
    U.openModal('epilogue', `<div class="title-screen" style="max-width:640px;margin:auto">
      <div id="ep-body"></div>
      <button class="primary" id="ep-next" style="margin-top:20px">Далее</button></div>`, root => {
      const body = root.querySelector('#ep-body'), next = root.querySelector('#ep-next');
      const draw = () => {
        if (i < slides.length) {
          const [h, t] = slides[i];
          body.innerHTML = `<div class="sub" style="margin-bottom:6px">ЭПИЛОГ · ${i + 1} / ${slides.length}</div><h1 style="font-size:30px">${h}</h1>
            <p style="color:var(--green);font-size:16px;line-height:1.6;margin-top:18px">${t}</p>`;
          next.textContent = i === slides.length - 1 ? 'Титры' : 'Далее';
        } else {
          body.innerHTML = `<div class="credits-wrap"><div class="credits-roll">
            <h1>ПУСТОШЬ</h1><div class="sub">постъядерная ролевая игра</div>
            <p class="cr-h">Автор и разработка</p><p>egorqqa</p>
            <p class="cr-h">Сюжет и диалоги</p><p>egorqqa</p>
            <p class="cr-h">Графика и звук</p><p>egorqqa</p>
            <p class="cr-h">Сетевая игра</p><p>egorqqa</p>
            <p class="cr-h">Тестирование</p><p>все, кто дошёл до этих строк</p>
            <p class="cr-h">Спасибо</p><p>друзьям, игравшим по сети,<br>и каждому, кто не бросил пустошь</p>
            <h1 style="font-size:22px;margin-top:40px">КОНЕЦ</h1><div class="sub">...но пустошь живёт дальше</div>
          </div></div>`;
          next.textContent = 'Продолжить свободную игру';
          SND.play('quest');
        }
      };
      next.onclick = () => { if (i >= slides.length) { U.closeModal(); return; } i++; draw(); };
      draw();
    }, { full: true });
  };

  U.openRespawn = function () {
    U.openModal('dead', `<div class="title-screen"><h1 style="color:#ff5a3c">ВЫ ПОГИБЛИ</h1><div class="sub">Пустошь забирает своё... но не насовсем.</div>
      <button class="primary" id="r-go">Очнуться в Ржавом Ручье</button></div>`, root => {
      root.querySelector('#r-go').onclick = () => { U.closeModal(); G.respawn(); };
    }, { full: true });
  };

  U.openDisconnected = function () {
    U.openModal('dead', `<div class="title-screen"><h1 style="font-size:32px">СВЯЗЬ ПОТЕРЯНА</h1><div class="sub">Соединение с сервером разорвано. Персонаж сохранён.</div>
      <button class="primary" id="d-menu">В главное меню</button></div>`, root => {
      root.querySelector('#d-menu').onclick = () => location.reload();
    }, { full: true });
  };

  U.openChat = function () {
    const inp = $('#chat-input');
    if (U.hideDialog && !$('#dialog-box').classList.contains('hidden')) return;
    inp.classList.remove('hidden');
    inp.value = '';
    inp.focus();
  };

  U.openDead = function (onLoad, onNew) {
    U.openModal('dead', `<div class="title-screen"><h1 style="color:#ff5a3c">ВЫ ПОГИБЛИ</h1><div class="sub">Пустошь забирает своё.</div>
      <button class="primary" id="d-load">Загрузить сохранение</button><button id="d-new">Новая игра</button></div>`, root => {
      root.querySelector('#d-load').onclick = onLoad;
      root.querySelector('#d-new').onclick = onNew;
    }, { full: true });
  };

  return U;
})();
