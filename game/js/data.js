// Игровые данные: характеристики, навыки, предметы, NPC, диалоги, локации
window.DATA = (function () {

  const SPECIAL = [
    { id: 'str', name: 'Сила', short: 'СИЛ', desc: 'Физическая мощь. Влияет на грузоподъёмность, урон в ближнем бою и очки здоровья.' },
    { id: 'per', name: 'Восприятие', short: 'ВСП', desc: 'Зрение и внимательность. Влияет на точность на дистанции, порядок хода в бою, Взлом и Медицину. Чем выше — тем раньше вы замечаете засады.' },
    { id: 'end', name: 'Выносливость', short: 'ВЫН', desc: 'Стойкость. Влияет на очки здоровья, скорость восстановления и Выживание.' },
    { id: 'cha', name: 'Харизма', short: 'ХАР', desc: 'Обаяние. Влияет на Красноречие и цены у торговцев.' },
    { id: 'int', name: 'Интеллект', short: 'ИНТ', desc: 'Ум. Влияет на количество очков навыков за уровень, Медицину и Выживание.' },
    { id: 'agi', name: 'Ловкость', short: 'ЛОВ', desc: 'Координация. Определяет очки действия (ОД) в бою, класс брони, а также Оружие, Кражу, Взлом и Скрытность.' },
    { id: 'luck', name: 'Удача', short: 'УДЧ', desc: 'Везение. Влияет на шанс критического попадания и немного — на всё остальное.' },
  ];

  // base(s) — стартовое значение навыка от характеристик
  const SKILLS = [
    { id: 'guns', name: 'Оружие', base: s => 5 + 4 * s.agi, desc: 'Владение огнестрельным оружием. Шанс попадания из пистолетов, обрезов и винтовок.' },
    { id: 'melee', name: 'Ближний бой', base: s => 20 + 2 * (s.agi + s.str), desc: 'Драка ножом, трубой и кулаками. Шанс попадания в ближнем бою.' },
    { id: 'medic', name: 'Медицина', base: s => 10 + 2 * (s.per + s.int), desc: 'Лечение ран. Увеличивает эффект аптечек и бинтов, позволяет оказывать первую помощь (кнопка «Лечить»).' },
    { id: 'survival', name: 'Выживание', base: s => 5 + 2 * (s.end + s.int), desc: 'Жизнь в пустоши. Снижает шанс случайных встреч на карте мира, ускоряет путешествие и отдых, помогает заметить засаду.' },
    { id: 'speech', name: 'Красноречие', base: s => 5 + 5 * s.cha, desc: 'Убеждение и обман. Открывает особые реплики в диалогах.' },
    { id: 'barter', name: 'Торговля', base: s => 5 + 4 * s.cha, desc: 'Умение торговаться. Снижает цены покупки и повышает цены продажи.' },
    { id: 'lockpick', name: 'Взлом', base: s => 10 + s.per + s.agi, desc: 'Вскрытие замков. Шанс открыть запертый ящик или шкаф. Отмычки дают +20%.' },
    { id: 'steal', name: 'Кража', base: s => 3 * s.agi, desc: 'Карманные кражи. Шанс незаметно забрать вещь у NPC. Тяжёлые и дорогие вещи красть труднее, в режиме скрытности — легче.' },
    { id: 'sneak', name: 'Скрытность', base: s => 5 + 3 * s.agi, desc: 'Передвижение незаметно. В режиме «Красться» снижает шанс, что вас заметят. Атака из скрытности — бонус к криту.' },
  ];

  // ---- предметы ----
  // type: weapon | armor | aid | ammo | misc | quest
  const ITEMS = {
    fists: { name: 'Кулаки', type: 'weapon', icon: 'fists', weight: 0, value: 0, melee: true, dmg: [1, 3], ap: 3, range: 1, crit: 0, hidden: true },
    knife: { name: 'Нож', type: 'weapon', icon: 'knife', weight: 1, value: 25, melee: true, dmg: [2, 7], ap: 3, range: 1, crit: 10, desc: 'Старый армейский нож. Быстрый и тихий.' },
    pipe: { name: 'Обрезок трубы', type: 'weapon', icon: 'pipe', weight: 3, value: 15, melee: true, dmg: [3, 9], ap: 4, range: 1, crit: 0, desc: 'Тяжёлая ржавая труба.' },
    pistol: { name: 'Пистолет 9мм', type: 'weapon', icon: 'pistol', weight: 1.5, value: 120, dmg: [5, 11], ap: 4, range: 12, mag: 8, ammo: 'ammo9', crit: 5, desc: 'Надёжный пистолет довоенного образца.' },
    shotgun: { name: 'Обрез', type: 'weapon', icon: 'shotgun', weight: 3, value: 160, dmg: [9, 20], ap: 5, range: 5, mag: 2, ammo: 'shells', crit: 0, desc: 'Мощно, но недалеко.' },
    rifle: { name: 'Охотничья винтовка', type: 'weapon', icon: 'rifle', weight: 4.5, value: 260, dmg: [10, 22], ap: 5, range: 20, mag: 5, ammo: 'ammo762', crit: 10, desc: 'Точная винтовка со скользящим затвором.' },
    ak: { name: 'Автомат АК', type: 'weapon', icon: 'ak', weight: 4, value: 420, dmg: [10, 17], ap: 5, range: 16, mag: 30, ammo: 'ammo762', crit: 5, desc: 'Неубиваемый автомат. Трофей рейдерского главаря.' },

    jacket: { name: 'Кожаная куртка', type: 'armor', icon: 'jacket', weight: 3, value: 60, ac: 8, dt: 1, dr: 15, desc: 'Потёртая куртка из кожи браминов.' },
    leather: { name: 'Кожаная броня', type: 'armor', icon: 'jacket', weight: 7, value: 180, ac: 15, dt: 2, dr: 25, desc: 'Укреплённые пластины из дублёной кожи.' },
    vest: { name: 'Армейский бронежилет', type: 'armor', icon: 'armor', weight: 10, value: 400, ac: 20, dt: 4, dr: 35, desc: 'Довоенный бронежилет. Тяжёлый, но держит пули.' },

    medkit: { name: 'Аптечка', type: 'aid', icon: 'medkit', weight: 0.5, value: 40, heal: 12, healSkill: 4, desc: 'Лечит 12 ОЗ + Медицина/4. В бою стоит 2 ОД.' },
    bandage: { name: 'Бинт', type: 'aid', icon: 'bandage', weight: 0.2, value: 10, heal: 4, healSkill: 10, desc: 'Лечит 4 ОЗ + Медицина/10.' },
    water: { name: 'Очищенная вода', type: 'aid', icon: 'water', weight: 0.5, value: 12, heal: 5, healSkill: 0, desc: 'Чистая вода. +5 ОЗ.' },
    food: { name: 'Консервы', type: 'aid', icon: 'food', weight: 0.5, value: 8, heal: 3, healSkill: 0, desc: 'Тушёнка. Довоенный вкус. +3 ОЗ.' },

    ammo9: { name: 'Патроны 9мм', type: 'ammo', icon: 'ammo', weight: 0.01, value: 1, desc: 'Для пистолета.' },
    shells: { name: 'Дробь 12к', type: 'ammo', icon: 'shells', weight: 0.03, value: 2, desc: 'Для обреза.' },
    ammo762: { name: 'Патроны 7.62', type: 'ammo', icon: 'ammo', weight: 0.02, value: 3, desc: 'Для винтовок и автоматов.' },

    lockpicks: { name: 'Отмычки', type: 'misc', icon: 'lockpicks', weight: 0.2, value: 35, desc: '+20% к Взлому, пока лежат в инвентаре. Могут сломаться при неудаче.' },
    junk: { name: 'Хлам', type: 'misc', icon: 'junk', weight: 1, value: 6, desc: 'Пружины, гайки, провода. Торговцы берут.' },
    holotape: { name: 'Голодиск', type: 'misc', icon: 'holotape', weight: 0.1, value: 50, desc: 'Довоенная запись. Кому-то может быть интересна.' },
    meds: { name: 'Ящик медикаментов', type: 'quest', icon: 'meds', weight: 5, value: 0, desc: 'Медикаменты каравана Ржавого Ручья. Нужно вернуть Михалычу.' },
    token: { name: 'Жетон рейдера', type: 'misc', icon: 'token', weight: 0.1, value: 15, desc: 'Знак банды Клыка.' },
  };

  // ---- тинты одной и той же модели ----
  const TINTS = {
    player: '',
    raider: 'sepia(0.5) hue-rotate(-40deg) saturate(1.6) brightness(0.85)',
    boss: 'sepia(0.7) hue-rotate(-55deg) saturate(2.2) brightness(0.75) contrast(1.2)',
    trader: 'sepia(0.8) saturate(1.3) brightness(1.1)',
    guard: 'hue-rotate(140deg) saturate(0.8) brightness(0.95)',
    doctor: 'grayscale(0.8) brightness(1.45)',
    elder: 'sepia(0.4) hue-rotate(20deg) brightness(1.05)',
    bum: 'grayscale(0.6) brightness(0.8) sepia(0.3)',
    wild: 'hue-rotate(60deg) saturate(1.4) brightness(0.8)',
  };

  // ---- шаблоны NPC ----
  // stats: SPECIAL; skills переопределяют базу
  const NPCS = {
    semyon: { name: 'Барыга Сёма', tint: 'trader', faction: 'town', dialog: 'semyon', trader: true, caps: 600,
      stats: { str: 5, per: 6, end: 5, cha: 7, int: 6, agi: 5, luck: 6 }, hp: 30,
      inv: [['pistol', 1], ['ammo9', 60], ['shotgun', 1], ['shells', 24], ['ammo762', 20], ['leather', 1], ['knife', 1], ['medkit', 2], ['water', 4], ['food', 5], ['lockpicks', 1]],
      weapon: 'pistol', armor: 'jacket' },
    irina: { name: 'Док Ирина', tint: 'doctor', faction: 'town', dialog: 'irina', trader: true, caps: 300,
      stats: { str: 4, per: 7, end: 5, cha: 6, int: 9, agi: 5, luck: 5 }, hp: 25,
      inv: [['medkit', 5], ['bandage', 8], ['water', 6]], weapon: 'knife' },
    mihalych: { name: 'Староста Михалыч', tint: 'elder', faction: 'town', dialog: 'mihalych',
      stats: { str: 5, per: 6, end: 6, cha: 7, int: 7, agi: 4, luck: 5 }, hp: 30,
      inv: [['food', 2], ['holotape', 1]], caps: 80, weapon: 'pistol' },
    gvozd: { name: 'Охранник Гвоздь', tint: 'guard', faction: 'town', dialog: 'gvozd', guard: true,
      stats: { str: 7, per: 7, end: 7, cha: 4, int: 4, agi: 6, luck: 5 }, hp: 50,
      inv: [['ammo762', 20], ['medkit', 1]], caps: 25, weapon: 'rifle', armor: 'leather', skills: { guns: 70 } },
    guard2: { name: 'Часовой Ручья', tint: 'guard', faction: 'town', dialog: 'guard2', guard: true,
      stats: { str: 6, per: 6, end: 6, cha: 4, int: 4, agi: 6, luck: 5 }, hp: 40,
      inv: [['ammo9', 16]], caps: 15, weapon: 'pistol', armor: 'jacket', skills: { guns: 60 } },
    tihon: { name: 'Бродяга Тихон', tint: 'bum', faction: 'town', dialog: 'tihon',
      stats: { str: 4, per: 4, end: 4, cha: 3, int: 5, agi: 6, luck: 7 }, hp: 18,
      inv: [['lockpicks', 1], ['junk', 3], ['food', 1]], caps: 7 },
    raider: { name: 'Рейдер', tint: 'raider', faction: 'raiders', hostile: true,
      stats: { str: 6, per: 5, end: 5, cha: 3, int: 4, agi: 6, luck: 4 }, hp: 28,
      inv: [['ammo9', 10], ['token', 1]], caps: 12, weapon: 'pistol', armor: 'jacket', skills: { guns: 45, melee: 55 }, xp: 50 },
    raider_melee: { name: 'Рейдер-громила', tint: 'raider', faction: 'raiders', hostile: true,
      stats: { str: 8, per: 4, end: 7, cha: 2, int: 3, agi: 6, luck: 4 }, hp: 36,
      inv: [['food', 1], ['token', 1]], caps: 8, weapon: 'pipe', armor: 'jacket', skills: { melee: 65 }, xp: 55 },
    raider_rifle: { name: 'Рейдер-стрелок', tint: 'raider', faction: 'raiders', hostile: true,
      stats: { str: 5, per: 7, end: 5, cha: 3, int: 4, agi: 6, luck: 5 }, hp: 26,
      inv: [['ammo762', 10], ['token', 1]], caps: 15, weapon: 'rifle', skills: { guns: 55 }, xp: 60 },
    klyk: { name: 'Главарь Клык', tint: 'boss', faction: 'raiders', hostile: true, dialog: 'klyk',
      stats: { str: 7, per: 6, end: 8, cha: 5, int: 5, agi: 7, luck: 6 }, hp: 60,
      inv: [['ammo762', 30], ['medkit', 1], ['token', 1]], caps: 90, weapon: 'ak', armor: 'vest', skills: { guns: 65 }, xp: 150 },
    wild: { name: 'Одичалый', tint: 'wild', faction: 'wild', hostile: true,
      stats: { str: 6, per: 5, end: 5, cha: 1, int: 2, agi: 6, luck: 4 }, hp: 22,
      inv: [['junk', 1], ['food', 1]], caps: 4, weapon: 'knife', skills: { melee: 55 }, xp: 35 },
    wild_gun: { name: 'Одичалый с обрезом', tint: 'wild', faction: 'wild', hostile: true,
      stats: { str: 5, per: 5, end: 5, cha: 1, int: 2, agi: 6, luck: 4 }, hp: 22,
      inv: [['shells', 6]], caps: 9, weapon: 'shotgun', skills: { guns: 45 }, xp: 45 },
  };

  // ---- диалоги ----
  // opt: { t, go, end, act, check:{skill,diff}, ok, fail, if, once, xp }
  const DIALOGS = {
    mihalych: {
      start: g => g.quests.meds === 0 ? 'hello' : g.quests.meds >= 3 ? 'done' : g.hasItem('meds') ? 'return' : 'progress',
      nodes: {
        hello: { text: 'А, новое лицо. Нечасто к нам из пустоши живыми доходят. Я Михалыч, тут вроде как за старшего.',
          opts: [
            { t: 'Что это за место?', go: 'about' },
            { t: 'Нужна помощь?', go: 'job' },
            { t: 'Бывай.', end: true },
          ] },
        about: { text: 'Ржавый Ручей. Заправка, гараж да базар. Живём с караванов. Жили... пока банда Клыка не обнаглела.',
          opts: [{ t: 'Что за банда?', go: 'job' }, { t: 'Понятно.', go: 'hello' }] },
        job: { text: 'Рейдеры Клыка засели на старом Блокпосту 17, к северо-востоку отсюда. Неделю назад они перехватили наш караван — весь ящик медикаментов у них. Без лекарств мы зиму не протянем. Вернёшь ящик — заплачу 150 крышек.',
          opts: [
            { t: 'Берусь.', act: 'takeQuest', go: 'taken' },
            { t: '150 крышек за поход к рейдерам? Смешно.', check: { skill: 'speech', diff: 45 }, ok: 'haggle_ok', fail: 'haggle_fail', once: 'mih_haggle' },
            { t: 'Не моё дело.', end: true },
          ] },
        haggle_ok: { text: 'Эх... Ладно, твоя правда. 250 — и это всё, что у Ручья есть.', onEnter: g => { g.flags.medsReward = 250; },
          opts: [{ t: 'По рукам.', act: 'takeQuest', go: 'taken' }] },
        haggle_fail: { text: 'Цена прежняя. Не нравится — дорога там.',
          opts: [{ t: 'Ладно, берусь.', act: 'takeQuest', go: 'taken' }, { t: 'Подумаю.', end: true }] },
        taken: { text: 'Блокпост на северо-востоке, я отметил его на твоей карте. Выйди за ограду — и ищи. Будь осторожен: у Клыка с десяток стволов.',
          opts: [{ t: 'Расскажи про блокпост.', go: 'info' }, { t: 'Скоро вернусь.', end: true }] },
        progress: { text: 'Ну что, есть новости про медикаменты?',
          opts: [{ t: 'Расскажи ещё раз про блокпост.', go: 'info' }, { t: 'Работаю над этим.', end: true }] },
        info: { text: 'Бывшая военная часть. Вышка, ангар, штаб. Клык держит добро в железном шкафу у штаба — замок там серьёзный. Говорят, сам Клык не дурак поговорить, если подойти без стрельбы. А Гвоздь, наш охранник, ходил туда в разведку — спроси его.',
          opts: [{ t: 'Понял.', end: true }] },
        return: { text: 'Неужели... Это наш ящик! Живой и при медикаментах!',
          opts: [{ t: '[Отдать медикаменты]', act: 'finishQuest', go: 'thanks' }, { t: 'Пока придержу.', end: true }] },
        thanks: { text: 'Держи, заслужил. Ручей этого не забудет. Заходи — для тебя тут всегда найдётся место у огня.', opts: [{ t: 'Бывай, Михалыч.', end: true }] },
        done: { text: 'А, наш герой! Дети уже не кашляют, слышишь? Всё благодаря тебе.', opts: [{ t: 'Рад помочь.', end: true }] },
      },
    },
    semyon: {
      start: () => 'hello',
      nodes: {
        hello: { text: 'Барыга Сёма. Покупаю, продаю, вопросов не задаю. Только не воруй, ага? Гвоздь у нас нервный.',
          opts: [
            { t: 'Покажи товар.', act: 'trade', end: true },
            { t: 'Что слышно в округе?', go: 'rumor' },
            { t: 'Сделаешь скидку новому другу?', check: { skill: 'speech', diff: 35 }, ok: 'disc_ok', fail: 'disc_fail', once: 'sem_disc' },
            { t: 'Пока.', end: true },
          ] },
        rumor: { text: 'Говорят, у Тихона-бродяги отмычки водятся. А рейдеры Клыка держат склад на блокпосту — шкаф с замком такой, что без отмычек и не суйся.',
          opts: [{ t: 'Спасибо.', go: 'hello' }] },
        disc_ok: { text: 'Хе... Язык у тебя подвешен. Ладно, тебе — скидка.', onEnter: g => { g.flags.semDiscount = 0.15; },
          opts: [{ t: 'Покажи товар.', act: 'trade', end: true }, { t: 'Пока.', end: true }] },
        disc_fail: { text: 'Друзья у меня платят полную цену. Особенно друзья.', opts: [{ t: 'Ладно.', go: 'hello' }] },
      },
    },
    irina: {
      start: () => 'hello',
      nodes: {
        hello: { text: 'Док Ирина. Ранен — лечу. Бесплатно не лечу. Тут не богадельня.',
          opts: [
            { t: 'Подлатай меня. [30 крышек]', if: g => g.player.hp < g.maxHP(g.player), act: 'healPaid', go: 'healed' },
            { t: 'Хочу купить лекарства.', act: 'trade', end: true },
            { t: 'Поделишься знаниями? Я тоже немного лекарь.', check: { skill: 'medic', diff: 35 }, ok: 'teach_ok', fail: 'teach_fail', once: 'iri_teach' },
            { t: 'Пока.', end: true },
          ] },
        healed: { text: 'Готово. И постарайся больше не ловить пули лицом.', opts: [{ t: 'Спасибо, док.', end: true }] },
        teach_ok: { text: 'Хм, руки у тебя правильные. Смотри: жгут вот так, и шов — вот так. (+5 к Медицине)', onEnter: g => { g.player.skillBonus.medic = (g.player.skillBonus.medic || 0) + 5; g.giveXP(25); },
          opts: [{ t: 'Понял, спасибо.', go: 'hello' }] },
        teach_fail: { text: 'Ты бинт от портянки не отличишь. Приходи, когда подучишься.', opts: [{ t: '...', go: 'hello' }] },
      },
    },
    gvozd: {
      start: () => 'hello',
      nodes: {
        hello: { text: 'Стой. Оружие в лагере не доставать, у Сёмы не воровать. Нарушишь — пристрелю. Понял?',
          opts: [
            { t: 'Понял.', end: true },
            { t: 'Ты ходил на блокпост к рейдерам?', go: 'post' },
            { t: 'Говорят, ты знаешь, как подобраться к блокпосту незаметно.', if: g => g.quests.meds >= 1, check: { skill: 'speech', diff: 30 }, ok: 'path_ok', fail: 'path_fail', once: 'gv_path' },
          ] },
        post: { text: 'Ходил. Человек восемь, у главаря автомат. На вышке часовой, но он больше спит. Лезть в лоб — самоубийство.',
          opts: [{ t: 'Ясно.', go: 'hello' }] },
        path_ok: { text: 'Ладно, слушай. С запада, вдоль мешков, часовые не смотрят. Иди тихо, пригнувшись — и шкаф у штаба твой. Отмычки возьми, замок там тугой.', onEnter: g => { g.giveXP(20); g.flags.sneakHint = true; },
          opts: [{ t: 'Спасибо.', end: true }] },
        path_fail: { text: 'Кто говорит? Пусть сам и идёт.', opts: [{ t: 'Ладно.', go: 'hello' }] },
      },
    },
    guard2: {
      start: () => 'hello',
      nodes: { hello: { text: 'Проходи, не задерживайся. В лагере тихо — и пусть так и остаётся.', opts: [{ t: 'Ага.', end: true }] } },
    },
    tihon: {
      start: () => 'hello',
      nodes: {
        hello: { text: 'Э-э... добрый человек... крышечки не найдётся? Хоть одной?',
          opts: [
            { t: 'Держи 5 крышек.', if: g => g.player.caps >= 5 && !g.flags.tihonPaid, act: g => { g.player.caps -= 5; g.flags.tihonPaid = true; }, go: 'thanks' },
            { t: 'Говорят, у тебя отмычки есть. Поделись.', check: { skill: 'speech', diff: 25 }, ok: 'picks_ok', fail: 'picks_fail', once: 'tih_picks' },
            { t: 'Отвали.', end: true },
          ] },
        thanks: { text: 'Ох, спасибо! Слушай... в гараже ящик с инструментами стоит, запертый. Никто его уже год не открывал. Я бы глянул на твоём месте.',
          opts: [{ t: 'Учту.', end: true }] },
        picks_ok: { text: 'Эх, ладно... для хорошего человека не жалко. Только не говори Сёме, где взял.', onEnter: g => { const t = g.findNpc('tihon'); if (t && g.takeFrom(t, 'lockpicks', 1)) { g.addItem(g.player, 'lockpicks', 1); g.log('Получено: Отмычки', 'good'); } g.giveXP(15); },
          opts: [{ t: 'Спасибо.', end: true }] },
        picks_fail: { text: 'Какие отмычки? Нету у меня ничего! Нету!', opts: [{ t: 'Ну-ну.', end: true }] },
      },
    },
    klyk: {
      start: g => g.flags.klykTalked ? 'again' : 'hello',
      nodes: {
        hello: { text: 'Ну-ка стоять! Ещё шаг — и будешь как решето. Кто такой и чего тут забыл?', onEnter: g => { g.flags.klykTalked = true; },
          opts: [
            { t: 'Я пришёл за медикаментами Ржавого Ручья.', if: g => g.quests.meds >= 1, go: 'laugh' },
            { t: 'Караван Ручья был под защитой Стальной Колонны. Они уже идут сюда. Отдай ящик — и, может, уйдёшь живым.', if: g => g.quests.meds >= 1, check: { skill: 'speech', diff: 60 }, ok: 'bluff_ok', fail: 'bluff_fail' },
            { t: 'Давай договоримся. 100 крышек за ящик медикаментов.', if: g => g.quests.meds >= 1 && g.player.caps >= 100, act: 'klykBuy', go: 'bought' },
            { t: 'Просто проходил мимо. Ухожу.', go: 'leave' },
            { t: '[Атаковать]', act: 'fight', end: true },
          ] },
        laugh: { text: 'Ха! Тогда ты пришёл умирать. Парни, к бою!', opts: [{ t: '[Бой]', act: 'fight', end: true }] },
        bluff_ok: { text: '...Колонна? Чёрт. Нам с ними делить нечего. Забирай свои склянки. Парни, сворачиваемся — уходим на юг!', onEnter: g => { g.giveXP(200); },
          opts: [{ t: '[Забрать медикаменты]', act: 'klykGive', end: true }] },
        bluff_fail: { text: 'Врёшь, как дышишь. Валите его!', opts: [{ t: '[Бой]', act: 'fight', end: true }] },
        bought: { text: 'Крышки — это разговор. Ящик забирай и проваливай, пока я добрый.', opts: [{ t: '[Уйти]', end: true }] },
        leave: { text: 'Вот и вали. Ещё раз увижу — пристрелю без разговоров.', onEnter: g => { g.flags.klykWarned = true; }, opts: [{ t: '[Уйти]', act: 'grace', end: true }] },
        again: { text: 'Я же сказал — пристрелю!', opts: [{ t: '[Бой]', act: 'fight', end: true }] },
      },
    },
  };

  // ---- локации ----
  // объекты: [спрайт, x, y, {fw, fh, oy, block, name, container, lock, items, owner, desc}]
  const LOCATIONS = {
    camp: {
      name: 'Ржавый Ручей', w: 44, h: 44, ground: ['dirt_tracks', 'rubble_ground', 'broken_pavement', 'cracked_road', 'overgrown_grassland'],
      groundW: [3, 2, 2, 1, 2], base: '#5a4a34',
      entry: { x: 22, y: 40 },
      desc: 'Поселение у старой заправки. Здесь торгуют, лечат и прячутся от пустоши.',
      objects: [
        ['gas_station', 6, 6, { fw: 6, fh: 6, oy: 10, name: 'Старая заправка', desc: 'Ржавые колонки давно пусты. Под навесом прячутся от кислотного дождя.' }],
        ['garage', 25, 4, { fw: 7, fh: 5, oy: 14, name: 'Гараж', desc: 'Мастерская Ручья. Пахнет маслом и ржавчиной.' }],
        ['crate_long', 27, 11, { name: 'Ящик с инструментами', container: true, lock: 40, items: [['junk', 3], ['shotgun', 1], ['shells', 10], ['lockpicks', 1]], desc: 'Тяжёлый ящик с навесным замком.' }],
        ['tires', 32, 10, {}],
        ['truck', 18, 9, { fw: 3, fh: 5, oy: 8, name: 'Грузовик', desc: 'Колёса сняты, кузов пуст. Кто-то спит в кабине.' }],
        ['shop_big', 12, 17, { fw: 7, fh: 5, oy: 8, name: 'Лавка Сёмы', desc: 'Вывеска гласит что-то нечитаемое. Товары разложены на прилавке.' }],
        ['mil_locker', 20, 19, { name: 'Сейф Сёмы', container: true, lock: 70, owner: 'semyon', items: [['ammo9', 40], ['medkit', 2], ['holotape', 1]], caps: 120, desc: 'Железный шкаф с хитрым замком. Принадлежит Сёме.' }],
        ['med_tent', 28, 17, { fw: 7, fh: 4, oy: 6, name: 'Медпункт', desc: 'Палатка доктора Ирины. Внутри горит лампа.' }],
        ['stall_food', 5, 25, { fw: 4, fh: 4, oy: 8, name: 'Прилавок с едой' }],
        ['stall_awning', 21, 27, { fw: 5, fh: 4, oy: 8, name: 'Навес' }],
        ['sacks_pallet', 27, 30, { name: 'Мешки', container: true, items: [['food', 2], ['junk', 2]], desc: 'Мешки с припасами. Ничьи, кажется.' }],
        ['booth', 33, 28, { fw: 5, fh: 5, oy: 6, name: 'Дом старосты' }],
        ['tent_green_lit', 4, 33, { fw: 4, fh: 3, oy: 6, name: 'Палатка' }],
        ['tent_white', 10, 36, { fw: 4, fh: 3, oy: 6, name: 'Палатка' }],
        ['tent_green', 37, 11, { fw: 4, fh: 3, oy: 6, name: 'Палатка' }],
        ['water_tower', 38, 20, { fw: 3, fh: 3, oy: 6, name: 'Водонапорная башня' }],
        ['windmill', 2, 18, { fw: 2, fh: 2, oy: 4, name: 'Ветряк' }],
        ['barrels', 13, 13, {}], ['barrels', 35, 35, {}], ['crate_small', 24, 24, {}], ['pallet', 9, 30, {}],
        ['ammo_box', 16, 31, { name: 'Ящик', container: true, items: [['ammo9', 8], ['bandage', 1]] }],
        ['jersey_red', 18, 39, {}], ['jersey_red', 26, 39, {}], ['jersey_yellow', 15, 40, {}], ['jersey_small', 29, 40, {}],
        ['fence_wire', 3, 40, { fw: 4, fh: 1 }], ['fence_wire', 34, 40, { fw: 4, fh: 1 }],
        ['tree_dead', 1, 4, {}], ['tree_dead2', 41, 5, {}], ['tree_dead', 40, 30, {}], ['tree_small', 2, 28, {}],
        ['bush_dry', 14, 4, { block: false }], ['bush_round', 36, 38, {}], ['rocks', 1, 12, {}], ['rocks2', 42, 15, {}],
        ['grass1', 9, 21, { block: false }], ['grass2', 30, 25, { block: false }], ['grass3', 20, 34, { block: false }],
        ['grass4', 37, 33, { block: false }], ['weeds', 4, 13, { block: false }], ['grass1', 24, 15, { block: false }],
        ['pole', 11, 24, {}], ['pole', 31, 25, {}], ['lamp_post', 22, 22, {}],
      ],
      npcs: [
        ['semyon', 16, 23, { dir: 0 }], ['irina', 31, 22, {}], ['mihalych', 34, 34, {}],
        ['gvozd', 21, 37, {}], ['guard2', 6, 15, { wander: 4 }], ['tihon', 13, 33, { wander: 3 }],
      ],
    },
    post: {
      name: 'Блокпост 17', w: 46, h: 46, ground: ['ruined_concrete_yard', 'broken_pavement', 'cracked_road', 'rubble_ground', 'dirt_tracks'],
      groundW: [3, 3, 1, 2, 1], base: '#4c4a40',
      entry: { x: 4, y: 41 },
      desc: 'Заброшенная военная часть. Теперь логово банды Клыка.',
      objects: [
        ['mil_hq', 18, 5, { fw: 9, fh: 7, oy: 10, name: 'Штаб', desc: 'Бетонный штаб с радаром на крыше. Двери заварены изнутри.' }],
        ['mil_locker', 28, 13, { name: 'Склад Клыка', container: true, lock: 55, owner: 'klyk', items: [['meds', 1], ['ammo762', 30], ['medkit', 2], ['leather', 1]], caps: 60, desc: 'Тяжёлый железный шкаф. Замок серьёзный.' }],
        ['mil_tower', 6, 8, { fw: 3, fh: 3, oy: 6, name: 'Вышка' }],
        ['mil_hangar', 32, 18, { fw: 8, fh: 6, oy: 8, name: 'Ангар' }],
        ['mil_tent', 12, 22, { fw: 4, fh: 3, oy: 6, name: 'Палатка рейдеров' }],
        ['mil_camo_net', 21, 23, { fw: 5, fh: 4, oy: 6, name: 'Маскировочный навес' }],
        ['mil_crates', 26, 28, { name: 'Ящики', container: true, items: [['ammo9', 12], ['food', 2], ['water', 1]] }],
        ['mil_btr', 33, 32, { fw: 5, fh: 3, oy: 6, name: 'БТР', desc: 'Колёса пробиты, но пулемёт на месте... без патронов.' }],
        ['mil_tank', 35, 6, { fw: 5, fh: 4, oy: 6, name: 'Танк' }],
        ['mil_mg_bunker', 5, 26, { fw: 4, fh: 3, oy: 6, name: 'Пулемётное гнездо' }],
        ['mil_checkpoint', 10, 34, { fw: 4, fh: 3, oy: 6, name: 'КПП' }],
        ['mil_ammo', 16, 30, { name: 'Ящик с патронами', container: true, lock: 25, items: [['ammo762', 15], ['shells', 8]] }],
        ['mil_sandwall', 14, 14, { fw: 4, fh: 1 }], ['mil_sandwall', 24, 16, { fw: 4, fh: 1 }], ['mil_sandwall', 4, 18, { fw: 4, fh: 1 }],
        ['mil_barrier', 16, 38, {}], ['mil_barrier2', 20, 36, {}], ['hedgehog', 24, 38, {}], ['hedgehog', 28, 36, {}],
        ['hedgehog', 40, 28, {}], ['mil_concrete', 30, 12, {}], ['mil_crate_pile', 15, 9, {}], ['barrels', 31, 26, {}],
        ['mil_lamp', 27, 20, {}], ['mil_lamp', 12, 30, {}],
        ['tree_dead', 2, 3, {}], ['tree_dead2', 43, 40, {}], ['tree_dead', 42, 14, {}], ['stump_big', 3, 34, {}],
        ['rocks_big', 40, 42, {}], ['bush_dry', 8, 40, { block: false }], ['grass2', 30, 40, { block: false }],
        ['grass4', 9, 18, { block: false }], ['grass1', 38, 27, { block: false }], ['weeds', 20, 30, { block: false }],
      ],
      npcs: [
        ['klyk', 25, 15, { boss: true }], ['raider_rifle', 9, 12, { sentry: true }], ['raider', 15, 26, { wander: 3 }],
        ['raider_melee', 23, 30, { wander: 3 }], ['raider', 31, 25, { wander: 3 }], ['raider_rifle', 36, 14, {}],
      ],
    },
  };

  // ---- карта мира ----
  // буквы → гекс-тайлы
  const HEX_TILES = {
    d: 'hex_dry_dirt', a: 'hex_cracked_asphalt', c: 'hex_concrete_slabs', r: 'hex_rubble_hex', g: 'hex_grassy_hex',
    s: 'hex_stony_dirt', b: 'hex_broken_road_hex', m: 'hex_muddy_puddle_hex', y: 'hex_sandy_ground_hex',
    o: 'hex_mossy_pavement_hex', x: 'hex_concrete_rubble_hex', w: 'hex_worn_asphalt_hex',
  };
  const WORLD = {
    rows: [
      'yyyssdddggsrrxxccd',
      'ysyddsgggsdrxxccsd',
      'yyddbddgggsrrxcccs',
      'ysddbdmggdsrxxrsdd',
      'dssdbdgggdsrrrsdgd',
      'dsdbbdggmdbbbbbbdd',
      'ddsbdsdggbbdsdddgd',
      'ysdbddsdbddsdgdggd',
      'yydbbbbbbdyydggmgd',
      'yydsdggsdsyyydgggs',
      'yyddggmgsdyyysddss',
      'yyysdgggsyyyyssdsy',
    ],
    terrain: { y: 'Пустыня', d: 'Пустошь', s: 'Камни', g: 'Пустошь', b: 'Дорога', w: 'Дорога', a: 'Дорога', m: 'Болото', r: 'Руины', x: 'Руины', c: 'Руины', o: 'Руины' },
    encounter: { y: 0.10, d: 0.12, s: 0.12, g: 0.12, b: 0.06, w: 0.06, a: 0.06, m: 0.18, r: 0.20, x: 0.20, c: 0.18, o: 0.15 },
    sites: [
      { id: 'camp', x: 4, y: 8, name: 'Ржавый Ручей', sprite: 'booth', known: true },
      { id: 'post', x: 13, y: 2, name: 'Блокпост 17', sprite: 'mil_tower', known: false },
    ],
    start: { x: 4, y: 8 },
  };

  return { SPECIAL, SKILLS, ITEMS, TINTS, NPCS, DIALOGS, LOCATIONS, WORLD, HEX_TILES };
})();
