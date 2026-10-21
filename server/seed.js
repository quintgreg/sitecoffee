// Начальное наполнение каталога. Используется один раз — когда в базе ещё нет сортов/наборов.
// Дальше источник правды — таблицы products и bundles в data/kora.db (правки через админку).
// image — ссылка на фото пачки (https://… или /путь на этом сайте); без неё рисуется пачка цвета tone.

// notes: [нота, цвет дескриптора]
const P = (o) => ({ altitude: '[ВЫСОТА]', sale: 0, image: '', ...o });

export const PRODUCTS = [
  P({
    handle: 'ethiopia-guji', title: 'Эфиопия Гуджи', country: 'Эфиопия', region: 'Гуджи',
    lead: 'Чайный',
    notes: [['бергамот', '#C9A227'], ['персик', '#E59866'], ['чёрный чай', '#6E4B3A']],
    method: 'filter', roast: 'light', process: 'natural', tone: 'saffron', price: 1490,
    prices: { 500: 2790, 1000: 5290 },
    acidity: 'high', density: 'low', taste: 'flower', features: ['mono'],
    tags: ['popular', 'week'], rating: 4.8, reviews: 1284,
  }),
  P({
    handle: 'colombia-huila', title: 'Колумбия Уила', country: 'Колумбия', region: 'Уила',
    lead: 'Сбалансированный',
    notes: [['красное яблоко', '#B03A2E'], ['карамель', '#AF6E4D'], ['какао', '#5D4037']],
    method: 'espresso', roast: 'medium', process: 'washed', tone: 'ember', price: 1290,
    acidity: 'mid', density: 'mid', taste: 'choco', features: ['mono', 'milk'],
    tags: ['popular', 'recommended'], rating: 4.7, reviews: 2318,
  }),
  P({
    handle: 'kenya-nyeri', title: 'Кения Ньери', country: 'Кения', region: 'Ньери',
    lead: 'Сочный',
    notes: [['чёрная смородина', '#4A235A'], ['грейпфрут', '#E67E73'], ['ягодный сироп', '#922B21']],
    method: 'filter', roast: 'light', process: 'washed', tone: 'rose', price: 1690,
    acidity: 'high', density: 'low', taste: 'fruit', features: ['mono', 'microlot'],
    tags: ['new', 'microlot'], rating: 4.9, reviews: 412,
  }),
  P({
    handle: 'brazil-cerrado', title: 'Бразилия Серрадо', country: 'Бразилия', region: 'Серрадо',
    lead: 'Плотный',
    notes: [['молочный шоколад', '#7B3F00'], ['орех', '#A0522D'], ['мёд', '#D4A017']],
    method: 'espresso', roast: 'dark', process: 'natural', tone: 'bone', price: 990,
    acidity: 'low', density: 'high', taste: 'choco', features: ['mono', 'milk'],
    tags: ['popular'], rating: 4.7, reviews: 6785, sale: 0.15,
  }),
  P({
    handle: 'guatemala-antigua', title: 'Гватемала Антигуа', country: 'Гватемала', region: 'Антигуа',
    lead: 'Пряный',
    notes: [['тростниковый сахар', '#C68E17'], ['слива', '#5B2C6F'], ['специи', '#8E5B3E']],
    method: 'filter', roast: 'medium', process: 'washed', tone: 'moss', price: 1390,
    acidity: 'mid', density: 'mid', taste: 'fruit', features: ['mono'],
    tags: ['recommended'], rating: 4.6, reviews: 776,
  }),
  P({
    handle: 'peru-decaf', title: 'Перу Декаф', country: 'Перу', region: 'Кахамарка',
    lead: 'Мягкий',
    notes: [['какао', '#5D4037'], ['финик', '#8D5524'], ['карамель', '#AF6E4D']],
    method: 'decaf', roast: 'medium', process: 'washed', tone: 'ink', price: 1190,
    acidity: 'low', density: 'mid', taste: 'choco', features: ['decaf', 'mono'],
    tags: ['recommended'], rating: 4.5, reviews: 534,
  }),
  P({
    handle: 'blend-midnight', title: 'Смесь «Полночь»', country: 'Смесь', region: 'Бразилия и Уганда',
    lead: 'Плотный',
    notes: [['тёмный шоколад', '#3E2723'], ['жареный орех', '#A0522D'], ['патока', '#6E2C00']],
    method: 'espresso', roast: 'dark', process: 'blend', tone: 'ember', price: 890,
    acidity: 'low', density: 'high', taste: 'choco', features: ['blend', 'milk'],
    tags: ['popular', 'ending'], rating: 4.7, reviews: 5577,
  }),
  P({
    handle: 'blend-morning', title: 'Смесь «Утро»', country: 'Смесь', region: 'Бразилия и Эфиопия',
    lead: 'Сладкий',
    notes: [['карамель', '#AF6E4D'], ['апельсин', '#E67E22'], ['какао', '#5D4037']],
    method: 'espresso', roast: 'medium', process: 'blend', tone: 'saffron', price: 940,
    acidity: 'mid', density: 'mid', taste: 'choco', features: ['blend', 'milk'],
    tags: ['recommended', 'popular'], rating: 4.6, reviews: 3472, sale: 0.2,
  }),
  P({
    handle: 'rwanda-nyamasheke', title: 'Руанда Ньямашеке', country: 'Руанда', region: 'Ньямашеке',
    lead: 'Яркий',
    notes: [['красная смородина', '#C0392B'], ['гибискус', '#A93266'], ['лайм', '#7DAA3B']],
    method: 'filter', roast: 'light', process: 'washed', tone: 'rose', price: 1590,
    acidity: 'high', density: 'low', taste: 'fruit', features: ['mono', 'microlot', 'limited'],
    tags: ['microlot', 'ending'], rating: 4.8, reviews: 198,
  }),
  P({
    handle: 'costa-rica-tarrazu', title: 'Коста-Рика Тарразу', country: 'Коста-Рика', region: 'Тарразу',
    lead: 'Медовый',
    notes: [['абрикос', '#E59866'], ['мёд', '#D4A017'], ['миндаль', '#B9770E']],
    method: 'filter', roast: 'medium', process: 'honey', tone: 'moss', price: 1440,
    acidity: 'mid', density: 'mid', taste: 'fruit', features: ['mono'],
    tags: ['new'], rating: 4.6, reviews: 341,
  }),
  P({
    handle: 'indonesia-sumatra', title: 'Индонезия Суматра', country: 'Индонезия', region: 'Ачех',
    lead: 'Землистый',
    notes: [['табак', '#784212'], ['кедр', '#6E5A3A'], ['тёмный шоколад', '#3E2723']],
    method: 'espresso', roast: 'dark', process: 'wethulled', tone: 'ink', price: 1240,
    acidity: 'low', density: 'high', taste: 'choco', features: ['mono', 'milk'],
    tags: [], rating: 4.5, reviews: 689,
  }),
  P({
    handle: 'ethiopia-sidamo-anaerobic', title: 'Эфиопия Сидамо Анаэроб', country: 'Эфиопия', region: 'Сидамо',
    lead: 'Винный',
    notes: [['клубничный йогурт', '#E74C6F'], ['ром', '#7B241C'], ['корица', '#A04000']],
    method: 'filter', roast: 'light', process: 'anaerobic', tone: 'ember', price: 1890,
    acidity: 'mid', density: 'mid', taste: 'funky', features: ['mono', 'microlot', 'limited'],
    tags: ['new', 'microlot'], rating: 4.8, reviews: 156,
  }),
  P({
    handle: 'colombia-decaf', title: 'Колумбия Декаф', country: 'Колумбия', region: 'Толима',
    lead: 'Сладкий',
    notes: [['карамель', '#AF6E4D'], ['красное яблоко', '#B03A2E'], ['панела', '#9C640C']],
    method: 'decaf', roast: 'medium', process: 'washed', tone: 'bone', price: 1240,
    acidity: 'mid', density: 'mid', taste: 'choco', features: ['decaf', 'mono', 'milk'],
    tags: [], rating: 4.6, reviews: 287,
  }),
  P({
    handle: 'uganda-rwenzori', title: 'Уганда Рвензори', country: 'Уганда', region: 'Рвензори',
    lead: 'Насыщенный',
    notes: [['ежевика', '#4A235A'], ['тёмный шоколад', '#3E2723'], ['красное вино', '#7B241C']],
    method: 'espresso', roast: 'medium', process: 'natural', tone: 'ember', price: 1140,
    acidity: 'mid', density: 'high', taste: 'fruit', features: ['mono', 'milk'],
    tags: ['ending'], rating: 4.6, reviews: 902,
  }),
  P({
    handle: 'burundi-kayanza', title: 'Бурунди Каянза', country: 'Бурунди', region: 'Каянза',
    lead: 'Чайный',
    notes: [['клюква', '#B03A2E'], ['чёрный чай', '#6E4B3A'], ['тростниковый сахар', '#C68E17']],
    method: 'filter', roast: 'light', process: 'washed', tone: 'saffron', price: 1540,
    acidity: 'high', density: 'low', taste: 'flower', features: ['mono', 'microlot'],
    tags: ['microlot'], rating: 4.7, reviews: 233,
  }),
  P({
    handle: 'bolivia-caranavi', title: 'Боливия Каранави', country: 'Боливия', region: 'Каранави',
    lead: 'Ореховый',
    notes: [['молочный шоколад', '#7B3F00'], ['грецкий орех', '#8B5A2B'], ['красная слива', '#922B21']],
    method: 'filter', roast: 'medium', process: 'washed', tone: 'moss', price: 1340,
    acidity: 'mid', density: 'mid', taste: 'choco', features: ['mono'],
    tags: ['recommended'], rating: 4.6, reviews: 418,
  }),
  P({
    handle: 'brazil-mogiana', title: 'Бразилия Можиана', country: 'Бразилия', region: 'Можиана',
    lead: 'Сладкий',
    notes: [['арахис', '#B9770E'], ['какао', '#5D4037'], ['тростниковый сахар', '#C68E17']],
    method: 'espresso', roast: 'medium', process: 'natural', tone: 'bone', price: 1040,
    acidity: 'low', density: 'high', taste: 'choco', features: ['mono', 'milk'],
    tags: ['popular'], rating: 4.6, reviews: 2890,
  }),
  P({
    handle: 'kenya-kirinyaga', title: 'Кения Кириньяга', country: 'Кения', region: 'Кириньяга',
    lead: 'Сочный',
    notes: [['чёрная смородина', '#4A235A'], ['ревень', '#C0392B'], ['ежевика', '#5B2C6F']],
    method: 'filter', roast: 'light', process: 'washed', tone: 'ink', price: 1790,
    acidity: 'high', density: 'mid', taste: 'fruit', features: ['mono', 'microlot', 'limited'],
    tags: ['microlot', 'new'], rating: 4.9, reviews: 127,
  }),
].map((p, i) => ({ id: 'p' + (i + 1), ...p }));

