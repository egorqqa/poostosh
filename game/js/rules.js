// Игровые правила: характеристики, навыки, проверки, инвентарь, цены, опыт
window.R = (function () {
  const { SKILLS, ITEMS, NPCS } = DATA;
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function newPlayer(name, stats, tags) {
    return {
      id: 'player', name, isPlayer: true, stats: { ...stats }, tags: [...tags], skillPts: {}, skillBonus: {},
      level: 1, xp: 0, freePts: 0, hp: 0, caps: 0,
      inv: [{ id: 'knife', n: 1 }, { id: 'water', n: 1 }],
      weapon: null, armor: 'jacket', loaded: 0, faction: 'player', x: 0, y: 0, dir: 0, cls: 'auto',
      lastFirstAid: -999,
    };
  }

  function makeNpc(tplId, x, y, opts = {}) {
    const t = NPCS[tplId];
    const a = {
      id: tplId + '_' + Math.random().toString(36).slice(2, 7), tpl: tplId, name: t.name, stats: { ...t.stats },
      tags: [], skillPts: {}, skillBonus: {}, skillOverride: { ...(t.skills || {}) }, level: 1, xp: 0,
      inv: (t.inv || []).map(([id, n]) => ({ id, n })), caps: t.caps || 0,
      weapon: t.weapon || null, armor: t.armor || null, faction: t.faction, hostile: !!t.hostile,
      x, y, homeX: x, homeY: y, dir: opts.dir || 0, wander: opts.wander || 0, sentry: !!opts.sentry, boss: !!opts.boss,
      tint: t.tint, model: t.model || null, scale: t.scale || 1, dialog: t.dialog || null, trader: !!t.trader, guard: !!t.guard, xpValue: t.xp || 25,
      stealTries: 0,
    };
    if (opts.cvRole) a.cvRole = opts.cvRole;
    a.baseHP = t.hp;
    a.hp = t.hp;
    const w = a.weapon && ITEMS[a.weapon];
    a.loaded = w && w.mag ? w.mag : 0;
    return a;
  }

  // ---- перки ----
  const has = (a, id) => !!(a && a.perks && a.perks.includes(id));
  const TRAIT_SKILL = { negotiator: { speech: 15 }, gunslinger: { pistols: 10 } };
  const PERK_SKILL = { eagle: { guns: 15, auto: 15, pistols: 15, shotguns: 15 }, quiet: { sneak: 20, steal: 10 }, talker: { speech: 15 } };

  // ---- производные ----
  const maxHP = a => a.isPlayer ? 20 + a.stats.str + 2 * a.stats.end + (a.level - 1) * (3 + Math.floor(a.stats.end / 2)) + (has(a, 'tough') ? 12 : 0) + (a.trait === 'survivor' ? 20 : 0) : a.baseHP;
  const maxAP = a => 5 + Math.floor(a.stats.agi / 2) + (has(a, 'action') ? 1 : 0) - (a.crippled ? 2 : 0);
  const carryMax = a => 15 + 8 * a.stats.str;
  const armorOf = a => a.armor ? ITEMS[a.armor] : null;
  const mods = a => (a.armor && a.armorMods && a.armorMods[a.armor]) || 0;
  const AC = a => a.stats.agi + (armorOf(a) ? armorOf(a).ac : 0) + 3 * mods(a);
  const DT = a => (armorOf(a) ? armorOf(a).dt : 0) + (has(a, 'tough') ? 1 : 0) + mods(a);
  const DR = a => (armorOf(a) ? armorOf(a).dr : 0) + (a.trait === 'survivor' ? 5 : 0);
  const meleeBonus = a => Math.max(1, a.stats.str - 5);
  const sequence = a => 2 * a.stats.per;
  const critChance = a => a.stats.luck + (has(a, 'eagle') ? 5 : 0);
  const healRate = a => { const b = Math.max(1, Math.floor(a.stats.end / 3)); return a.trait === 'survivor' ? Math.ceil(b * 1.15) : b; };
  const skillPerLevel = a => 5 + 2 * a.stats.int;
  const xpForLevel = l => 100 * l * (l + 1) / 2; // уровень 2 при 100 XP, 3 при 300...

  const GUN_SKILLS = ['auto', 'pistols', 'shotguns'];
  function skill(a, id) {
    if (a.skillOverride && a.skillOverride[id] != null) return a.skillOverride[id];
    // NPC и напарники стреляют по общему навыку «Оружие»
    if ((GUN_SKILLS.includes(id) || id === 'throwing') && !a.isPlayer && !a.isRemote) return skill(a, 'guns');
    if (id === 'guns' && (a.isPlayer || a.isRemote)) return Math.max(...GUN_SKILLS.map(k => skill(a, k)));
    const def = SKILLS.find(s => s.id === id);
    const tagged = a.tags && a.tags.includes(id);
    const pts = (a.skillPts && a.skillPts[id]) || 0;
    let perk = 0;
    for (const p of a.perks || []) perk += (PERK_SKILL[p] && PERK_SKILL[p][id]) || 0;
    if (a.trait && TRAIT_SKILL[a.trait]) perk += TRAIT_SKILL[a.trait][id] || 0;
    return Math.min(300, def.base(a.stats) + (tagged ? 20 : 0) + pts * (tagged ? 2 : 1) + ((a.skillBonus && a.skillBonus[id]) || 0) + perk);
  }

  // бросок d100 с учётом удачи (критический провал / успех)
  function check(chance, luck = 5) {
    chance = clamp(Math.round(chance), 5, 95);
    const roll = rnd(1, 100);
    const ok = roll <= chance;
    const crit = ok ? roll <= Math.max(1, Math.floor(luck / 2)) : roll >= 100 - Math.max(0, Math.floor((10 - luck) / 2));
    return { ok, crit, roll, chance };
  }

  // ---- инвентарь ----
  const itemDef = id => ITEMS[id];
  function count(a, id) { const s = a.inv.find(i => i.id === id); return s ? s.n : 0; }
  function addItem(a, id, n = 1) {
    if (n <= 0) return;
    const s = a.inv.find(i => i.id === id);
    if (s) s.n += n; else a.inv.push({ id, n });
  }
  function removeItem(a, id, n = 1) {
    const s = a.inv.find(i => i.id === id);
    if (!s || s.n < n) return false;
    s.n -= n;
    if (s.n <= 0) a.inv.splice(a.inv.indexOf(s), 1);
    return true;
  }
  function weight(a) {
    let w = a.inv.reduce((t, s) => t + ITEMS[s.id].weight * s.n, 0);
    if (a.weapon) w += ITEMS[a.weapon].weight;
    if (a.armor) w += ITEMS[a.armor].weight;
    return Math.round(w * 10) / 10;
  }
  const overloaded = a => weight(a) > carryMax(a);

  // модификации оружия (верстак): прицел, магазин, глушитель, заточка
  // уровень оружия (оружейник): +15% урона и +2% крита за уровень
  const WMOD_MARK = { scope: 'О', laser: 'Л', mag: 'М', sil: 'Г', bayonet: 'Ш', stock: 'П', sharp: 'З' };
  // навык оружия по типу ствола: автомат, пистолет, ружьё (обрез и винтовка)
  const wskillId = w => w.icon === 'ak' ? 'auto' : w.icon === 'pistol' ? 'pistols' : 'shotguns';
  const gunSkill = (a, w) => skill(a, wskillId(w));
  const throwRange = (a, it) => it.range + Math.floor(skill(a, 'throwing') / 40);
  function weaponOf(a) {
    const id = a.weapon || 'fists', w = ITEMS[id], m = (a.wmods && a.wmods[id]) || null, lvl = (a.wlvl && a.wlvl[id]) || 0;
    if (!w) return w;
    // дальность растёт с навыком: +1 клетка за каждые 25% выше 40
    const rb = w.melee ? 0 : Math.max(0, Math.floor((gunSkill(a, w) - 40) / 25));
    const gs = a.trait === 'gunslinger' && w.icon === 'pistol'; // «Пистолетчик»: выстрел на 1 ОД дешевле
    if (!m && !lvl && !rb && !gs) return w;
    const o = { ...w, range: w.range + rb };
    if (gs) o.ap = Math.max(2, w.ap - 1);
    if (!m && !lvl) return o;
    if (lvl) { o.dmg = [Math.round(w.dmg[0] * (1 + 0.15 * lvl)), Math.round(w.dmg[1] * (1 + 0.15 * lvl))]; o.crit = (w.crit || 0) + 2 * lvl; }
    if (m) {
      if (m.scope && !w.melee) { o.range += 2; o.aim = (o.aim || 0) + 10; }
      if (m.laser && !w.melee) { o.aim = (o.aim || 0) + 5; o.laser = true; }
      if (m.mag && w.mag) o.mag = Math.round(w.mag * 1.5);
      if (m.sil && !w.melee) o.silent = true;
      if (m.bayonet && !w.melee) o.bayonet = 4;
      if (m.stock && !w.melee) o.steady = true;
      if (m.sharp && w.melee) o.dmg = [o.dmg[0] + 2, o.dmg[1] + 2];
    }
    const marks = m ? Object.keys(WMOD_MARK).filter(k => m[k]).map(k => WMOD_MARK[k]).join('') : '';
    o.name = w.name + (lvl ? ` +${lvl}` : '') + (marks ? ` [${marks}]` : '');
    return o;
  }

  // ---- торговля ----
  const neg = p => p.trait === 'negotiator';
  function buyMult(p, discount = 0) { return Math.max(1.05, (2.2 - skill(p, 'barter') * 0.01 - p.stats.cha * 0.04 - discount - (has(p, 'trader') ? 0.15 : 0)) * (neg(p) ? 0.9 : 1)); }
  function sellMult(p) { return Math.min(neg(p) ? 1 : 0.95, (0.25 + skill(p, 'barter') * 0.005 + p.stats.cha * 0.02 + (has(p, 'trader') ? 0.15 : 0)) * (neg(p) ? 1.1 : 1)); }

  // ---- лечение ----
  function healAmount(a, itemId) {
    const it = ITEMS[itemId];
    const h = it.heal + (it.healSkill ? Math.floor(skill(a, 'medic') / it.healSkill) : 0);
    return has(a, 'fieldmedic') && (itemId === 'medkit' || itemId === 'bandage') ? Math.round(h * 1.5) : h;
  }

  // старые сохранения: навык «Оружие» → навык профиля
  function migrate(p) {
    if (!p || !p.isPlayer) return p;
    if (!p.cls) p.cls = 'auto';
    const cs = (DATA.CLASSES.find(c => c.id === p.cls) || DATA.CLASSES[0]).skill;
    if (p.tags && p.tags.includes('guns')) p.tags[p.tags.indexOf('guns')] = cs;
    if (p.skillPts && p.skillPts.guns) { p.skillPts[cs] = (p.skillPts[cs] || 0) + p.skillPts.guns; delete p.skillPts.guns; }
    return p;
  }
  return { migrate, wskillId, gunSkill, throwRange, has, rnd, clamp, newPlayer, makeNpc, maxHP, maxAP, carryMax, AC, DT, DR, meleeBonus, sequence, critChance, healRate,
    skillPerLevel, xpForLevel, skill, check, itemDef, count, addItem, removeItem, weight, overloaded, weaponOf,
    buyMult, sellMult, healAmount };
})();
