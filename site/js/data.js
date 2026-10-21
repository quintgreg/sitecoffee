/* KORA — справочники, цвета пачек и формулы цен (общие для браузера и сервера). Цена указана за 250 г. */
window.KORA = (() => {
  const TONES = {
    saffron: { bg: '#E8A33D', fg: '#1A140C' },
    ember: { bg: '#B5502E', fg: '#FBEDE4' },
    rose: { bg: '#DE9A88', fg: '#2A1410' },
    bone: { bg: '#E6DCCB', fg: '#1E1A16' },
    moss: { bg: '#9DB07A', fg: '#16190F' },
    ink: { bg: '#33415A', fg: '#EEF1F6' },
  };

  const LABELS = {
    method: { espresso: 'Эспрессо', filter: 'Фильтр', decaf: 'Без кофеина' },
    methodShort: { espresso: 'эспрессо', filter: 'фильтр', decaf: 'декаф' },
    roast: { light: 'Светлая', medium: 'Средняя', dark: 'Тёмная' },
    level: { low: 'Низкая', mid: 'Средняя', high: 'Высокая' },
    taste: {
      choco: 'Шоколад / Орехи',
      flower: 'Цветы / Цитрусы',
      fruit: 'Фрукты / Ягоды',
      funky: 'Алкоголь / Фанки',
    },
    process: {
      washed: 'Мытая',
      natural: 'Натуральная',
      honey: 'Хани',
      anaerobic: 'Анаэробная',
      wethulled: 'Гилинг басах',
      blend: 'Смесь',
      other: 'Другая',
    },
    feature: {
      blend: 'Смесь',
      decaf: 'Без кофеина',
      mono: 'Моносорт',
      microlot: 'Микролот',
      milk: 'Для молочных напитков',
      limited: 'Limited edition',
    },
    tab: {
      all: 'Все',
      recommended: 'Рекомендуем',
      popular: 'Популярное',
      new: 'Новинки',
      week: 'Сорт недели',
      ending: 'Заканчивается',
      microlot: 'Микролот',
      fav: 'Избранное',
    },
    grind: { beans: 'Зерно', espresso: 'Эспрессо', filter: 'Фильтр', french: 'Френч-пресс' },
    grindShort: { beans: 'зерно', espresso: 'помол эспрессо', filter: 'помол фильтр', french: 'помол френч' },
  };

  const LEVEL_PCT = { low: 30, mid: 60, high: 90 };

  // Каталог хранится только в базе (data/kora.db) и приходит с сервера через /api/catalog —
  // api.js заполняет эти массивы. Начальные данные для пустой базы — server/seed.js.
  const PRODUCTS = [];
  const BUNDLES = [];

  /* ---------- цены (общие для браузера и сервера) ---------- */
  const WEIGHTS = [250, 500, 1000];
  const GRINDS = ['beans', 'espresso', 'filter', 'french'];
  const round10 = (x) => Math.round(x / 10) * 10;

  function basePrice(p, w) {
    if (w === 250) return p.price;
    if (p.prices && p.prices[w]) return p.prices[w];
    return round10(p.price * (w === 500 ? 1.87 : 3.55));
  }
  function priceOf(p, w) {
    const base = basePrice(p, w);
    return p.sale ? { now: round10(base * (1 - p.sale)), old: base } : { now: base, old: null };
  }
  // products: Map handle → product. null, если какого-то сорта нет в продаже
  function bundlePrice(b, products) {
    const items = b.items.map((h) => products.get(h));
    if (items.some((p) => !p)) return null;
    // «старая» цена — сумма текущих цен пачек, с учётом скидок на сорта
    const old = items.reduce((s, p) => s + priceOf(p, 250).now, 0);
    return { now: round10(old * (1 - b.discount)), old };
  }
  // variantId: «handle|вес|помол» для сорта, «set:handle|помол» для набора
  function parseVariant(id, products, bundles) {
    const s = String(id);
    // принимаем только каноничную запись id, иначе «0250» и «250» станут разными строками корзины
    if (s.startsWith('set:')) {
      const parts = s.slice(4).split('|');
      const [handle, grind] = parts;
      const bundle = bundles.get(handle);
      if (parts.length !== 2 || !bundle || !GRINDS.includes(grind) || !bundlePrice(bundle, products)) return null;
      return { kind: 'set', bundle, grind, unit: bundlePrice(bundle, products).now };
    }
    const parts = s.split('|');
    const [handle, w, grind] = parts;
    const product = products.get(handle);
    if (parts.length !== 3 || !product || !WEIGHTS.includes(+w) || String(+w) !== w || !GRINDS.includes(grind)) return null;
    return { kind: 'product', product, weight: +w, grind, unit: priceOf(product, +w).now };
  }

  return {
    TONES, LABELS, LEVEL_PCT, PRODUCTS, BUNDLES,
    WEIGHTS, GRINDS, round10, basePrice, priceOf, bundlePrice, parseVariant,
  };
})();
