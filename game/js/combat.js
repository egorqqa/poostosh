// Пошаговый бой с очками действия.
// В сетевой игре бой ведёт «ведущий» клиент локации; остальные шлют ему запросы (NET.req).
window.COMBAT = (function () {
  const { ITEMS } = DATA;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const C = {};
  const net = () => window.NET && NET.active;
  const isAuth = () => !net() || NET.isAuth;
  const isPC = a => !!(a && (a.isPlayer || a.isRemote));
  const isAlly = a => !!(a && (a.isPlayer || a.isRemote || a.isCompanion));

  function players(G) { return G.loc.actors.filter(a => isAlly(a) && !a.dead && !a.gone); }
  function nearestPC(G, a) {
    let best = null, bd = 1e9;
    for (const p of players(G)) { const d = ENG.dist(a, p); if (d < bd) { bd = d; best = p; } }
    return { p: best, d: bd };
  }
  function involved(G, a, initiator) {
    if (a.dead || a.gone || isAlly(a) || !a.hostile) return false;
    const d = nearestPC(G, a).d;
    return a.alerted || d <= 16 || (initiator && a.faction === initiator.faction && d <= 24);
  }

  // first: персонаж, который ходит первым (true — локальный игрок)
  C.start = function (G, initiator, first) {
    if (!isAuth()) { NET.req({ act: 'combat', npc: initiator ? initiator.id : null, first: !!first }); return; }
    if (first === true) first = G.player;
    const L = G.loc;
    if (G.combat) { C.join(G); return; }
    for (const a of L.actors) a.path = [];
    const list = [...players(G), ...L.actors.filter(a => involved(G, a, initiator))];
    list.forEach(a => a.seq = R.sequence(a) + R.rnd(0, 4));
    list.sort((a, b) => b.seq - a.seq);
    if (first && list.includes(first)) { list.splice(list.indexOf(first), 1); list.unshift(first); }
    for (const a of list) if (!isPC(a)) a.alerted = true;
    if (G.companion) G.companionEquip(false);
    G.combat = {
      list, idx: -1, round: 1, current: null, busy: false,
      isPlayerTurn() { return this.current === G.player; },
      spend(n) {
        if (!G.combat) return true;
        if (!this.isPlayerTurn() || G.player.ap < n) return false;
        G.player.ap -= n; UI.refresh(); return true;
      },
    };
    G.sneaking = false;
    G.log('=== БОЙ! ===', 'warn');
    SND.setCombat(true); TUT.mark('combat');
    UI.setMode('move');
    UI.refresh();
    C.nextTurn(G);
  };

  C.join = function (G) {
    const cb = G.combat;
    if (!cb || cb.mirror) return;
    for (const a of G.loc.actors) {
      if (cb.list.includes(a)) continue;
      if (involved(G, a) || (isAlly(a) && !a.dead && !a.gone)) { if (!isPC(a)) a.alerted = true; cb.list.push(a); }
    }
  };

  function hostilesLeft(G) {
    return G.combat.list.filter(a => !isAlly(a) && !a.dead && !a.gone && a.hostile);
  }

  C.end = function (G, msg) {
    if (!G.combat) return;
    clearTimeout(G.combat.remoteTimer);
    for (const a of G.combat.list) { a.crippled = false; a.stunned = false; }
    G.combat = null;
    G.player.ap = R.maxAP(G.player);
    G.log(msg || 'Бой окончен.', 'warn');
    const cmp = G.companion;
    if (cmp && !cmp.dead && cmp.tpl === 'lada') {
      const h = 6 + Math.floor(R.skill(cmp, 'medic') / 10), p = G.player;
      if (p.hp < R.maxHP(p)) { p.hp = Math.min(R.maxHP(p), p.hp + h); G.log(`Лада перевязывает вас после боя: +${h} ОЗ.`, 'good'); }
      cmp.hp = Math.min(R.maxHP(cmp), cmp.hp + 4);
    }
    SND.setCombat(false);
    if (net()) NET.forceSnap();
    UI.setMode('move');
    UI.refresh();
  };

  C.nextTurn = async function (G) {
    const cb = G.combat;
    if (!cb || cb.mirror) return;
    if (G.player.dead && !net()) return;
    C.join(G);
    const foes = hostilesLeft(G);
    if (!foes.length) { C.end(G, 'Бой окончен. Врагов не осталось.'); return; }
    if (!cb.list.some(a => isPC(a) && !a.dead && !a.gone && G.loc.actors.includes(a))) { C.end(G, 'Бой окончен.'); return; }
    cb.idx++;
    if (cb.idx >= cb.list.length) { cb.idx = 0; cb.round++; turretsFire(G); if (!G.combat) return; }
    const a = cb.list[cb.idx];
    if (a.dead || a.gone || (!isAlly(a) && !a.hostile) || !G.loc.actors.includes(a) && a !== G.player) return C.nextTurn(G);
    cb.current = a;
    a.ap = R.maxAP(a);
    if (a.stunned) { a.stunned = false; a.ap = Math.ceil(a.ap / 2); G.log(`${a.name} оглушён и теряет половину ОД.`, 'good'); }
    if (net()) NET.forceSnap();
    if (isPC(a) && cb.round > 1 && !anyoneSeen(G, foes)) {
      C.end(G, 'Враги потеряли вас из виду. Бой окончен.');
      return;
    }
    if (a.isPlayer) {
      cb.busy = false;
      C.checkFlee(G);
      UI.refresh();
      return;
    }
    if (a.isRemote) {
      cb.busy = false;
      NET.event(a.pid, { kind: 'turn', ap: a.ap });
      clearTimeout(cb.remoteTimer);
      cb.remoteTimer = setTimeout(() => { if (G.combat === cb && cb.current === a) C.endTurnOf(G, a); }, 45000);
      UI.refresh();
      return;
    }
    cb.busy = true;
    UI.refresh();
    await sleep(250);
    try { await ai(G, a); } catch (e) { console.error(e); }
    if (G.combat !== cb) return;
    await sleep(200);
    C.nextTurn(G);
  };

  // видит ли хоть один враг хоть одного игрока
  function anyoneSeen(G, foes) {
    const pcs = G.combat.list.filter(p => isPC(p) && !p.dead && !p.gone && (p === G.player || G.loc.actors.includes(p)));
    return foes.some(f => pcs.some(p => ENG.dist(f, p) <= WORLD_API.detectRadius(f) + 4 && ENG.los(G.loc, f.x, f.y, p.x, p.y)));
  }

  // в начале своего хода: стоит в зоне выхода и не получал урона с конца прошлого хода — можно уйти
  C.checkFlee = function (G) {
    const cb = G.combat, p = G.player;
    cb.canFlee = !!(cb.playerActed && WORLD_API.isExit(G.loc, p.x, p.y) && !p.damagedSinceTurn);
    if (cb.canFlee) G.log('Вы у выхода, и вас не задело — можно уйти из боя на карту: кнопка «Карта» или клик по зелёной зоне.', 'good');
  };
  function playerTurnEnds(G) {
    const cb = G.combat;
    G.player.damagedSinceTurn = false;
    if (cb) { cb.playerActed = true; cb.canFlee = false; }
  }

  // турели поселения бьют по нападающим в начале каждого раунда
  function turretsFire(G) {
    const t = G.defense ? G.defense(G.loc.id).turrets || 0 : 0;
    if (!t) return;
    for (let i = 0; i < t; i++) {
      const foes = G.loc.actors.filter(a => a.invader && !a.dead && !a.gone);
      if (!foes.length) break;
      const f = foes[Math.floor(Math.random() * foes.length)];
      const dmg = R.rnd(6, 12);
      f.hp -= dmg; f.hitFlash = 0.15; f.shakeT = 0.25;
      ENG.floater(f.x, f.y, '-' + dmg, '#ffcf40'); SND.at('shot', f.x, f.y, { weapon: 'ak' });
      G.log(`Турель поселения попадает в: ${f.name} −${dmg} ОЗ.`, 'good');
      if (net()) NET.fx({ type: 'log', text: `Турель поселения попадает в: ${f.name} −${dmg} ОЗ.`, cls: 'good' });
      if (f.hp <= 0) kill(G, f, null);
    }
    if (!hostilesLeft(G).length) C.end(G, 'Турели добили последнего врага.');
  }

  C.endTurnOf = function (G, a) {
    const cb = G.combat;
    if (!cb || cb.mirror || cb.current !== a) return;
    if (a.isPlayer && cb.busy) return;
    if (a.isPlayer) playerTurnEnds(G);
    clearTimeout(cb.remoteTimer);
    cb.busy = true;
    C.nextTurn(G);
  };

  C.endPlayerTurn = function (G) {
    const cb = G.combat;
    if (!cb || !cb.isPlayerTurn() || cb.busy) return;
    if (cb.mirror) { playerTurnEnds(G); cb.busy = true; NET.req({ act: 'end' }); return; }
    C.endTurnOf(G, G.player);
  };

  // ---------- расчёты ----------
  C.aimCost = aim => (DATA.AIM[aim] || DATA.AIM.torso).ap;
  C.hitChance = function (G, att, def, aim = 'torso') {
    const w = R.weaponOf(att);
    const d = ENG.dist(att, def);
    if (d > w.range) return 0;
    if (!w.melee && !ENG.los(G.loc, att.x, att.y, def.x, def.y)) return 0;
    let ch = R.skill(att, w.melee ? 'melee' : 'guns') + 15 - R.AC(def);
    if (!w.melee) ch -= Math.max(0, d - att.stats.per + 1) * 3;
    if (!w.melee && d > 5) ch -= Math.round(12 * G.nightK()); // ночью вдаль стрелять труднее
    if (!def.alerted && !isPC(def)) ch += 20;
    const A = DATA.AIM[aim] || DATA.AIM.torso;
    if (A.pen) ch -= Math.max(0, A.pen - (R.has(att, 'sniper') ? 10 : 0));
    return R.clamp(Math.round(ch), 5, 95);
  };

  // отображение атаки (локально и у других игроков)
  C.showAttack = function (G, ev) {
    if (ev.type === 'log') { G.log(ev.text, ev.cls); return; }
    const att = NET.resolve ? NET.resolve(ev.att) : null, def = NET.resolve ? NET.resolve(ev.def) : null;
    if (!att || !def) return;
    const me = G.player;
    att.dir = ENG.dirFromDelta(def.x - att.x, def.y - att.y);
    att.dir8 = ENG.dir8FromDelta(def.x - att.x, def.y - att.y);
    att.aimT = 0.45;
    if (ev.melee) ENG.swing(att, def); else { ENG.tracer(att, def, ev.hit); ENG.muzzle(att, def); }
    { const s = ENG.iso(att.x - def.x, att.y - def.y), l = Math.hypot(s.x, s.y) || 1; att.recoilX = s.x / l; att.recoilY = s.y / l; att.recoilT = 0.14; }
    if (ev.hit) { def.shakeT = 0.25; ENG.blood(def, ev.crit ? 14 : 7); }
    const w = DATA.ITEMS[att.weapon || 'fists'];
    if (ev.melee) SND.at('swing', att.x, att.y); else SND.at('shot', att.x, att.y, { weapon: w.icon === 'ak' ? 'ak' : w.icon });
    setTimeout(() => ev.hit ? SND.at('hit', def.x, def.y) : (!ev.melee && SND.at('miss', def.x, def.y)), ev.melee ? 120 : 160);
    const an = att === me ? 'Вы' : att.name;
    if (ev.hit) {
      def.hitFlash = 0.15;
      ENG.floater(def.x, def.y, (ev.crit ? 'КРИТ! ' : '') + '-' + ev.dmg, ev.crit ? '#ffcf40' : '#ff5a3c');
      const aimTxt = ev.aim && ev.aim !== 'torso' ? ` [${DATA.AIM[ev.aim].name.toLowerCase()}]` : '';
      G.log(`${an} ${att === me ? 'попадаете' : 'попадает'} ${def === me ? 'в вас' : 'в: ' + def.name}${aimTxt}${ev.sneak ? ' (из скрытности)' : ''}${ev.crit ? ' — критическое!' : ''} −${ev.dmg} ОЗ (${ev.chance}%).${ev.effect ? ' ' + def.name + ': ' + ev.effect + '!' : ''}`, def === me ? 'bad' : att === me ? 'good' : 'sys');
      if (ev.effect) ENG.floater(def.x, def.y + 0.6, ev.effect, '#ffd040');
    } else {
      ENG.floater(def.x, def.y, 'Мимо', '#d9cfb5');
      G.log(`${an} ${att === me ? 'промахиваетесь' : 'промахивается'} (${ev.chance}%).`, 'sys');
    }
    if (ev.killed && def !== me) G.log(`${def.name} убит.`, 'warn');
  };

  async function attack(G, att, def, aim = 'torso') {
    const w = R.weaponOf(att);
    const A = DATA.AIM[aim] || DATA.AIM.torso;
    const chance = C.hitChance(G, att, def, aim);
    att.ap -= w.ap + A.ap;
    att.dir = ENG.dirFromDelta(def.x - att.x, def.y - att.y);
    att.aimT = 0.45;
    await sleep(180);
    const sneak = !def.alerted && !isPC(def);
    const hit = R.rnd(1, 100) <= chance;
    if (!w.melee) {
      att.loaded--;
      if (att.isRemote) NET.event(att.pid, { kind: 'ammo' });
    }
    const ev = { type: 'attack', att: att.id, def: def.id, hit, chance, melee: !!w.melee, sneak, dmg: 0, crit: false, killed: false, aim, effect: '' };
    if (hit) {
      const critCh = (isPC(att) ? R.critChance(att) : Math.floor(R.critChance(att) / 2)) + (w.crit || 0) + (sneak ? 30 : 0) + (aim === 'head' ? 25 : 0);
      const crit = R.rnd(1, 100) <= critCh;
      let dmg = R.rnd(w.dmg[0], w.dmg[1]) + (w.melee ? R.meleeBonus(att) : 0);
      if (aim === 'head') dmg = Math.round(dmg * 1.25);
      const dt = crit ? Math.floor(R.DT(def) / 2) : R.DT(def);
      if (crit) dmg = Math.round(dmg * (sneak ? 2.5 : 1.5));
      dmg = Math.max(1, Math.round((dmg - dt) * (1 - R.DR(def) / 100)));
      def.hp -= dmg;
      ev.dmg = dmg; ev.crit = crit;
      if (def.isRemote) { def.hpLock = Date.now() + 1500; NET.event(def.pid, { kind: 'hit', dmg }); }
      if (def.isPlayer) def.damagedSinceTurn = true;
      if (def.hp <= 0) ev.killed = true;
      // эффекты прицельных выстрелов
      if (!ev.killed && !isPC(def)) {
        if (aim === 'head' && (crit || (R.has(att, 'sniper') && R.rnd(1, 100) <= 35))) { def.stunned = true; ev.effect = 'оглушён'; }
        if (aim === 'legs' && !def.crippled) { def.crippled = true; ev.effect = 'хромает (−2 ОД)'; }
        if (aim === 'arms' && def.weapon && (crit || R.rnd(1, 100) <= 40)) {
          R.addItem(def, def.weapon, 1);
          const dw = ITEMS[def.weapon];
          if (dw.ammo && def.loaded > 0) R.addItem(def, dw.ammo, def.loaded);
          def.weapon = null; def.loaded = 0; ev.effect = 'выронил оружие';
          NET.syncEnt(def);
        }
      }
    }
    C.showAttack(G, ev);
    if (net()) NET.fx(ev);
    if (ev.killed) kill(G, def, att);
    // атакованный и его союзники становятся враждебными
    if (isPC(att) && !isPC(def) && !def.hostile && !def.dead) {
      def.hostile = true;
      for (const a of G.loc.actors) if (!a.dead && !isPC(a) && a.guard && a.faction === def.faction) { a.hostile = true; a.alerted = true; NET.syncEnt(a); }
      NET.syncEnt(def);
      C.join(G);
    }
    for (const a of G.loc.actors) if (!a.dead && !isPC(a) && a.hostile && ENG.dist(a, att) < 18) a.alerted = true;
    def.alerted = true;
    UI.refresh();
    await sleep(380);
  }

  function kill(G, a, by) {
    a.dead = true;
    a.hp = 0;
    a.moving = false;
    a.path = [];
    if (a.isPlayer) { G.gameOver(); return; }
    if (a.isRemote) { NET.event(a.pid, { kind: 'died' }); return; }
    if (a.isCompanion) { a.isCompanion = false; G.companion = null; G.log(`Ваш напарник ${a.name} погиб.`, 'bad'); SND.play('death'); }
    // оружие и броня падают в лут
    if (a.weapon && ITEMS[a.weapon].hidden) a.weapon = null;
    if (a.weapon) {
      R.addItem(a, a.weapon, 1);
      const w = ITEMS[a.weapon];
      if (w.ammo && a.loaded > 0) R.addItem(a, w.ammo, a.loaded);
      a.weapon = null;
    }
    if (a.armor) { R.addItem(a, a.armor, 1); a.armor = null; }
    if (by && by.isPlayer) { G.giveXP(a.xpValue || 25); if (net()) NET.send({ t: 'stat', k: 'kills' }); }
    if (by && by.isRemote) NET.event(by.pid, { kind: 'xp', n: a.xpValue || 25 });
    if (a.tpl === 'klyk') G.flags.klykDead = true;
    if (a.tpl === 'marauder') G.flags.marauderKilled = true;
    if (a.tpl === 'mytar') G.openBridge();
    if (a.tpl === 'borey' && !G.flags.northEnd) G.northEnd('killed');
    if (a.tpl === 'zno' && !G.flags.westEnd) { G.flags.westEnd = 'storm'; if (G.q('west') === 2) G.log('Атаман пал. Сердечник — на складе пустынников.', 'good'); }
    const cv = G.flags.caravan;
    if (cv && cv.escort && cv.inFight === G.loc.id && !G.loc.actors.some(x => x.hostile && !x.dead && !x.gone && x !== a)) setTimeout(() => G.caravanDone(true, 'Нападение отбито, караван дошёл!'), 400);
    if (a.tpl === 'rzha' && !G.flags.southDone) G.southEnd('storm');
    if (a.invader && G.loc && !G.loc.actors.some(x => x.invader && !x.dead)) G.invasionCleared();
    if (a.tpl === 'klyk_city') { G.flags.klykCityDead = true; if (G.q('column') >= 1 && G.q('column') < 4) G.setQuest('column', 4); }
    if (a.tpl === 'granit') { G.flags.granitDead = true; if (G.q('column') < 9) G.columnEnd('exposed'); }
    if (window.SOC && by && by.isPlayer) SOC.onKill(a);
    if (a.faction === 'town' && by && by.isPlayer) G.addRep(-40, `убит ${a.name}`);
    NET.syncEnt(a);
  }
  C.kill = kill;

  function reload(G, a) {
    const w = R.weaponOf(a);
    if (!w.mag) return false;
    const have = R.count(a, w.ammo);
    const need = w.mag - a.loaded;
    if (!have || need <= 0) return false;
    const n = Math.min(have, need);
    R.removeItem(a, w.ammo, n);
    a.loaded += n;
    return true;
  }

  C.reload = function (G) {
    const p = G.player, w = R.weaponOf(p);
    if (!w.mag) { G.hint('Это оружие не нужно заряжать'); return; }
    if (p.loaded >= w.mag) { G.hint('Магазин полон'); return; }
    if (!R.count(p, w.ammo)) { G.log(`Нет патронов: ${ITEMS[w.ammo].name}.`, 'bad'); return; }
    const rc = R.has(p, 'quick') ? 1 : 2;
    if (G.combat && !G.combat.spend(rc)) { G.log(`Нужно ${rc} ОД для перезарядки.`, 'warn'); return; }
    reload(G, p);
    SND.play('reload');
    G.log(`Перезарядка: ${p.loaded}/${w.mag}.`, 'sys');
    UI.refresh();
    autoEnd(G, p);
  };

  // ---------- действия ----------
  function stepTo(G, a, cell) {
    return new Promise(r => WORLD_API.moveTo(G, a, [cell], r));
  }

  // передвижение участника боя (на стороне ведущего)
  C.actorWalk = async function (G, a, path, cb, noAutoEnd) {
    const c = G.combat;
    if (!c || c.mirror || c.current !== a || c.busy) return;
    if (a.isPlayer && R.overloaded(a)) { G.log('Перегруз! Двигаться невозможно.', 'bad'); return; }
    const steps = path.slice(0, a.ap);
    if (!steps.length) { if (a.isPlayer) G.hint('Не хватает ОД'); return; }
    c.busy = true;
    for (const cell of steps) {
      if (Math.max(Math.abs(cell.x - a.x), Math.abs(cell.y - a.y)) !== 1 || !ENG.passable(G.loc, cell.x, cell.y, a)) break;
      await stepTo(G, a, cell);
      a.ap--;
      UI.refresh();
      if (G.combat !== c) return;
    }
    c.busy = false;
    if (cb) cb();
    if (!noAutoEnd) autoEnd(G, a);
  };

  C.playerWalk = function (G, path, cb) {
    const c = G.combat, p = G.player;
    if (!c || !c.isPlayerTurn() || c.busy) return;
    if (c.mirror) {
      if (R.overloaded(p)) { G.log('Перегруз! Двигаться невозможно.', 'bad'); return; }
      const steps = path.slice(0, p.ap);
      if (!steps.length) { G.hint('Не хватает ОД'); return; }
      c.busy = true; c.onAck = cb || null;
      NET.req({ act: 'move', path: steps });
      return;
    }
    return C.actorWalk(G, p, path, cb);
  };

  // атака участником боя; возвращает строку-ошибку или undefined
  C.actorAttack = async function (G, a, target, aim = 'torso') {
    if (!DATA.AIM[aim]) aim = 'torso';
    const extra = C.aimCost(aim);
    if (!G.combat) C.start(G, target, a);
    const c = G.combat;
    if (!c || c.mirror || c.current !== a || c.busy) return;
    const w = R.weaponOf(a);
    if (!w.melee && w.mag && a.loaded <= 0) return 'Магазин пуст.';
    const d = ENG.dist(a, target);
    if (w.melee && d > 1) {
      const path = ENG.findPath(G.loc, a.x, a.y, target.x, target.y, { adjacent: true, ignore: a });
      if (!path) return 'Не подойти.';
      if (path.length + w.ap + extra > a.ap) return `Нужно ${path.length + w.ap + extra} ОД (подойти и ударить).`;
      await C.actorWalk(G, a, path, null, true);
      if (G.combat !== c) return;
    } else if (d > w.range) return `Слишком далеко: дальность ${w.range}, до цели ${d}.`;
    if (!w.melee && !ENG.los(G.loc, a.x, a.y, target.x, target.y)) return 'Цель вне линии огня.';
    if (a.ap < w.ap + extra) return `Не хватает ОД: нужно ${w.ap + extra}.`;
    c.busy = true;
    await attack(G, a, target, aim);
    if (G.combat !== c) return;
    c.busy = false;
    if (!hostilesLeft(G).length) { C.end(G, 'Победа! Врагов не осталось.'); return; }
    autoEnd(G, a);
  };

  C.playerAttack = async function (G, target) {
    const p = G.player;
    const w = R.weaponOf(p);
    if (G.combat && !G.combat.isPlayerTurn()) return;
    if (G.combat && G.combat.busy) return;
    if (!w.melee && w.mag && p.loaded <= 0) {
      if (R.count(p, w.ammo)) { G.log('Магазин пуст — перезарядка (2 ОД).', 'warn'); if (G.combat) C.reload(G); else { reload(G, p); UI.refresh(); } }
      else G.log('Нет патронов! Смените оружие (инвентарь) или бейте кулаками.', 'bad');
      return;
    }
    if (!G.combat && !target.alerted && G.sneaking) G.log('Атака из скрытности!', 'good');
    if (!isAuth()) {
      if (G.combat) { G.combat.busy = true; }
      NET.req({ act: 'attack', target: target.id, aim: G.ui.aim || 'torso' });
      return;
    }
    const err = await C.actorAttack(G, p, target, G.ui.aim || 'torso');
    if (err) G.log(err, 'warn');
  };

  function autoEnd(G, a = G.player) {
    const c = G.combat;
    if (!c || c.mirror) {
      if (c && c.mirror && c.isPlayerTurn() && !c.busy && G.player.ap <= 0) setTimeout(() => C.endPlayerTurn(G), 350);
      return;
    }
    if (c.current === a && !c.busy && a.ap <= 0) setTimeout(() => C.endTurnOf(G, a), 350);
  }
  C.autoEnd = autoEnd;

  // ---------- ИИ ----------
  const NO_FLEE = ['klyk', 'klyk_city', 'granit', 'granit_obs', 'zorin', 'hive_queen', 'rzha', 'zno', 'scav_boss', 'mytar', 'infected', 'infected_brute', 'z_soldier', 'z_officer'];
  async function ai(G, a) {
    let guard = 30;
    while (a.ap > 0 && guard-- > 0 && !a.dead && G.combat) {
      let p;
      if (a.isCompanion) {
        let bd = 1e9;
        for (const f of G.combat.list) if (!isAlly(f) && f.hostile && !f.dead && !f.gone) { const d = ENG.dist(a, f); if (d < bd) { bd = d; p = f; } }
      } else p = nearestPC(G, a).p;
      if (!p) break;
      const w = R.weaponOf(a);
      // при здоровье меньше 15% — бегство в сторону от врага (кроме боссов и напарника)
      if (!a.isCompanion && a.hp < R.maxHP(a) * 0.15 && !NO_FLEE.includes(a.tpl) && !R.count(a, 'medkit')) {
        if (!a.fleeing) { a.fleeing = true; a.bubble = { text: 'Бежим!', t: 1.6, color: '#f0b43c' }; G.log(`${a.name} в панике отступает!`, 'warn'); if (net()) NET.fx({ type: 'log', text: `${a.name} в панике отступает!`, cls: 'warn' }); }
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        let best = null, bd = ENG.dist(a, p);
        for (const [dx, dy] of dirs) {
          const nx = a.x + dx, ny = a.y + dy;
          if (!ENG.passable(G.loc, nx, ny, a)) continue;
          const d = Math.max(Math.abs(nx - p.x), Math.abs(ny - p.y));
          if (d > bd) { bd = d; best = { x: nx, y: ny }; }
        }
        if (!best) break;
        await stepTo(G, a, best);
        a.ap--;
        const edge = best.x <= 0 || best.y <= 0 || best.x >= G.loc.w - 1 || best.y >= G.loc.h - 1;
        if (edge || (bd > 13 && !ENG.los(G.loc, a.x, a.y, p.x, p.y))) {
          a.gone = true; G.log(`${a.name} сбегает с поля боя.`, 'sys');
          if (net()) { NET.syncEnt(a); NET.fx({ type: 'log', text: `${a.name} сбегает с поля боя.`, cls: 'sys' }); }
          break;
        }
        continue;
      }
      if (a.hp < R.maxHP(a) * 0.35 && R.count(a, 'medkit') && a.ap >= 2) {
        R.removeItem(a, 'medkit', 1);
        const h = 15;
        a.hp = Math.min(R.maxHP(a), a.hp + h);
        a.ap -= 2;
        ENG.floater(a.x, a.y, '+' + h, '#9dff8a');
        G.log(`${a.name} использует аптечку.`, 'sys');
        if (net()) NET.fx({ type: 'log', text: `${a.name} использует аптечку.`, cls: 'sys' });
        await sleep(400);
        continue;
      }
      if (!w.melee && w.mag && a.loaded <= 0) {
        if (R.count(a, w.ammo) && a.ap >= 2) { reload(G, a); a.ap -= 2; await sleep(300); continue; }
        R.addItem(a, a.weapon, 1); a.weapon = null; continue; // кулаки
      }
      const d = ENG.dist(a, p);
      const canHit = d <= w.range && (w.melee || ENG.los(G.loc, a.x, a.y, p.x, p.y));
      if (canHit) {
        if (a.ap >= w.ap) { await attack(G, a, p); if (p.isPlayer && p.dead) break; continue; }
        break;
      }
      const path = ENG.findPath(G.loc, a.x, a.y, p.x, p.y, { adjacent: true, ignore: a, maxLen: 60 });
      if (!path || !path.length) break;
      await stepTo(G, a, path[0]);
      a.ap--;
    }
  }

  return C;
})();
