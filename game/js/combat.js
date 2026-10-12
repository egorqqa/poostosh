// Пошаговый бой с очками действия
window.COMBAT = (function () {
  const { ITEMS } = DATA;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const C = {};

  function involved(G, a, initiator) {
    if (a.dead || a.gone || a.isPlayer || !a.hostile) return false;
    return a.alerted || ENG.dist(a, G.player) <= 16 || (initiator && a.faction === initiator.faction && ENG.dist(a, G.player) <= 24);
  }

  C.start = function (G, initiator, playerFirst) {
    const L = G.loc;
    if (G.combat) { C.join(G); return; }
    G.player.path = [];
    for (const a of L.actors) a.path = a.isPlayer ? [] : a.path;
    const list = [G.player, ...L.actors.filter(a => involved(G, a, initiator))];
    for (const a of list) if (!a.isPlayer) { a.path = []; }
    list.forEach(a => a.seq = R.sequence(a) + R.rnd(0, 4));
    list.sort((a, b) => b.seq - a.seq);
    if (playerFirst) { list.splice(list.indexOf(G.player), 1); list.unshift(G.player); }
    const cb = {
      list, idx: -1, round: 1, current: null, busy: false,
      isPlayerTurn() { return this.current === G.player; },
      spend(n) {
        if (!G.combat) return true;
        if (!this.isPlayerTurn() || G.player.ap < n) return false;
        G.player.ap -= n; UI.refresh(); return true;
      },
    };
    G.combat = cb;
    G.sneaking = false;
    G.log('=== БОЙ! ===', 'warn');
    UI.setMode('move');
    UI.refresh();
    C.nextTurn(G);
  };

  C.join = function (G) {
    const cb = G.combat;
    for (const a of G.loc.actors) if (!cb.list.includes(a) && involved(G, a)) { a.alerted = true; cb.list.push(a); }
  };

  function hostilesLeft(G) {
    return G.combat.list.filter(a => !a.isPlayer && !a.dead && !a.gone && a.hostile);
  }

  C.end = function (G, msg) {
    if (!G.combat) return;
    G.combat = null;
    G.player.ap = R.maxAP(G.player);
    G.log(msg || 'Бой окончен.', 'warn');
    UI.setMode('move');
    UI.refresh();
  };

  C.nextTurn = async function (G) {
    const cb = G.combat;
    if (!cb) return;
    if (G.player.dead) return;
    C.join(G);
    const foes = hostilesLeft(G);
    if (!foes.length) { C.end(G, 'Бой окончен. Врагов не осталось.'); return; }
    cb.idx++;
    if (cb.idx >= cb.list.length) { cb.idx = 0; cb.round++; }
    const a = cb.list[cb.idx];
    if (a.dead || a.gone || (!a.isPlayer && !a.hostile)) return C.nextTurn(G);
    cb.current = a;
    a.ap = R.maxAP(a);
    if (a.isPlayer) {
      if (foes.every(f => ENG.dist(f, a) > 22)) { C.end(G, 'Вы оторвались от преследования.'); return; }
      cb.busy = false;
      UI.refresh();
      return;
    }
    cb.busy = true;
    UI.refresh();
    await sleep(250);
    try { await ai(G, a); } catch (e) { console.error(e); }
    if (!G.combat) return;
    await sleep(200);
    C.nextTurn(G);
  };

  C.endPlayerTurn = function (G) {
    const cb = G.combat;
    if (!cb || !cb.isPlayerTurn() || cb.busy) return;
    cb.busy = true;
    C.nextTurn(G);
  };

  // ---------- расчёты ----------
  C.hitChance = function (G, att, def) {
    const w = R.weaponOf(att);
    const d = ENG.dist(att, def);
    if (d > w.range) return 0;
    if (!w.melee && !ENG.los(G.loc, att.x, att.y, def.x, def.y)) return 0;
    let ch = R.skill(att, w.melee ? 'melee' : 'guns') + 15 - R.AC(def);
    if (!w.melee) ch -= Math.max(0, d - att.stats.per + 1) * 3;
    if (!def.alerted && !def.isPlayer) ch += 20;
    return R.clamp(Math.round(ch), 5, 95);
  };

  function unawareCrit(def) { return !def.alerted && !def.isPlayer ? 30 : 0; }

  async function attack(G, att, def) {
    const w = R.weaponOf(att);
    const chance = C.hitChance(G, att, def);
    att.ap -= w.ap;
    att.dir = ENG.dirFromDelta(def.x - att.x, def.y - att.y);
    att.aimT = 0.45;
    await sleep(180);
    const sneakAttack = !def.alerted && !def.isPlayer;
    const roll = R.rnd(1, 100);
    const hit = roll <= chance;
    if (!w.melee) { att.loaded--; ENG.tracer(att, def, hit); } else ENG.swing(att, def);
    G.sound && G.sound(w.melee ? 'swing' : 'shot');
    if (hit) {
      const critCh = (att.isPlayer ? R.critChance(att) : Math.floor(R.critChance(att) / 2)) + (w.crit || 0) + unawareCrit(def);
      const crit = R.rnd(1, 100) <= critCh;
      let dmg = R.rnd(w.dmg[0], w.dmg[1]) + (w.melee ? R.meleeBonus(att) : 0);
      const dt = crit ? Math.floor(R.DT(def) / 2) : R.DT(def);
      if (crit) dmg = Math.round(dmg * (sneakAttack ? 2.5 : 1.5));
      dmg = Math.max(1, Math.round((dmg - dt) * (1 - R.DR(def) / 100)));
      def.hp -= dmg;
      def.hitFlash = 0.15;
      ENG.floater(def.x, def.y, (crit ? 'КРИТ! ' : '') + '-' + dmg, crit ? '#ffcf40' : '#ff5a3c');
      G.log(`${att.isPlayer ? 'Вы попадаете' : att.name + ' попадает'} ${def.isPlayer ? 'в вас' : 'в: ' + def.name}${sneakAttack ? ' (из скрытности)' : ''}${crit ? ' — критическое!' : ''} −${dmg} ОЗ (${chance}%).`, def.isPlayer ? 'bad' : 'good');
      if (def.hp <= 0) kill(G, def, att);
    } else {
      ENG.floater(def.x, def.y, 'Мимо', '#d9cfb5');
      G.log(`${att.isPlayer ? 'Вы промахиваетесь' : att.name + ' промахивается'} (${chance}%).`, 'sys');
    }
    // атакованный и его союзники становятся враждебными
    if (att.isPlayer && !def.hostile && !def.dead) {
      def.hostile = true;
      for (const a of G.loc.actors) if (!a.dead && !a.isPlayer && (a.guard && a.faction === def.faction)) { a.hostile = true; a.alerted = true; }
      C.join(G);
    }
    for (const a of G.loc.actors) if (!a.dead && a.hostile && ENG.dist(a, att) < 18) a.alerted = true;
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
    // оружие и броня падают в лут
    if (a.weapon) {
      R.addItem(a, a.weapon, 1);
      const w = ITEMS[a.weapon];
      if (w.ammo && a.loaded > 0) R.addItem(a, w.ammo, a.loaded);
      a.weapon = null;
    }
    if (a.armor) { R.addItem(a, a.armor, 1); a.armor = null; }
    G.log(`${a.name} убит.`, 'warn');
    if (by && by.isPlayer) G.giveXP(a.xpValue || 25);
    if (a.tpl === 'klyk') G.flags.klykDead = true;
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
    if (G.combat && !G.combat.spend(2)) { G.log('Нужно 2 ОД для перезарядки.', 'warn'); return; }
    reload(G, p);
    G.log(`Перезарядка: ${p.loaded}/${w.mag}.`, 'sys');
    UI.refresh();
    autoEnd(G);
  };

  // ---------- действия игрока ----------
  function stepTo(G, a, cell) {
    return new Promise(r => WORLD_API.moveTo(G, a, [cell], r));
  }

  C.playerWalk = async function (G, path, cb) {
    const c = G.combat, p = G.player;
    if (!c || !c.isPlayerTurn() || c.busy) return;
    if (R.overloaded(p)) { G.log('Перегруз! Двигаться невозможно.', 'bad'); return; }
    const steps = path.slice(0, p.ap);
    if (!steps.length) { G.hint('Не хватает ОД'); return; }
    c.busy = true;
    for (const cell of steps) {
      if (!ENG.passable(G.loc, cell.x, cell.y, p)) break;
      await stepTo(G, p, cell);
      p.ap--;
      UI.refresh();
      if (!G.combat) break;
    }
    if (!G.combat) return;
    c.busy = false;
    if (cb) cb();
    autoEnd(G);
  };

  C.playerAttack = async function (G, target) {
    const p = G.player;
    if (!G.combat) {
      const sneak = !target.alerted;
      if (sneak && G.sneaking) G.log('Атака из скрытности!', 'good');
      C.start(G, target, true);
    }
    const c = G.combat;
    if (!c || !c.isPlayerTurn() || c.busy) return;
    const w = R.weaponOf(p);
    if (!w.melee && w.mag && p.loaded <= 0) {
      if (R.count(p, w.ammo)) { G.log('Магазин пуст — перезарядка (2 ОД).', 'warn'); C.reload(G); }
      else G.log('Нет патронов! Смените оружие (инвентарь) или бейте кулаками.', 'bad');
      return;
    }
    const d = ENG.dist(p, target);
    if (w.melee && d > 1) {
      const path = ENG.findPath(G.loc, p.x, p.y, target.x, target.y, { adjacent: true });
      if (!path) { G.hint('Не подойти'); return; }
      if (path.length + w.ap > p.ap) { G.log(`Нужно ${path.length + w.ap} ОД (подойти и ударить).`, 'warn'); return; }
      await C.playerWalk(G, path);
      if (!G.combat) return;
    } else if (d > w.range) { G.log(`Слишком далеко: дальность ${w.range}, до цели ${d}.`, 'warn'); return; }
    if (!w.melee && !ENG.los(G.loc, p.x, p.y, target.x, target.y)) { G.log('Цель вне линии огня.', 'warn'); return; }
    if (p.ap < w.ap) { G.log(`Не хватает ОД: нужно ${w.ap}.`, 'warn'); return; }
    c.busy = true;
    await attack(G, p, target);
    if (!G.combat) return;
    c.busy = false;
    if (!hostilesLeft(G).length) { C.end(G, 'Победа! Врагов не осталось.'); return; }
    autoEnd(G);
  };

  function autoEnd(G) {
    const c = G.combat;
    if (c && c.isPlayerTurn() && !c.busy && G.player.ap <= 0) setTimeout(() => C.endPlayerTurn(G), 350);
  }
  C.autoEnd = autoEnd;

  // ---------- ИИ ----------
  async function ai(G, a) {
    const p = G.player;
    let guard = 30;
    while (a.ap > 0 && guard-- > 0 && !p.dead && !a.dead && G.combat) {
      const w = R.weaponOf(a);
      if (a.hp < R.maxHP(a) * 0.35 && R.count(a, 'medkit') && a.ap >= 2) {
        R.removeItem(a, 'medkit', 1);
        const h = 15;
        a.hp = Math.min(R.maxHP(a), a.hp + h);
        a.ap -= 2;
        ENG.floater(a.x, a.y, '+' + h, '#9dff8a');
        G.log(`${a.name} использует аптечку.`, 'sys');
        await sleep(400);
        continue;
      }
      if (!w.melee && w.mag && a.loaded <= 0) {
        if (R.count(a, w.ammo) && a.ap >= 2) { reload(G, a); a.ap -= 2; G.log(`${a.name} перезаряжается.`, 'sys'); await sleep(300); continue; }
        R.addItem(a, a.weapon, 1); a.weapon = null; continue; // кулаки
      }
      const d = ENG.dist(a, p);
      const canHit = d <= w.range && (w.melee || ENG.los(G.loc, a.x, a.y, p.x, p.y));
      if (canHit) {
        if (a.ap >= w.ap) { await attack(G, a, p); continue; }
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
