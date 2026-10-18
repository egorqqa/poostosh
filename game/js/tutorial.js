// Обучение: пошаговые подсказки в первые минуты игры
window.TUT = (function () {
  const T = { ev: {}, shownAt: 0 };
  let enabled = true;
  try { enabled = localStorage.getItem('opt_tips') !== '0'; } catch (e) { /* */ }

  // where: где показывать; done: условие завершения; arrow: на что указать стрелкой
  const STEPS = [
    { where: 'local', text: 'Добро пожаловать в пустошь! <b>ЛКМ по земле</b> — идти. Колесо мыши — масштаб.', done: () => T.ev.moved },
    { where: 'local', text: 'Над некоторыми жителями горит <b class="warn">«!»</b> — у них есть задание, <b class="good">«?»</b> — задание можно сдать. Подойдите к старосте <b>Михалычу</b> (стрелка) и кликните по нему.', arrow: { npc: 'mihalych' }, done: () => T.ev.dialog },
    { where: 'dialog', text: 'Выбирайте ответ мышью или цифрами <b>1–9</b>. Реплики вида <span class="warn">[Красноречие 45]</span> — проверка навыка: хватит навыка — получится.', done: () => T.ev.dialogClosed },
    { where: 'local', text: '<b>C</b> — персонаж: характеристики, навыки, уровень и <b>журнал заданий</b>. <b>I</b> — инвентарь и снаряжение. Загляните туда.', done: () => T.ev.panel },
    { where: 'local', text: 'Наведите курсор на машину, грузовик или ящики: появится подпись. Клик — <b>осмотреть</b> (даёт опыт) или <b>обыскать</b> (немного лута).', done: () => T.ev.object },
    { where: 'local', text: 'Справа от оружия — <b>быстрые слоты 1–3</b>: аптечка, бинт, вода. Клик или клавиши <b>1, 2, 3</b> — лечение без инвентаря. Слоты настраиваются в инвентаре.', done: () => T.ev.quick || T.timeOnStep() > 14 },
    { where: 'local', text: '<b>S</b> — красться: враги замечают позже, а удар из скрытности сильнее. Риск быть замеченным показан вверху экрана.', done: () => T.ev.sneak || T.timeOnStep() > 16 },
    { where: 'local', text: 'Мини-карта в правом верхнем углу (<b>N</b> — скрыть): зелёным — выход, красным — враги, жёлтым — задания. Клик по мини-карте — идти туда.', done: () => T.timeOnStep() > 14 },
    { where: 'local', text: 'Зелёная зона <b class="good">«ВЫХОД»</b> ведёт на карту мира. Когда будете готовы — идите туда.', arrow: { exit: true }, done: () => T.ev.world },
    { where: 'world', text: 'Карта мира: клик по гексу — идти. Новые места открываются, когда подходите ближе. «Отдохнуть 8 ч» лечит. В пути бывают случайные встречи.', done: () => T.ev.enteredAfterWorld || T.timeOnStep() > 18 },
  ];
  const COMBAT_TIP = 'Бой пошаговый. У каждого действия цена в <b>ОД</b> (огоньки над оружием). Клик по врагу — атака, по земле — шаг, <b>Пробел</b> — конец хода. Лечение — слоты 1–3. Отступить можно через зону выхода, если вас не ранили.';

  T.enabled = () => enabled;
  T.setEnabled = v => {
    enabled = v;
    try { localStorage.setItem('opt_tips', v ? '1' : '0'); } catch (e) { /* */ }
    T.render();
  };
  T.mark = function (name) {
    T.ev[name] = true;
    if (name === 'world') T.ev.wasWorld = true;
    if (name === 'location' && T.ev.wasWorld) T.ev.enteredAfterWorld = true;
    if (name === 'combat' && enabled && window.G && !G.flags.tutCombat) { G.flags.tutCombat = true; T.tip = COMBAT_TIP; T.tipUntil = Date.now() + 16000; }
    T.check();
  };
  T.timeOnStep = () => (Date.now() - T.shownAt) / 1000;
  function step() { return window.G && G.flags ? G.flags.tutStep || 0 : 0; }
  T.current = function () {
    if (!enabled || !window.G || !G.player || G.scene === 'menu') return null;
    const s = STEPS[step()];
    if (!s) return null;
    const where = G.mode === 'dialog' ? 'dialog' : G.scene;
    return s.where === where ? s : null;
  };
  T.arrow = function () { const s = T.current(); return s && s.arrow ? s.arrow : null; };
  T.next = function () { G.flags.tutStep = step() + 1; T.shownAt = Date.now(); T.render(); };
  T.check = function () {
    if (!enabled || !window.G || !G.flags) return;
    const s = STEPS[step()];
    if (s && s.done()) { G.flags.tutStep = step() + 1; T.shownAt = Date.now(); }
    T.render();
  };

  let lastHtml = '';
  T.render = function () {
    const box = document.getElementById('tut-box');
    if (!box) return;
    const s = T.current();
    let html = '';
    if (enabled && T.tip && Date.now() < T.tipUntil && window.G && G.combat) html = `<div class="tut-text">${T.tip}</div><div class="tut-btns"><button data-t="tipok">Понятно</button></div>`;
    else if (s && !(window.UI && UI.modalOpen())) html = `<div class="tut-step">Подсказка ${step() + 1}/${STEPS.length}</div><div class="tut-text">${s.text}</div><div class="tut-btns"><button data-t="next">Дальше</button><button data-t="off">Отключить подсказки</button></div>`;
    if (html === lastHtml) return;
    lastHtml = html;
    box.innerHTML = html;
    box.classList.toggle('hidden', !html);
  };
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#tut-box [data-t]');
    if (!b) return;
    if (b.dataset.t === 'next') T.next();
    if (b.dataset.t === 'off') T.setEnabled(false);
    if (b.dataset.t === 'tipok') { T.tipUntil = 0; T.render(); }
  });
  setInterval(() => T.check(), 500);
  return T;
})();