// Наборы: несколько пачек по 250 г со скидкой на сумму
export const BUNDLES = [
  {
    handle: 'starter', title: 'Набор «Знакомство»', tag: 'Хит',
    desc: 'Три страны и три профиля: чайная Эфиопия, сбалансированная Колумбия и шоколадная Бразилия.',
    items: ['ethiopia-guji', 'colombia-huila', 'brazil-cerrado'], discount: 0.15,
  },
  {
    handle: 'espresso-trio', title: 'Эспрессо-трио', tag: 'Для кофемашины',
    desc: 'Плотные сорта и смесь под эспрессо, капучино и флэт уайт.',
    items: ['brazil-mogiana', 'colombia-huila', 'blend-midnight'], discount: 0.12,
  },
  {
    handle: 'filter-tasting', title: 'Фильтр-дегустация', tag: '4 пачки',
    desc: 'Четыре ярких лота для пуровера: сравните Кению, Эфиопию, Руанду и Бурунди за одну неделю.',
    items: ['kenya-nyeri', 'ethiopia-guji', 'rwanda-nyamasheke', 'burundi-kayanza'], discount: 0.18,
  },
  {
    handle: 'microlots', title: 'Микролоты сезона', tag: 'Limited',
    desc: 'Небольшие партии с необычной обработкой — для тех, кто уже пробовал всё.',
    items: ['kenya-kirinyaga', 'ethiopia-sidamo-anaerobic', 'rwanda-nyamasheke'], discount: 0.15,
  },
  {
    handle: 'evening', title: 'Вечерний декаф', tag: 'Без кофеина',
    desc: 'Два декафа с полноценным вкусом — можно пить хоть перед сном.',
    items: ['peru-decaf', 'colombia-decaf'], discount: 0.1,
  },
];
