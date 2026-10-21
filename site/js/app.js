/* KORA — клиентская логика: роутер, каталог с фильтрами в URL, оптимистичная корзина, страница товара. */
window.KORA_API.ready.then((API) => {
  'use strict';

  const KORA = window.KORA;
  const { TONES, LABELS, LEVEL_PCT, PRODUCTS, BUNDLES, WEIGHTS, GRINDS, priceOf, bundlePrice } = KORA;
  const byHandle = new Map();
  const bundleByHandle = new Map();
  const COUNTRIES = [];
  const ORDER = new Map(); // handle → место в каталоге (сервер отдаёт сорта в порядке из админки)
  // индексы каталога; пересобираются после правок сортов в админке
  function rebuildIndex() {
    byHandle.clear();
    ORDER.clear();
    PRODUCTS.forEach((p, i) => { byHandle.set(p.handle, p); ORDER.set(p.handle, i); });
    bundleByHandle.clear();
    BUNDLES.forEach((b) => bundleByHandle.set(b.handle, b));
    COUNTRIES.splice(0, COUNTRIES.length, ...[...new Set(PRODUCTS.map((p) => p.country))].sort((a, b) => a.localeCompare(b, 'ru')));
  }
  rebuildIndex();

  const FREE_SHIPPING = 3000;
  const PAGE_SIZE = 6;
  const MULTI = ['acidity', 'density', 'taste', 'process', 'country', 'feature'];
  const DEFAULT_TITLE = document.title;
  const FACET_TITLES = {
    acidity: 'Кислотность', density: 'Плотность', taste: 'Вкус кофе',
    process: 'Способ обработки', country: 'Страна произрастания', feature: 'Особенность кофе',
  };
  const SORTS = {
    order: 'По умолчанию', popular: 'По популярности', rating: 'По рейтингу',
    'price-asc': 'Сначала дешевле', 'price-desc': 'Сначала дороже', name: 'По названию',
  };
  const QUICK = [
    { id: 'machine', label: 'Для кофемашины', patch: { method: 'espresso' } },
    { id: 'milk', label: 'Для молочных напитков', patch: { feature: ['milk'] } },
    { id: 'pourover', label: 'Для пуровера', patch: { method: 'filter' } },
    { id: 'lowacid', label: 'Низкая кислотность', patch: { acidity: ['low'] } },
    { id: 'berry', label: 'Ягоды и фрукты', patch: { taste: ['fruit'] } },
    { id: 'decaf', label: 'Без кофеина', patch: { method: 'decaf' } },
    { id: 'micro', label: 'Микролоты', patch: { feature: ['microlot'] } },
    { id: 'limited', label: 'Limited edition', patch: { feature: ['limited'] } },
  ];
  const DEFAULTS = {
    method: '', roast: '', tab: 'all', sort: 'order', q: '', p: 1, from: 1,
    acidity: [], density: [], taste: [], process: [], country: [], feature: [],
  };

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const nf = new Intl.NumberFormat('ru-RU');
  const fmt = (n) => nf.format(n) + ' ₽';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
  const weightLabel = (w) => (w === 1000 ? '1 кг' : w + ' г');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const behavior = () => (reduceMotion.matches ? 'auto' : 'smooth');

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
  };

  const ICON = {
    star: '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>',
    heart: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z"/></svg>',
    x: '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    check: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
    sliders: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  };

  /* ---------- цены и варианты ---------- */
  // формулы цен общие с сервером — см. data.js
  const bulkDiscount = (p, w) => Math.round((1 - KORA.basePrice(p, w) / ((p.price * w) / 250)) * 100);
  const variantId = (h, w, g) => `${h}|${w}|${g}`;
  const setVariantId = (h, g) => `set:${h}|${g}`;
  const parseVariant = (id) => KORA.parseVariant(id, byHandle, bundleByHandle);
  const priceHTML = (pr) =>
    `<span class="price">${pr.old ? `<s class="price__old"><span class="visually-hidden">Было </span>${fmt(pr.old)}</s>` : ''}<span class="price__now">${fmt(pr.now)}</span></span>`;

  // выбор веса/помола в карточках (переживает перерисовку и переходы)
  const cardSel = new Map();
  const getSel = (p) => cardSel.get(p.handle) || { weight: 250, grind: 'beans' };
  const setSel = (p, patch) => cardSel.set(p.handle, { ...getSel(p), ...patch });

  /* ---------- избранное ---------- */
  const favs = new Set(API.user && API.favorites ? API.favorites : store.get('kora-favs', []));
  const favBtn = (p) =>
    `<button type="button" class="fav" data-action="fav" data-handle="${p.handle}" aria-pressed="${favs.has(p.handle)}" aria-label="В избранное: ${esc(p.title)}">${ICON.heart}</button>`;

  /* ---------- тосты ---------- */
  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast--' + type : '');
    el.textContent = msg;
    $('#toasts').append(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 320);
    }, 3200);
  }

  /* ======================================================================
     Корзина: mock-«сервер» + оптимистичный слой (аналог useOptimistic)
     ====================================================================== */
  const Cart = (() => {
    const KEY = 'kora-cart-v1';
    // ?fail=0.3 перед # — доля запросов, которые «упадут» (демо отката)
    const failRate = (() => {
      const m = location.search.match(/[?&]fail=([\d.]+)/);
      return m ? Math.min(1, +m[1]) : 0;
    })();
    const normalize = (c) => ({ lines: ((c && c.lines) || []).filter((l) => parseVariant(l.variantId) && l.qty > 0) });

    let server = normalize(API.online ? API.initialCart : store.get(KEY));
    let pending = [];
    let seq = 0;
    let queue = Promise.resolve();
    const drafts = new Map();
    const listeners = new Set();

    function reduce(cart, op) {
      if (op.type === 'clear') return { lines: [] };
      const lines = cart.lines.map((l) => ({ ...l }));
      const i = lines.findIndex((l) => l.variantId === op.variantId);
      if (op.type === 'add') {
        if (i >= 0) lines[i].qty = Math.min(99, lines[i].qty + op.qty);
        else lines.push({ variantId: op.variantId, qty: op.qty });
      } else if (op.type === 'set') {
        if (op.qty <= 0) { if (i >= 0) lines.splice(i, 1); }
        else if (i >= 0) lines[i].qty = Math.min(99, op.qty);
        else lines.push({ variantId: op.variantId, qty: op.qty });
      } else if (op.type === 'remove' && i >= 0) {
        lines.splice(i, 1);
      }
      return { lines };
    }

    // «Server action»: настоящий API, если бэкенд запущен, иначе mock с задержкой 500–800 мс
    async function serverMutate(op) {
      if (API.online) {
        if (Math.random() < failRate) { await sleep(400); throw new Error('Simulated failure'); }
        return normalize(await API.request('POST', '/api/cart/ops', { type: op.type, variantId: op.variantId, qty: op.qty }));
      }
      await sleep(500 + Math.random() * 300);
      if (Math.random() < failRate) throw new Error('Mock commerce error');
      const next = reduce(normalize(store.get(KEY)), op);
      store.set(KEY, next);
      return next;
    }

    const emit = () => listeners.forEach((fn) => fn());

    function send(op) {
      op.sent = true;
      emit();
      queue = queue
        .then(() => serverMutate(op))
        .then(
          (next) => { server = next; },
          (err) => { toast(err && err.status === 404 ? err.message : 'Не удалось обновить корзину', 'error'); }, // op выкидывается → откат
        )
        .finally(() => {
          pending = pending.filter((o) => o !== op);
          emit();
        });
    }
    function dispatch(op) {
      op.id = ++seq;
      pending.push(op);
      send(op);
    }
    function cancelDraft(id) {
      const d = drafts.get(id);
      if (!d) return null;
      clearTimeout(d.timer);
      drafts.delete(id);
      return d;
    }

    return {
      get cart() { return pending.reduce(reduce, server); },
      get isSyncing() { return pending.some((o) => o.sent); },
      subscribe(fn) { listeners.add(fn); },
      qtyOf(id) { const l = this.cart.lines.find((x) => x.variantId === id); return l ? l.qty : 0; },
      add(id, qty = 1) {
        const d = cancelDraft(id);
        if (d) send(d);
        dispatch({ type: 'add', variantId: id, qty });
      },
      // степпер: клики копятся 300 мс, на сервер уходит итоговое количество
      setQty(id, qty) {
        if (qty <= 0) return this.remove(id);
        let op = drafts.get(id);
        if (op) {
          op.qty = qty;
          clearTimeout(op.timer);
        } else {
          op = { type: 'set', variantId: id, qty, id: ++seq };
          drafts.set(id, op);
          pending.push(op);
        }
        op.timer = setTimeout(() => { drafts.delete(id); send(op); }, 300);
        emit();
      },
      remove(id) {
        const d = cancelDraft(id);
        if (d) pending = pending.filter((o) => o !== d);
        dispatch({ type: 'remove', variantId: id });
      },
      // очистка — обычная оптимистичная операция: при ошибке сервера товары вернутся
      clear() {
        drafts.forEach((d) => { clearTimeout(d.timer); pending = pending.filter((o) => o !== d); });
        drafts.clear();
        dispatch({ type: 'clear' });
      },
      // после входа/выхода/заказа серверная корзина могла измениться целиком
      reset(cart) {
        drafts.forEach((d) => clearTimeout(d.timer));
        drafts.clear();
        pending = [];
        server = normalize(cart);
        emit();
      },
      async refresh() {
        if (API.online) this.reset(await API.request('GET', '/api/cart'));
      },
    };
  })();

  function cartView() {
    // строки с сортами, которые сняли с продажи после загрузки страницы, пропускаем
    const lines = Cart.cart.lines.flatMap((l) => {
      const v = parseVariant(l.variantId);
      return v ? [{ ...l, ...v, sum: v.unit * l.qty }] : [];
    });
    return {
      lines,
      count: lines.reduce((s, l) => s + l.qty, 0),
      total: lines.reduce((s, l) => s + l.sum, 0),
    };
  }

  /* ---------- общие куски разметки ---------- */
  function packHTML(p, { size = 'md', weight = 250, date = false, cls = '', style = '' } = {}) {
    const t = TONES[p.tone] || TONES.bone;
    // фото по ссылке из базы ложится поверх нарисованной пачки; не загрузилось — остаётся рисунок
    const img = p.image
      ? `<img class="pack__img" src="${esc(p.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add('is-loaded')" onerror="this.remove()">`
      : '';
    return `<div class="pack pack--${size} ${cls}${img ? ' has-img' : ''}" style="--pack-bg:${t.bg};--pack-fg:${t.fg};${style}"><div class="pack__in">
      <div class="pack__top"><span class="pack__brand">KORA</span><span class="pack__weight">${weightLabel(weight)}</span></div>
      ${date ? '<span class="pack__date">Обжарено: [дата обжарки]</span>' : ''}
      <div class="pack__bottom"><span class="pack__title">${esc(p.title)}</span><span class="pack__method">${LABELS.methodShort[p.method]}</span></div>
    </div>${img}</div>`;
  }

  // ноты вкуса — пилюли с цветной точкой дескриптора
  const notesHTML = (p) => `
    <ul class="notes" aria-label="Ноты вкуса">
      ${p.notes.map(([n, c]) => `<li class="note" style="--c:${c}">${esc(cap(n))}</li>`).join('')}
    </ul>`;

  const scalesHTML = (p) => `
    <div class="scales">
      ${['density', 'acidity'].map((k) => `
        <div>
          <span class="scale__label">${k === 'density' ? 'Плотность' : 'Кислотность'}</span>
          <div class="scale__bar" role="img" aria-label="${k === 'density' ? 'Плотность' : 'Кислотность'}: ${LABELS.level[p[k]].toLowerCase()}"><i style="width:${LEVEL_PCT[p[k]]}%"></i></div>
        </div>`).join('')}
    </div>`;

  function badgesHTML(p) {
    return [
      p.tags.includes('week') ? '<span class="tag tag--accent">Сорт недели</span>' : '',
      p.sale ? `<span class="tag tag--light">−${Math.round(p.sale * 100)}%</span>` : '',
      p.tags.includes('new') ? '<span class="tag">Новинка</span>' : '',
      p.tags.includes('ending') ? '<span class="tag">Заканчивается</span>' : '',
    ].join('');
  }

  const reviewsWord = (n) => plural(n, 'отзыв', 'отзыва', 'отзывов');
  const quickLabel = (sel) => `В корзину · ${weightLabel(sel.weight)}`;

  function cardHTML(p, { mini = false, index = 0 } = {}) {
    const sel = getSel(p);
    const pr = priceOf(p, sel.weight);
    const url = `#/product/${p.handle}`;
    const opts = mini ? '' : `
      <div class="card__opts">
        <div class="seg" role="group" aria-label="Вес">
          ${WEIGHTS.map((w) => {
            const d = w === 1000 ? bulkDiscount(p, w) : 0;
            return `<button type="button" data-action="weight" data-handle="${p.handle}" data-weight="${w}" aria-pressed="${sel.weight === w}">${weightLabel(w)}${d ? `<sup>−${d}%</sup>` : ''}</button>`;
          }).join('')}
        </div>
        <label class="visually-hidden" for="grind-${p.handle}">Помол: ${esc(p.title)}</label>
        <select class="select" id="grind-${p.handle}" data-role="grind" data-handle="${p.handle}">
          ${GRINDS.map((g) => `<option value="${g}"${sel.grind === g ? ' selected' : ''}>${g === 'beans' ? 'В зёрнах' : 'Молотый: ' + LABELS.grind[g].toLowerCase()}</option>`).join('')}
        </select>
      </div>`;

    return `
    <article class="card${mini ? ' card--mini' : ''}" data-card="${p.handle}" style="animation-delay:${Math.min(index, 8) * 40}ms">
      <div class="card__stage">
        <a class="card__link" href="${url}" aria-label="${esc(p.title)} — подробнее">
          ${packHTML(p, { weight: sel.weight, cls: 'card__pack' })}
        </a>
        <div class="card__top"><div class="card__badges">${badgesHTML(p)}</div>${favBtn(p)}</div>
        <button type="button" class="btn btn--accent card__quick" data-action="add" data-handle="${p.handle}">${quickLabel(sel)}</button>
      </div>
      <div class="card__body">
        ${mini ? '' : `
        <div class="card__meta">
          <span>${LABELS.methodShort[p.method]}</span>
          ${p.reviews
            ? `<a class="rating" href="${url}" aria-label="Рейтинг ${p.rating}, ${p.reviews} ${reviewsWord(p.reviews)}">${ICON.star}${p.rating}<span aria-hidden="true">· ${nf.format(p.reviews)}</span></a>`
            : `<a class="rating" href="${url}">нет отзывов</a>`}
          <span>${LABELS.process[p.process].toLowerCase()}</span>
        </div>`}
        <div class="card__head">
          <h3 class="card__title"><a href="${url}">${esc(p.title)}</a></h3>
          ${priceHTML(pr)}
        </div>
        ${mini ? '' : scalesHTML(p)}
        ${notesHTML(p)}
        ${opts}
        <div class="card__tags"><span class="tag">${esc(p.country)}</span><span class="tag">${LABELS.roast[p.roast]} обжарка</span></div>
      </div>
    </article>`;
  }

  function refreshCards(handle) {
    const p = byHandle.get(handle);
    const sel = getSel(p);
    $$(`[data-card="${handle}"]`).forEach((card) => {
      const price = card.querySelector('.price');
      if (price) price.outerHTML = priceHTML(priceOf(p, sel.weight));
      card.querySelectorAll('[data-action="weight"]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.weight === sel.weight)));
      const w = card.querySelector('.pack__weight');
      if (w) w.textContent = weightLabel(sel.weight);
      const g = card.querySelector('[data-role="grind"]');
      if (g) g.value = sel.grind;
      const q = card.querySelector('.card__quick');
      if (q && !q.classList.contains('is-done')) q.textContent = quickLabel(sel);
    });
  }

  function flashDone(btn, restore) {
    btn.classList.add('is-done');
    btn.textContent = 'Добавлено ✓';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      btn.classList.remove('is-done');
      btn.textContent = restore();
    }, 1600);
  }

  // перерисовка без потери фокуса (клавиатурная навигация)
  function preserveFocus(root, fn, fallback) {
    const a = document.activeElement;
    let sel = null;
    if (a && a !== document.body && root.contains(a) && a.dataset.action) {
      sel = `[data-action="${a.dataset.action}"]` + ['variant', 'handle', 'weight', 'key', 'value', 'v']
        .filter((k) => a.dataset[k] != null)
        .map((k) => `[data-${k}="${CSS.escape(a.dataset[k])}"]`).join('');
    }
    fn();
    if (sel) {
      const el = root.querySelector(sel) || (fallback && fallback());
      if (el) el.focus({ preventScroll: true });
    }
  }

  /* ======================================================================
     UI корзины
     ====================================================================== */
  const cartEls = {};
  let prevCount = null;

  function initCartFoot() {
    const foot = $('#cart-foot');
    foot.innerHTML = `
      <div class="ship"><span id="ship-text"></span><div class="ship__bar"><i id="ship-bar"></i></div></div>
      <div class="total"><span>Итого</span><b id="cart-total"></b></div>
      <button type="button" class="btn btn--accent btn--block btn--lg" data-action="checkout">Оформить заказ</button>
      <button type="button" class="drawer__clear" data-action="cart-clear">Очистить корзину</button>`;
    Object.assign(cartEls, {
      foot, lines: $('#cart-lines'), sync: $('#cart-sync'), badge: $('#cart-badge'),
      sum: $('#cart-sum'), btn: $('#cart-btn'), title: $('#cart-title'),
      shipText: $('#ship-text'), shipBar: $('#ship-bar'), total: $('#cart-total'),
    });
  }

  // единое описание строки корзины для сорта и набора
  function lineInfo(l) {
    if (l.kind === 'set') {
      return {
        title: l.bundle.title, href: '#/sets', scroll: '', pack: byHandle.get(l.bundle.items[0]), weight: 250,
        variant: `${l.bundle.items.length} × 250 г · ${LABELS.grindShort[l.grind]}`,
      };
    }
    return {
      title: l.product.title, href: `#/product/${l.product.handle}`, scroll: '', pack: l.product, weight: l.weight,
      variant: `${weightLabel(l.weight)} · ${LABELS.grindShort[l.grind]}`,
    };
  }

  const lineHTML = (l) => {
    const i = lineInfo(l);
    const link = `href="${i.href}"${i.scroll ? ` data-scroll="${i.scroll}"` : ''} data-action="cart-nav"`;
    return `
    <div class="line">
      <a class="line__pack" ${link} tabindex="-1" aria-hidden="true">${packHTML(i.pack, { size: 'sm', weight: i.weight })}</a>
      <div>
        <a class="line__title" ${link}>${esc(i.title)}</a>
        <div class="line__variant">${i.variant}</div>
        <div class="line__controls">
          <div class="stepper" role="group" aria-label="Количество: ${esc(i.title)}">
            <button type="button" data-action="line-dec" data-variant="${l.variantId}" aria-label="Уменьшить">−</button>
            <output>${l.qty}</output>
            <button type="button" data-action="line-inc" data-variant="${l.variantId}" aria-label="Увеличить">+</button>
          </div>
          <button type="button" class="line__remove" data-action="line-remove" data-variant="${l.variantId}">Удалить</button>
        </div>
      </div>
      <div class="line__sum">${fmt(l.sum)}</div>
    </div>`;
  };

  function renderCart() {
    const { lines, count, total } = cartView();
    const e = cartEls;

    e.badge.hidden = count === 0;
    e.badge.textContent = count > 99 ? '99+' : String(count);
    if (prevCount !== null && count !== prevCount) {
      e.badge.classList.remove('is-pulse');
      void e.badge.offsetWidth;
      e.badge.classList.add('is-pulse');
    }
    prevCount = count;
    e.sum.textContent = fmt(total);
    e.sum.hidden = count === 0; // пустая корзина — без «0 ₽»
    e.btn.setAttribute('aria-label', `Корзина: ${count} ${plural(count, 'товар', 'товара', 'товаров')} на ${fmt(total)}`);
    e.title.innerHTML = `Корзина${count ? `<sup>${count}</sup>` : ''}`;

    const syncing = Cart.isSyncing;
    e.sync.classList.toggle('is-on', syncing);
    e.sync.textContent = syncing ? 'Синхронизация с магазином…' : '';

    preserveFocus(e.lines, () => {
      e.lines.innerHTML = lines.length
        ? lines.map(lineHTML).join('')
        : `<div class="drawer__empty">
             ${PRODUCTS[0] ? packHTML(PRODUCTS[0], { size: 'md' }) : ''}
             <p>Корзина пока пуста</p>
             <a class="btn btn--ghost" href="#/catalog" data-action="cart-nav">Перейти в каталог</a>
           </div>`;
    }, () => $('[data-action="close-cart"]', $('#cart-drawer')));

    e.foot.hidden = !count;
    const left = FREE_SHIPPING - total;
    e.shipText.innerHTML = left > 0 ? `До бесплатной доставки <b>${fmt(left)}</b>` : '<b>Доставка бесплатно</b>';
    e.shipBar.style.width = Math.min(100, (total / FREE_SHIPPING) * 100) + '%';
    e.total.textContent = fmt(total);
  }

  /* ---------- drawer'ы: открытие, focus trap ---------- */
  let cartOpen = false;
  let filtersOpen = false;

  function openCart() {
    const d = $('#cart-drawer'), o = $('#cart-overlay');
    d.hidden = o.hidden = false;
    void d.offsetWidth;
    d.classList.add('is-open');
    o.classList.add('is-open');
    document.body.classList.add('is-locked');
    cartOpen = true;
    $('[data-action="close-cart"]', d).focus();
  }
  function closeCart(restoreFocus = true) {
    if (!cartOpen) return;
    const d = $('#cart-drawer'), o = $('#cart-overlay');
    d.classList.remove('is-open');
    o.classList.remove('is-open');
    cartOpen = false;
    if (!filtersOpen) document.body.classList.remove('is-locked');
    setTimeout(() => { if (!cartOpen) d.hidden = o.hidden = true; }, reduceMotion.matches ? 0 : 400);
    if (restoreFocus) $('#cart-btn').focus();
  }

  function openFilters() {
    const f = $('#filters');
    if (!f) return;
    f.classList.add('is-open');
    $('.filters-overlay').hidden = false;
    document.body.classList.add('is-locked');
    filtersOpen = true;
    $('[data-action="open-filters"]').setAttribute('aria-expanded', 'true');
    $('.filters__head [data-action="close-filters"]').focus();
  }
  function closeFilters(restoreFocus = true) {
    if (!filtersOpen) return;
    $('#filters').classList.remove('is-open');
    $('.filters-overlay').hidden = true;
    filtersOpen = false;
    if (!cartOpen) document.body.classList.remove('is-locked');
    const btn = $('[data-action="open-filters"]');
    btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) btn.focus();
  }
  matchMedia('(min-width: 1081px)').addEventListener('change', (e) => { if (e.matches) closeFilters(false); });

  function trapFocus(container, e) {
    const items = $$('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])', container)
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
      e.preventDefault(); first.focus();
    }
  }

  /* ======================================================================
     Фильтры ⇄ URL
     ====================================================================== */
  const state = { view: null, f: { ...DEFAULTS } };
  let lastCatalogHash = '#/catalog';
  let catalogScrollY = 0;
  let pendingScroll = null;

  const ALLOWED = {
    method: Object.keys(LABELS.method), roast: Object.keys(LABELS.roast),
    acidity: Object.keys(LABELS.level), density: Object.keys(LABELS.level),
    taste: Object.keys(LABELS.taste), process: Object.keys(LABELS.process),
    country: COUNTRIES, feature: Object.keys(LABELS.feature),
    tab: Object.keys(LABELS.tab), sort: Object.keys(SORTS),
  };

  function readFilters(params) {
    const f = { ...DEFAULTS };
    const one = (k) => { const v = params.get(k); return v && ALLOWED[k].includes(v) ? v : DEFAULTS[k]; };
    f.method = one('method');
    f.roast = one('roast');
    f.tab = one('tab');
    f.sort = one('sort');
    f.q = (params.get('q') || '').slice(0, 60);
    MULTI.forEach((k) => {
      f[k] = [...new Set((params.get(k) || '').split(',').filter((v) => ALLOWED[k].includes(v)))];
    });
    f.p = Math.max(1, parseInt(params.get('page'), 10) || 1);
    f.from = Math.min(f.p, Math.max(1, parseInt(params.get('from'), 10) || 1));
    return f;
  }

  function filtersToQuery(f) {
    const parts = [];
    const put = (k, v) => parts.push(`${k}=${encodeURIComponent(v).replace(/%2C/g, ',')}`);
    if (f.method) put('method', f.method);
    if (f.roast) put('roast', f.roast);
    MULTI.forEach((k) => { if (f[k].length) put(k, f[k].join(',')); });
    if (f.tab !== 'all') put('tab', f.tab);
    if (f.sort !== DEFAULTS.sort) put('sort', f.sort);
    if (f.q) put('q', f.q);
    if (f.from > 1) put('from', f.from);
    if (f.p > 1) put('page', f.p);
    return parts.join('&');
  }
  const filtersHash = (f) => { const qs = filtersToQuery(f); return '#/catalog' + (qs ? '?' + qs : ''); };

  function setFilters(patch, { keepPage = false } = {}) {
    const f = { ...state.f, ...patch };
    if (!keepPage) { f.p = 1; f.from = 1; }
    const hash = filtersHash(f);
    if (state.view !== 'catalog') {
      location.hash = hash;
      return;
    }
    state.f = f;
    location.replace(hash); // без новой записи в истории; hashchange ниже увидит, что состояние уже применено
    updateCatalog();
  }

  function valuesOf(p, k) {
    if (k === 'feature') return p.features;
    return [p[k]];
  }

  function matches(p, f, skip) {
    if (skip !== 'method' && f.method && p.method !== f.method) return false;
    if (skip !== 'roast' && f.roast && p.roast !== f.roast) return false;
    for (const k of MULTI) {
      if (k !== skip && f[k].length && !valuesOf(p, k).some((v) => f[k].includes(v))) return false;
    }
    if (skip !== 'tab' && f.tab !== 'all') {
      if (f.tab === 'fav' ? !favs.has(p.handle) : !p.tags.includes(f.tab)) return false;
    }
    if (f.q) {
      const hay = norm([p.title, p.country, p.region, ...p.notes.map((n) => n[0]), LABELS.process[p.process], LABELS.method[p.method]].join(' '));
      if (!norm(f.q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  const SORTERS = {
    order: (a, b) => (ORDER.get(a.handle) ?? 0) - (ORDER.get(b.handle) ?? 0), // порядок из админки
    popular: (a, b) => b.reviews - a.reviews,
    rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
    'price-asc': (a, b) => priceOf(a, 250).now - priceOf(b, 250).now,
    'price-desc': (a, b) => priceOf(b, 250).now - priceOf(a, 250).now,
    name: (a, b) => a.title.localeCompare(b.title, 'ru'),
  };
  const getList = (f) => PRODUCTS.filter((p) => matches(p, f)).sort(SORTERS[f.sort]);

  function optionLabel(k, v) {
    if (k === 'acidity' || k === 'density') return `${FACET_TITLES[k]}: ${LABELS.level[v].toLowerCase()}`;
    if (k === 'country') return v;
    return LABELS[k][v];
  }

  function isQuickActive(q) {
    return filtersToQuery({ ...state.f, p: 1, from: 1 }) === filtersToQuery({ ...DEFAULTS, sort: state.f.sort, ...q.patch });
  }

  /* ======================================================================
     Страницы: главная, каталог, обжарочная, подписка
     ====================================================================== */
  const main = $('#main');

  function heroHTML() {
    const countries = new Set(PRODUCTS.filter((p) => p.country !== 'Смесь').map((p) => p.country)).size;
    // любимые пачки для витрины; если какую-то сняли с продажи — подставляем другие сорта
    const wanted = ['peru-decaf', 'ethiopia-guji', 'kenya-nyeri'];
    const spare = PRODUCTS.filter((p) => !wanted.includes(p.handle));
    const packs = wanted.map((h) => byHandle.get(h) || spare.shift());
    const heroPack = (p, opts) => (p ? packHTML(p, opts) : '');
    return `
    <section class="hero" id="top">
      <div class="container hero__inner">
        <div class="hero__text">
          <p class="eyebrow">Specialty · свежая обжарка · Москва</p>
          <h1 class="hero__title">Кофе, обжаренный <em>на этой неделе</em></h1>
          <p class="hero__lead">Зерно из Эфиопии, Кении, Колумбии и ещё ${countries - 3} ${plural(countries - 3, 'страны', 'стран', 'стран')}. Обжариваем маленькими партиями по вторникам и отправляем в тот же день.</p>
          <div class="hero__ctas">
            <a class="btn btn--accent" href="#/catalog">Выбрать кофе →</a>
            <a class="btn btn--ghost" href="#/subscription">Оформить подписку</a>
          </div>
          <div class="hero__facts">
            <div><b>${PRODUCTS.length}</b><span class="eyebrow">сортов в наличии</span></div>
            <div><b>${countries}</b><span class="eyebrow">стран</span></div>
            <div><b>${nf.format(FREE_SHIPPING)} ₽</b><span class="eyebrow">бесплатная доставка от</span></div>
          </div>
        </div>
        <div class="hero__stage" aria-hidden="true">
          <span class="hero__stamp">Обжарка · вторник</span>
          ${heroPack(packs[0], { cls: 'hero__pack hero__pack--1' })}
          ${heroPack(packs[1], { size: 'lg', cls: 'hero__pack hero__pack--2' })}
          ${heroPack(packs[2], { cls: 'hero__pack hero__pack--3' })}
        </div>
      </div>
    </section>`;
  }

  function facetHTML(k, open) {
    const opts = k === 'acidity' || k === 'density'
      ? Object.entries(LABELS.level)
      : k === 'country' ? COUNTRIES.map((c) => [c, c]) : Object.entries(LABELS[k]);
    return `
      <details class="facet"${open ? ' open' : ''}>
        <summary>${FACET_TITLES[k]}</summary>
        <div class="facet__list" role="group" aria-label="${FACET_TITLES[k]}">
          ${opts.map(([v, label]) => `
            <label class="check">
              <input type="checkbox" data-facet="${k}" value="${esc(v)}">
              <span class="check__box">${ICON.check}</span>
              <span>${esc(label)}</span>
              <span class="check__count"></span>
            </label>`).join('')}
        </div>
      </details>`;
  }

  function catalogHTML() {
    const pills = (key, all, labels, aria) => `
      <div class="filterbar__group" role="group" aria-label="${aria}">
        <span class="eyebrow filterbar__label" aria-hidden="true">${aria}</span>
        ${[['', all], ...Object.entries(labels)].map(([v, l]) =>
          `<button type="button" class="pill" data-action="pill" data-key="${key}" data-value="${v}" aria-pressed="false">${l}</button>`).join('')}
      </div>`;
    return `
    <section class="section catalog page" id="catalog" aria-labelledby="catalog-title">
      <div class="container">
        <p class="eyebrow page__eyebrow">Кофе в зёрнах и молотый</p>
        <div class="section__head">
          <h1 class="h2 page__title" id="catalog-title">Каталог</h1>
          <span class="count" id="cat-count" aria-live="polite"></span>
        </div>
        <div class="filterbar">
          ${pills('method', 'Все', LABELS.method, 'Способ')}
          ${pills('roast', 'Любая', LABELS.roast, 'Обжарка')}
        </div>
        <div class="quick">
          <span class="eyebrow quick__label">Быстрый выбор</span>
          ${QUICK.map((q) => `<button type="button" class="pill pill--sm" data-action="quick" data-v="${q.id}" aria-pressed="false">${q.label}</button>`).join('')}
        </div>
        <div class="toolbar">
          <div class="tabs" id="tabs" role="group" aria-label="Подборки"></div>
          <div class="toolbar__right">
            <button type="button" class="pill filters-toggle" data-action="open-filters" aria-controls="filters" aria-expanded="false">${ICON.sliders}Фильтры<span class="pill__count" id="filters-count"></span></button>
            <label class="visually-hidden" for="sort">Сортировка</label>
            <select class="select" id="sort">
              ${Object.entries(SORTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="chips" id="chips"></div>
        <div class="catalog__layout">
          <div class="filters-overlay" data-action="close-filters" hidden></div>
          <aside class="filters" id="filters" aria-label="Фильтры каталога">
            <div class="filters__head">
              <h3 class="drawer__title">Фильтры</h3>
              <button type="button" class="icon-btn" data-action="close-filters" aria-label="Закрыть фильтры">${ICON.x}</button>
            </div>
            <div class="filters__scroll">
              <div class="filters__summary">
                <span class="count" id="filters-summary"></span>
                <button type="button" class="filters__reset" data-action="reset">Сбросить</button>
              </div>
              ${MULTI.map((k, i) => facetHTML(k, i < 4)).join('')}
            </div>
            <div class="filters__foot">
              <button type="button" class="btn btn--accent btn--block" data-action="close-filters" id="filters-apply">Показать</button>
            </div>
          </aside>
          <div id="results">
            <div class="grid" id="grid"></div>
            <div class="pager" id="pager"></div>
          </div>
        </div>
      </div>
    </section>`;
  }

  const storyGridHTML = () => `
    <div class="story__grid">
      <div class="story__item">
        <span class="story__num">01</span>
        <h3>Прямые закупки</h3>
        <p>Покупаем зелёное зерно у ферм и кооперативов, с которыми работаем из сезона в сезон, — и знаем, откуда каждый лот.</p>
      </div>
      <div class="story__item">
        <span class="story__num">02</span>
        <h3>Обжарка под заказ</h3>
        <p>Жарим по вторникам ровно столько, сколько заказали за неделю. Ничего не лежит на складе месяцами.</p>
      </div>
      <div class="story__item">
        <span class="story__num">03</span>
        <h3>Свежесть на пачке</h3>
        <p>На каждой пачке — дата обжарки. Вкус лучше всего раскрывается в первые недели после неё.</p>
      </div>
    </div>`;

  const pageHeadHTML = (eyebrow, title, lead) => `
    <section class="page-head container">
      <p class="eyebrow">${eyebrow}</p>
      <h1 class="page-head__title">${title}</h1>
      ${lead ? `<p class="page-head__lead">${lead}</p>` : ''}
    </section>`;

  // плитки-переходы на другие страницы (главная, наборы, обжарочная)
  const tilesHTML = (which = ['about', 'subscription']) => {
    const TILES = {
      about: `
        <a class="tile" href="#/about">
          <span class="eyebrow">Обжарочная</span>
          <b>Маленькие партии, понятный путь зерна</b>
          <span class="tile__more">Как мы работаем →</span>
        </a>`,
      subscription: `
        <a class="tile tile--accent" href="#/subscription">
          <span class="eyebrow">Подписка</span>
          <b>Свежий кофе каждые 2 недели — экономия 15%</b>
          <span class="tile__more">Как устроена подписка →</span>
        </a>`,
      sets: `
        <a class="tile" href="#/sets">
          <span class="eyebrow">Наборы</span>
          <b>Несколько сортов сразу — выгода до ${Math.max(0, ...BUNDLES.map((b) => Math.round(b.discount * 100)))}%</b>
          <span class="tile__more">Все наборы →</span>
        </a>`,
      catalog: `
        <a class="tile" href="#/catalog">
          <span class="eyebrow">Каталог</span>
          <b>${PRODUCTS.length} ${plural(PRODUCTS.length, 'сорт', 'сорта', 'сортов')} свежей обжарки</b>
          <span class="tile__more">Выбрать кофе →</span>
        </a>`,
    };
    return `<section class="section section--tight"><div class="container tiles">${which.map((k) => TILES[k]).join('')}</div></section>`;
  };

  function homeHTML() {
    const hits = [...PRODUCTS].sort(SORTERS.popular).slice(0, 4);
    return heroHTML() + `
      <section class="section section--tight" aria-labelledby="hits-title">
        <div class="container">
          <div class="section__head section__head--split">
            <h2 class="h2" id="hits-title">Хиты продаж</h2>
            <a class="link-more" href="#/catalog">Весь каталог · ${PRODUCTS.length} →</a>
          </div>
          <div class="grid">${hits.map((p, i) => cardHTML(p, { index: i })).join('')}</div>
        </div>
      </section>
      ${BUNDLES.length ? `
      <section class="section section--tight" aria-labelledby="home-sets-title">
        <div class="container">
          <div class="section__head section__head--split">
            <h2 class="h2" id="home-sets-title">Наборы</h2>
            <a class="link-more" href="#/sets">Все наборы · ${BUNDLES.length} →</a>
          </div>
          <div class="sets__grid">${BUNDLES.slice(0, 3).map(bundleCardHTML).join('')}</div>
        </div>
      </section>` : ''}
      ${tilesHTML(['about', 'subscription'])}`;
  }

  function aboutHTML() {
    return `
      ${pageHeadHTML('Обжарочная', 'Маленькие партии,<br>понятный путь зерна', 'KORA — обжарочная specialty-кофе в Москве. Обжариваем каждый вторник и отправляем в день обжарки.')}
      <section class="story story--page" aria-label="Наши принципы">
        <div class="container">${storyGridHTML()}</div>
      </section>
      <section class="section" aria-labelledby="week-title">
        <div class="container split">
          <div>
            <p class="eyebrow">Путь одной пачки</p>
            <h2 class="h2" id="week-title" style="margin-top:16px">От заказа до чашки</h2>
          </div>
          <ol class="timeline">
            <li><span class="mono">До понедельника</span><b>Собираем заказы</b><p>Все заказы недели попадают в план обжарки.</p></li>
            <li><span class="mono">Вторник</span><b>Обжариваем</b><p>Жарим ровно под заказы — маленькими партиями.</p></li>
            <li><span class="mono">Вторник</span><b>Отправляем</b><p>Пачки уходят в доставку в день обжарки, с датой на этикетке.</p></li>
            <li><span class="mono">Дальше</span><b>Зерно отдыхает в пути</b><p>К моменту доставки кофе как раз готов раскрыться в чашке.</p></li>
          </ol>
        </div>
      </section>
      <section class="section section--tight" aria-labelledby="contacts-title">
        <div class="container">
          <div class="contacts">
            <h2 class="h2" id="contacts-title">Где нас найти</h2>
            <dl>
              <div><dt class="eyebrow">Адрес</dt><dd class="placeholder">[АДРЕС ОБЖАРОЧНОЙ]</dd></div>
              <div><dt class="eyebrow">Почта</dt><dd class="placeholder">[EMAIL]</dd></div>
              <div><dt class="eyebrow">Обжарка</dt><dd>каждый вторник</dd></div>
            </dl>
          </div>
        </div>
      </section>
      ${tilesHTML(['catalog', 'subscription'])}`;
  }

  function subscriptionHTML() {
    const from = (method) => {
      const list = PRODUCTS.filter((p) => !method || p.method === method);
      if (!list.length) return null;
      return Math.min(...list.map((p) => KORA.round10(p.price * 0.85)));
    };
    const plans = [
      { title: 'Эспрессо', text: 'Плотные сорта и смеси для кофемашины, турки и молочных напитков.', price: from('espresso') },
      { title: 'Фильтр', text: 'Яркие лоты для пуровера, аэропресса и капельной кофеварки.', price: from('filter') },
      { title: 'На выбор обжарщика', text: 'Каждый раз новый сорт — лучшее, что мы обжарили на этой неделе.', price: from('') },
    ].filter((p) => p.price);
    return `
      ${pageHeadHTML('Подписка', 'Свежий кофе<br>каждые 2 недели', 'Экономия 15% на каждой пачке. Обжариваем во вторник и сразу отправляем — кофе приезжает на пике вкуса.')}
      <section class="section section--tight" aria-labelledby="how-title">
        <div class="container">
          <h2 class="visually-hidden" id="how-title">Как это работает</h2>
          <div class="story__grid">
            <div class="story__item"><span class="story__num">01</span><h3>Выберите кофе</h3><p>Конкретный сорт, направление — эспрессо или фильтр — или доверьтесь обжарщику.</p></div>
            <div class="story__item"><span class="story__num">02</span><h3>Настройте пачку</h3><p>Вес от 250 г до 1 кг, в зёрнах или с помолом под ваш способ заваривания.</p></div>
            <div class="story__item"><span class="story__num">03</span><h3>Получайте свежим</h3><p>Каждые две недели — сразу после обжарки, со скидкой 15%.</p></div>
          </div>
        </div>
      </section>
      <section class="section" aria-labelledby="plans-title">
        <div class="container">
          <div class="section__head"><h2 class="h2" id="plans-title">Планы</h2></div>
          <div class="plans">
            ${plans.map((p, i) => `
              <article class="plan${i === 2 ? ' plan--accent' : ''}">
                <h3>${p.title}</h3>
                <p>${p.text}</p>
                <div class="plan__price"><span class="eyebrow">от</span><b>${fmt(p.price)}</b><span class="eyebrow">за 250 г</span></div>
                <button type="button" class="btn ${i === 2 ? 'btn--light' : 'btn--accent'} btn--block" data-action="soon" data-soon="Подписка">Оформить</button>
              </article>`).join('')}
          </div>
        </div>
      </section>
      <section class="section section--tight" aria-labelledby="faq-title">
        <div class="container split">
          <h2 class="h2" id="faq-title">Вопросы</h2>
          <div class="accordion" style="margin-top:0">
            <details open><summary>Можно поставить на паузу?</summary><div class="accordion__body"><p>Да, паузу и отмену можно оформить в любой момент до дня обжарки.</p></div></details>
            <details><summary>Можно поменять сорт?</summary><div class="accordion__body"><p>Да, сорт, вес и помол меняются перед каждой следующей поставкой.</p></div></details>
            <details><summary>Как работает доставка?</summary><div class="accordion__body"><p>Отправляем в день обжарки, бесплатно от ${fmt(FREE_SHIPPING)}. <span class="placeholder">[УСЛОВИЯ ДОСТАВКИ]</span></p></div></details>
          </div>
        </div>
      </section>
      ${tilesHTML(['catalog', 'sets'])}`;
  }

  /* ---------- Квиз «Как выбрать кофе» ---------- */
  const QUIZ = [
    { q: 'Как вы пьёте кофе?', key: 'drink', a: [['black', 'Чёрный'], ['milk', 'С молоком или сливками'], ['both', 'Оба варианта']] },
    { q: 'Как готовите дома?', key: 'brew', a: [['espresso', 'Кофемашина, турка или гейзер'], ['filter', 'Пуровер, капельная или френч-пресс'], ['cup', 'По-разному / пока не знаю']] },
    { q: 'Какие вкусы ближе?', key: 'taste', a: [['choco', 'Шоколад, орехи, карамель'], ['fruit', 'Ягоды и фрукты'], ['flower', 'Цветы и цитрусы']] },
  ];
  let quiz = { step: 0, answers: {} };

  function quizScore(p, a) {
    let s = 0;
    if (a.drink === 'milk') { if (p.features.includes('milk')) s += 3; if (p.density === 'high') s += 1; }
    if (a.drink === 'black') { if (p.acidity !== 'low') s += 1; if (p.features.includes('mono')) s += 1; }
    if (a.drink === 'both' && p.density === 'mid') s += 1;
    if (a.brew === 'espresso' && p.method === 'espresso') s += 3;
    if (a.brew === 'filter' && p.method === 'filter') s += 3;
    if (a.brew === 'cup' && p.method !== 'espresso') s += 1;
    if (a.taste === p.taste) s += 3;
    if (a.taste === 'fruit' && p.taste === 'funky') s += 1;
    return s + p.rating / 10;
  }

  function quizHTML() {
    const done = quiz.step >= QUIZ.length;
    let right;
    if (!done) {
      const q = QUIZ[quiz.step];
      right = `
        <p class="eyebrow">Вопрос ${quiz.step + 1} из ${QUIZ.length}</p>
        <p class="quiz__q" id="quiz-q">${q.q}</p>
        <div class="quiz__answers" role="group" aria-labelledby="quiz-q">
          ${q.a.map(([v, l]) => `<button type="button" class="quiz__answer" data-action="quiz" data-v="${v}">${l}<span aria-hidden="true">→</span></button>`).join('')}
        </div>
        ${quiz.step > 0 ? '<button type="button" class="quiz__back" data-action="quiz-back">← Предыдущий вопрос</button>' : ''}`;
    } else {
      const top = [...PRODUCTS].sort((a, b) => quizScore(b, quiz.answers) - quizScore(a, quiz.answers)).slice(0, 3);
      right = `
        <p class="eyebrow">Вам подойдут</p>
        <div class="quiz__results">
          ${top.map((p) => `
            <a class="quiz__result" href="#/product/${p.handle}">
              ${packHTML(p, { size: 'sm' })}
              <span><b>${esc(p.title)}</b><small>${esc(p.notes.map((n) => n[0]).join(', '))}</small></span>
              <span class="price__now">${fmt(priceOf(p, 250).now)}</span>
            </a>`).join('')}
        </div>
        <div class="quiz__actions">
          <button type="button" class="btn btn--accent" data-action="quiz-apply">Показать похожие в каталоге</button>
          <button type="button" class="btn btn--ghost" data-action="quiz-reset">Пройти заново</button>
        </div>`;
    }
    return `
      <section class="quiz" id="quiz" aria-labelledby="quiz-title">
        <div>
          <p class="eyebrow">Подбор за минуту</p>
          <h3 class="quiz__title" id="quiz-title">Как выбрать <em>кофе?</em></h3>
          <p class="quiz__lead">Ответьте на 3 вопроса — подберём сорта под ваш способ заваривания и вкус.</p>
          <div class="quiz__progress" aria-hidden="true">${QUIZ.map((_, i) => `<i class="${i < quiz.step ? 'is-done' : ''}"></i>`).join('')}</div>
        </div>
        <div>${right}</div>
      </section>`;
  }

  function rerenderQuiz() {
    const el = $('#quiz');
    if (!el) return;
    el.outerHTML = quizHTML();
    const target = $('#quiz .quiz__answer') || $('#quiz .quiz__result');
    if (target) target.focus({ preventScroll: true });
  }

  function applyQuiz() {
    const a = quiz.answers;
    const base = { ...DEFAULTS, sort: state.f.sort };
    const variants = [
      { method: a.brew === 'cup' ? '' : a.brew, taste: [a.taste], feature: a.drink === 'milk' ? ['milk'] : [] },
      { method: a.brew === 'cup' ? '' : a.brew, taste: [a.taste] },
      { method: a.brew === 'cup' ? '' : a.brew },
    ];
    const patch = variants.find((v) => getList({ ...base, ...v }).length) || {};
    setFilters({ ...base, ...patch });
    scrollToId('results');
  }

  /* ---------- рендер каталога ---------- */

  function updateCatalog() {
    const f = state.f;
    lastCatalogHash = filtersHash(f);
    const list = getList(f);
    const n = list.length;

    // счётчики
    $('#cat-count').textContent = `${n} ${plural(n, 'позиция', 'позиции', 'позиций')}${n !== PRODUCTS.length ? ` из ${PRODUCTS.length}` : ''}`;
    const adv = MULTI.reduce((s, k) => s + f[k].length, 0);
    $('#filters-count').textContent = adv ? String(adv) : '';
    $('#filters-summary').textContent = `${n} ${plural(n, 'сорт', 'сорта', 'сортов')} из ${PRODUCTS.length}`;
    $('#filters-apply').textContent = n ? `Показать ${n} ${plural(n, 'сорт', 'сорта', 'сортов')}` : 'Ничего не найдено';

    // пилюли, быстрые подборки, сортировка, поиск
    $$('[data-action="pill"]').forEach((b) => b.setAttribute('aria-pressed', String(f[b.dataset.key] === b.dataset.value)));
    $$('[data-action="quick"]').forEach((b) => {
      const on = isQuickActive(QUICK.find((q) => q.id === b.dataset.v));
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('#sort').value = f.sort;
    const si = $('#search-input');
    if (document.activeElement !== si) si.value = f.q;

    renderTabs();

    // фасеты сайдбара: состояние и количество
    $$('input[data-facet]').forEach((inp) => {
      const k = inp.dataset.facet;
      inp.checked = f[k].includes(inp.value);
      const c = PRODUCTS.filter((p) => matches(p, f, k) && valuesOf(p, k).includes(inp.value)).length;
      const label = inp.closest('.check');
      label.querySelector('.check__count').textContent = c;
      label.classList.toggle('is-empty', c === 0 && !inp.checked);
    });

    // активные фильтры
    const chips = [];
    if (f.method) chips.push(['method', f.method, LABELS.method[f.method]]);
    if (f.roast) chips.push(['roast', f.roast, `${LABELS.roast[f.roast]} обжарка`]);
    MULTI.forEach((k) => f[k].forEach((v) => chips.push([k, v, optionLabel(k, v)])));
    if (f.q) chips.push(['q', f.q, `«${f.q}»`]);
    const chipsEl = $('#chips');
    chipsEl.hidden = !chips.length;
    preserveFocus(chipsEl, () => {
      chipsEl.innerHTML = chips.map(([k, v, l]) =>
        `<button type="button" class="chip" data-action="chip" data-key="${k}" data-value="${esc(v)}" aria-label="Убрать фильтр: ${esc(l)}">${esc(l)}${ICON.x}</button>`).join('')
        + (chips.length > 1 ? '<button type="button" class="chip chip--clear" data-action="reset">Сбросить все</button>' : '');
    }, () => $('#sort'));

    renderGrid(list);
  }

  // вкладки-подборки с количеством
  function renderTabs() {
    const f = state.f;
    const tabs = $('#tabs');
    preserveFocus(tabs, () => {
      tabs.innerHTML = Object.entries(LABELS.tab).map(([k, label]) => {
        const c = PRODUCTS.filter((p) => matches(p, f, 'tab') && (k === 'all' || (k === 'fav' ? favs.has(p.handle) : p.tags.includes(k)))).length;
        return `<button type="button" class="pill" data-action="tab" data-v="${k}" aria-pressed="${f.tab === k}">${k === 'fav' ? '♥ ' : ''}${label}<span class="pill__count">${c}</span></button>`;
      }).join('');
    });
  }

  function renderGrid(list) {
    const f = state.f;
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    const p = Math.min(f.p, pages);
    const from = Math.min(f.from, p);
    const visible = list.slice((from - 1) * PAGE_SIZE, p * PAGE_SIZE);
    const grid = $('#grid');

    if (!list.length) {
      grid.innerHTML = `
        <div class="empty">
          <p>Под эти фильтры пока ничего нет</p>
          <button type="button" class="btn btn--light" data-action="reset">Сбросить фильтры</button>
        </div>`;
    } else {
      const items = visible.map((prod, i) => cardHTML(prod, { index: i }));
      if (from === 1 && !f.q) items.splice(Math.min(3, items.length), 0, quizHTML());
      grid.innerHTML = items.join('');
    }

    const pager = $('#pager');
    if (!list.length) { pager.innerHTML = ''; return; }
    const rest = list.length - p * PAGE_SIZE;
    pager.innerHTML = `
      ${rest > 0 ? `<button type="button" class="btn btn--ghost" data-action="more">Загрузить ещё ${Math.min(PAGE_SIZE, rest)}</button>` : ''}
      ${pages > 1 ? `
        <nav aria-label="Страницы каталога"><div class="pager__pages">
          ${Array.from({ length: pages }, (_, i) => i + 1).map((nmb) => {
            const inRange = nmb >= from && nmb <= p;
            return `<button type="button" data-action="page" data-v="${nmb}" class="${inRange ? 'in-range' : ''}"${nmb === p ? ' aria-current="page"' : ''} aria-label="Страница ${nmb}">${nmb}</button>`;
          }).join('')}
        </div></nav>` : ''}
      <span class="pager__info">Показано ${visible.length} из ${list.length}</span>`;
  }

  /* ======================================================================
     Страница товара
     ====================================================================== */
  let pdp = null;

  function brewGuide(p) {
    if (p.method === 'espresso') {
      return `<ol>
        <li>18 г молотого кофе на порцию, помол — для эспрессо.</li>
        <li>На выходе 36–40 г напитка за 26–30 секунд.</li>
        <li>Вода 92–94 °C. Для молочных напитков можно взять 20 г кофе.</li>
      </ol>`;
    }
    return `<ol>
      <li>15 г кофе на 250 мл воды, помол — средний, как морская соль.</li>
      <li>Вода 92–94 °C. Пролейте 40 мл и дайте кофе «раскрыться» 30 секунд.</li>
      <li>Долейте остальное в 2–3 приёма, общее время — 2:30–3:30.</li>
    </ol>`;
  }

  function describe(p) {
    const origin = p.country === 'Смесь' ? `Смесь зерна: ${p.region}.` : `Кофе из региона ${p.region}, ${p.country}.`;
    const use = {
      espresso: 'Раскрывается в эспрессо и молочных напитках.',
      filter: 'Лучше всего — в пуровере, аэропрессе или капельной кофеварке.',
      decaf: 'Без кофеина, но с полноценным вкусом — можно пить вечером.',
    }[p.method];
    const roast = { light: 'светлой', medium: 'средней', dark: 'тёмной' }[p.roast];
    return `${p.lead} кофе ${roast} обжарки. ${origin} В чашке — ${p.notes.map((n) => n[0]).join(', ')}. ${use}`;
  }

  function pickRelated(p) {
    const others = PRODUCTS.filter((x) => x.handle !== p.handle);
    const same = others.filter((x) => x.method === p.method).sort(SORTERS.rating);
    const rest = others.filter((x) => x.method !== p.method).sort(SORTERS.popular);
    return [...same, ...rest].slice(0, 3);
  }

  function setJsonLd(p) {
    let el = $('#ld-product');
    if (!p) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.id = 'ld-product';
      document.head.append(el);
    }
    el.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.title,
      description: describe(p),
      sku: p.id,
      brand: { '@type': 'Brand', name: 'KORA' },
      // reviewCount: 0 Google считает ошибкой разметки — без отзывов рейтинг не указываем
      ...(p.reviews ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.reviews } } : {}),
      offers: {
        '@type': 'AggregateOffer', priceCurrency: 'RUB',
        lowPrice: priceOf(p, 250).now, highPrice: priceOf(p, 1000).now,
        availability: 'https://schema.org/InStock',
      },
    });
  }

  function renderProduct(handle) {
    const p = byHandle.get(handle);
    state.view = 'product';
    closeFilters(false);
    if (!p) {
      main.innerHTML = `
        <div class="container notfound">
          <p class="eyebrow">404</p>
          <h1 class="h2">Такого сорта нет</h1>
          <a class="btn btn--accent" href="${lastCatalogHash}">← В каталог</a>
        </div>`;
      document.title = 'Не найдено — KORA';
      setJsonLd(null);
      return;
    }
    const sel = getSel(p);
    pdp = { p, weight: sel.weight, grind: sel.grind, qty: 1 };
    const eyebrow = p.country === 'Смесь'
      ? `Смесь · ${p.region} · ${LABELS.methodShort[p.method]}`
      : `${p.country} · регион ${p.region} · ${LABELS.methodShort[p.method]}`;

    main.innerHTML = `
      <div class="pdp container">
        <a class="back" href="${lastCatalogHash}" data-action="back">← Назад в каталог</a>
        <div class="pdp__grid">
          <div class="pdp__gallery">
            <div class="pdp__stage">
              <div class="pdp__badges">${badgesHTML(p)}</div>
              ${favBtn(p)}
              ${packHTML(p, { size: 'lg', weight: pdp.weight, date: true, cls: 'pdp__pack' })}
            </div>
          </div>

          <div class="pdp__info">
            <p class="eyebrow">${esc(eyebrow)}</p>
            <h1 class="pdp__title" tabindex="-1">${esc(p.title)}</h1>
            <div class="pdp__rating" id="pdp-rating">${pdpRatingHTML(p)}</div>
            <p class="pdp__desc">${esc(describe(p))}</p>

            <dl class="specs">
              <div><dt class="eyebrow">Ноты</dt><dd>${esc(p.notes.map((n) => n[0]).join(', '))}</dd></div>
              <div><dt class="eyebrow">Обработка</dt><dd>${LABELS.process[p.process]}</dd></div>
              <div><dt class="eyebrow">Высота</dt><dd class="placeholder">${esc(p.altitude)}</dd></div>
            </dl>
            ${scalesHTML(p)}

            <div class="picker">
              <div class="picker__head"><span class="eyebrow" id="w-label">Вес</span></div>
              <div class="picker__opts" role="group" aria-labelledby="w-label">
                ${WEIGHTS.map((w) => {
                  const d = w > 250 ? bulkDiscount(p, w) : 0;
                  return `<button type="button" class="opt opt--stack" data-action="pdp-weight" data-v="${w}" aria-pressed="false">${weightLabel(w)}<small>${fmt(priceOf(p, w).now)}${d ? ` · −${d}%` : ''}</small></button>`;
                }).join('')}
              </div>
            </div>
            <div class="picker">
              <div class="picker__head"><span class="eyebrow" id="g-label">Помол</span></div>
              <div class="picker__opts" role="group" aria-labelledby="g-label">
                ${GRINDS.map((g) => `<button type="button" class="opt" data-action="pdp-grind" data-v="${g}" aria-pressed="false">${LABELS.grind[g]}</button>`).join('')}
              </div>
            </div>

            <div class="pdp__price" id="pdp-price"></div>
            <div class="buy">
              <div class="stepper stepper--lg" role="group" aria-label="Количество">
                <button type="button" data-action="pdp-dec" aria-label="Уменьшить количество">−</button>
                <output id="pdp-qty" aria-live="polite">1</output>
                <button type="button" data-action="pdp-inc" aria-label="Увеличить количество">+</button>
              </div>
              <button type="button" class="btn btn--accent btn--lg" data-action="pdp-add" id="pdp-add"></button>
            </div>
            <p class="pdp__sub">Подписка каждые 2 недели — экономия 15%</p>

            <div class="accordion">
              <details open>
                <summary>Как заваривать</summary>
                <div class="accordion__body">${brewGuide(p)}</div>
              </details>
              <details>
                <summary>О ферме</summary>
                <div class="accordion__body"><p>Регион ${esc(p.region)}. <span class="placeholder">[ИСТОРИЯ ФЕРМЫ И ФЕРМЕРА]</span></p></div>
              </details>
              <details>
                <summary>Доставка и возврат</summary>
                <div class="accordion__body"><p>Отправляем в день обжарки, доставка бесплатно от ${fmt(FREE_SHIPPING)}. <span class="placeholder">[УСЛОВИЯ ДОСТАВКИ]</span></p></div>
              </details>
            </div>
          </div>
        </div>

        <section class="reviews" id="reviews" aria-labelledby="rev-title">
          <div class="section__head"><h2 class="h2" id="rev-title">Отзывы</h2></div>
          <div id="reviews-body"><p class="muted">Загрузка отзывов…</p></div>
        </section>

        <section class="related" aria-labelledby="rel-title">
          <div class="section__head"><h2 class="h2" id="rel-title">Похожие сорта</h2></div>
          <div class="grid grid--related">${pickRelated(p).map((r, i) => cardHTML(r, { mini: true, index: i })).join('')}</div>
        </section>
      </div>`;

    updatePdp();
    setJsonLd(p);
    document.title = `${p.title} — кофе в зёрнах | KORA`;
    window.scrollTo(0, 0);
    $('.pdp__title').focus({ preventScroll: true });
    loadReviews(p.handle);
  }

  /* ---------- отзывы ---------- */
  const pdpRatingHTML = (p) => `
    ${p.reviews
      ? `${ICON.star}<span>${p.rating}</span><a href="#/product/${p.handle}" data-scroll="reviews">· ${nf.format(p.reviews)} ${reviewsWord(p.reviews)}</a>`
      : `<a href="#/product/${p.handle}" data-scroll="reviews">Пока нет отзывов</a>`}
    <span>· ${LABELS.roast[p.roast].toLowerCase()} обжарка</span>`;

  const starsHTML = (n) => `<span class="stars" role="img" aria-label="Оценка ${n} из 5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;

  let reviewsHandle = null;
  async function loadReviews(handle) {
    reviewsHandle = handle;
    const body = $('#reviews-body');
    if (!body) return;
    if (!API.online) { body.innerHTML = '<p class="muted">Отзывы доступны, когда сайт подключён к магазину.</p>'; return; }
    try {
      const { reviews } = await API.request('GET', `/api/products/${handle}/reviews`);
      // пока грузили, могли уйти на другой сорт
      if (reviewsHandle !== handle || !$('#reviews-body')) return;
      $('#reviews-body').innerHTML = reviewsHTML(reviews);
    } catch (e) {
      // сервер запущен до появления отзывов — объясняем, что делать, вместо «Метод API не найден»
      if (e.status === 404 && $('#reviews-body')) {
        $('#reviews-body').innerHTML = '<p class="muted">Отзывы пока недоступны: сервер нужно перезапустить (Ctrl+C, затем <code>npm start</code>).</p>';
      } else handleApiError(e, $('#reviews-body'));
    }
  }

  function reviewsHTML(list) {
    const mine = list.find((r) => r.mine);
    const admin = API.user && API.user.role === 'admin';
    const form = API.user ? `
      <form class="form review-form" data-form="review" novalidate>
        <h3 class="form__title">${mine ? 'Ваш отзыв' : 'Оставить отзыв'}</h3>
        <fieldset class="field">
          <legend>Оценка</legend>
          <div class="rate">
            ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="rate-${n}" name="rating" value="${n}"${mine && mine.rating === n ? ' checked' : ''}><label for="rate-${n}" title="${n} из 5">★</label>`).join('')}
          </div>
        </fieldset>
        <div class="field">
          <label for="review-text">Впечатления (необязательно)</label>
          <textarea id="review-text" name="text" rows="4" maxlength="2000" placeholder="Как заваривали, какие ноты услышали">${mine ? esc(mine.text) : ''}</textarea>
        </div>
        <p class="form__error" role="alert"></p>
        <button class="btn btn--accent" type="submit">${mine ? 'Обновить отзыв' : 'Отправить отзыв'}</button>
      </form>` : `
      <p class="muted"><a href="#/account">Войдите</a>, чтобы оставить отзыв.</p>`;
    const items = list.length ? `
      <ul class="review-list">
        ${list.map((r) => `
          <li class="review">
            <div class="review__head">
              <b>${esc(r.name)}</b>${starsHTML(r.rating)}<span class="eyebrow">${fmtDate(r.createdAt)}</span>
              ${r.mine || admin ? `<button type="button" class="pill pill--sm review__del" data-action="review-delete" data-id="${r.id}">Удалить</button>` : ''}
            </div>
            ${r.text ? `<p>${esc(r.text)}</p>` : ''}
          </li>`).join('')}
      </ul>` : '<p class="muted">На сайте ещё никто не оставил отзыв об этом сорте — будьте первым.</p>';
    return `<div class="reviews__grid">${form}${items}</div>`;
  }

  // после отзыва меняется рейтинг сорта — подтягиваем каталог и перерисовываем шапку и список
  async function afterReviewChange() {
    await API.reloadCatalog();
    rebuildIndex();
    const p = reviewsHandle && byHandle.get(reviewsHandle);
    if (p && pdp && pdp.p.handle === p.handle) {
      pdp.p = p;
      const el = $('#pdp-rating');
      if (el) el.innerHTML = pdpRatingHTML(p);
    }
    if (reviewsHandle) await loadReviews(reviewsHandle);
  }

  async function deleteReview(id) {
    if (!confirm('Удалить отзыв?')) return;
    try {
      await API.request('DELETE', `/api/reviews/${id}`);
      await afterReviewChange();
      toast('Отзыв удалён');
    } catch (e) {
      handleApiError(e);
    }
  }

  function updatePdp() {
    const { p, weight, grind, qty } = pdp;
    $$('[data-action="pdp-weight"]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === weight)));
    $$('[data-action="pdp-grind"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === grind)));
    $('#pdp-qty').textContent = qty;
    const pr = priceOf(p, weight);
    $('#pdp-price').innerHTML = `${priceHTML(pr)}<span class="eyebrow">за ${weightLabel(weight)}</span>`;
    const add = $('#pdp-add');
    if (!add.classList.contains('is-done')) add.textContent = `В корзину · ${fmt(pr.now * qty)}`;
    $('.pdp__pack .pack__weight').textContent = weightLabel(weight);
    setSel(p, { weight, grind });
  }

  /* ======================================================================
     Наборы
     ====================================================================== */
  const bundleGrind = new Map();
  const setButtonLabel = (b) => `В корзину · ${b.items.length} × 250 г`;

  function bundleCardHTML(b) {
    const items = b.items.map((h) => byHandle.get(h));
    const pr = bundlePrice(b, byHandle);
    const grind = bundleGrind.get(b.handle) || 'beans';
    const mid = (items.length - 1) / 2;
    return `
      <article class="set">
        <div class="set__stage" aria-hidden="true">
          ${items.map((p, i) => packHTML(p, { cls: 'set__pack', style: `--i:${i - mid};z-index:${10 - Math.abs(Math.round((i - mid) * 2))}` })).join('')}
        </div>
        <div class="set__body">
          <div class="set__tags"><span class="tag tag--accent">${esc(b.tag)}</span><span class="tag">−${Math.round(b.discount * 100)}%</span></div>
          <h3 class="set__title">${esc(b.title)}</h3>
          <p class="set__desc">${esc(b.desc)}</p>
          <ul class="set__items">
            ${items.map((p) => `<li><a href="#/product/${p.handle}">${esc(p.title)}</a><span>${esc(p.notes.map((n) => n[0]).join(', '))}</span></li>`).join('')}
          </ul>
          <div class="set__foot">
            <label class="visually-hidden" for="set-grind-${b.handle}">Помол для набора «${esc(b.title)}»</label>
            <select class="select" id="set-grind-${b.handle}" data-role="set-grind" data-set="${b.handle}">
              ${GRINDS.map((g) => `<option value="${g}"${g === grind ? ' selected' : ''}>${g === 'beans' ? 'В зёрнах' : 'Молотый: ' + LABELS.grind[g].toLowerCase()}</option>`).join('')}
            </select>
            ${priceHTML(pr)}
          </div>
          <button type="button" class="btn btn--accent btn--block" data-action="add-set" data-set="${b.handle}">${setButtonLabel(b)}</button>
        </div>
      </article>`;
  }

  function setsHTML() {
    if (!BUNDLES.length) return '';
    const max = Math.max(...BUNDLES.map((b) => Math.round(b.discount * 100)));
    return `
      <section class="section sets page" id="sets" aria-labelledby="sets-title">
        <div class="container">
          <p class="eyebrow page__eyebrow">Несколько сортов сразу</p>
          <div class="section__head">
            <h1 class="h2 page__title" id="sets-title">Наборы</h1>
            <span class="count">${BUNDLES.length} ${plural(BUNDLES.length, 'набор', 'набора', 'наборов')} · выгода до ${max}%</span>
          </div>
          <p class="sets__lead">Несколько сортов по 250 г, чтобы сравнить и найти свой. В пачках — тот же свежий кофе, что и в каталоге, только дешевле.</p>
          <div class="sets__grid">${BUNDLES.map(bundleCardHTML).join('')}</div>
        </div>
      </section>
      ${tilesHTML(['catalog', 'subscription'])}`;
  }

  /* ======================================================================
     Избранное: локально у гостя, на сервере у пользователя
     ====================================================================== */
  function syncFavUI(p) {
    $$(`[data-action="fav"][data-handle="${p.handle}"]`).forEach((b) => b.setAttribute('aria-pressed', String(favs.has(p.handle))));
    if (state.view === 'catalog') {
      if (state.f.tab === 'fav') updateCatalog();
      else renderTabs();
    }
  }

  function toggleFav(p) {
    const on = !favs.has(p.handle);
    on ? favs.add(p.handle) : favs.delete(p.handle);
    syncFavUI(p);
    toast(on ? `«${p.title}» в избранном` : `«${p.title}» убран из избранного`);
    if (API.online && API.user) {
      API.request(on ? 'PUT' : 'DELETE', `/api/favorites/${p.handle}`).catch(() => {
        on ? favs.delete(p.handle) : favs.add(p.handle);
        syncFavUI(p);
        toast('Не удалось обновить избранное', 'error');
      });
    } else {
      store.set('kora-favs', [...favs]);
    }
  }

  /* ======================================================================
     Аккаунт, оформление заказа, админка (нужен бэкенд)
     ====================================================================== */
  const STATUS = { new: 'Новый', roasting: 'В обжарке', shipped: 'Отправлен', done: 'Доставлен', cancelled: 'Отменён' };
  const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDate = (s) => dateFmt.format(new Date(String(s).replace(' ', 'T') + 'Z'));
  const NOTE_COLORS = ['#C9A227', '#B03A2E', '#7B3F00', '#E59866', '#5B2C6F', '#7DAA3B'];

  let authMode = 'login';
  let authNext = '';
  let adminProducts = [];
  let adminEditing = null; // null | 'new' | handle
  let adminBundles = [];
  let adminBundleEditing = null; // null | 'new' | handle
  let fieldSeq = 0;

  function updateAccountBtn() {
    const btn = $('#account-btn');
    const u = API.user;
    btn.classList.toggle('is-auth', !!u);
    btn.setAttribute('aria-label', u ? `Личный кабинет: ${u.name}` : 'Войти в аккаунт');
    $('#account-initial').textContent = u ? u.name.trim().charAt(0).toUpperCase() : '';
  }

  function field(name, label, { type = 'text', value = '', autocomplete = '', attrs = '' } = {}) {
    const id = `f-${name}-${++fieldSeq}`;
    return `
      <div class="field">
        <label for="${id}">${label}</label>
        <input id="${id}" name="${name}" type="${type}" value="${esc(value)}"${autocomplete ? ` autocomplete="${autocomplete}"` : ''} ${attrs}>
      </div>`;
  }

  // без сети (PWA открыта из кеша) — честно говорим про интернет, а не про npm start
  const offlineHTML = (what) => (!navigator.onLine ? `
    <section class="container notice">
      <p class="eyebrow">Нет сети</p>
      <h1 class="h2">${what}: нужно подключение к интернету</h1>
      <p>Без сети можно смотреть каталог. Когда соединение вернётся, страница обновится сама.</p>
      <a class="btn btn--accent" href="${lastCatalogHash}">← В каталог</a>
    </section>` : `
    <section class="container notice">
      <p class="eyebrow">Нужен бэкенд</p>
      <h1 class="h2">${what} работает с сервером</h1>
      <p>Сейчас сайт открыт без API: каталог показан из сохранённой копии, корзина живёт в браузере. Запустите сервер командой <code>npm start</code> и откройте <a href="http://localhost:3000/">localhost:3000</a>.</p>
      <a class="btn btn--accent" href="${lastCatalogHash}">← В каталог</a>
    </section>`);

  const emptyPanel = (title, text) => `
    <div class="empty">
      <p>${title}</p>
      ${text ? `<span class="empty__text">${text}</span>` : ''}
      <a class="btn btn--light" href="${lastCatalogHash}">В каталог</a>
    </div>`;

  function enterView(name, title) {
    state.view = name;
    closeFilters(false);
    setJsonLd(null);
    document.title = title;
    window.scrollTo(0, 0);
  }

  function authHTML() {
    const reg = authMode === 'register';
    return `
      <section class="auth container">
        <div class="auth__card">
          <p class="eyebrow">Аккаунт KORA</p>
          <h1 class="h2">${reg ? 'Регистрация' : 'Вход'}</h1>
          <div class="auth__switch" role="group" aria-label="Вход или регистрация">
            <button type="button" class="pill" data-action="auth-mode" data-v="login" aria-pressed="${!reg}">Вход</button>
            <button type="button" class="pill" data-action="auth-mode" data-v="register" aria-pressed="${reg}">Регистрация</button>
          </div>
          ${authNext === 'checkout' ? '<p class="auth__note">Войдите, чтобы оформить заказ, — корзина сохранится.</p>' : ''}
          <form class="form" data-form="${reg ? 'register' : 'login'}" novalidate>
            ${reg ? field('name', 'Имя', { autocomplete: 'name' }) : ''}
            ${field('email', 'Email', { type: 'email', autocomplete: 'email' })}
            ${field('password', 'Пароль', { type: 'password', autocomplete: reg ? 'new-password' : 'current-password' })}
            ${reg ? '<p class="field__hint">Минимум 8 символов</p>' : ''}
            <p class="form__error" role="alert"></p>
            <button class="btn btn--accent btn--block btn--lg" type="submit">${reg ? 'Создать аккаунт' : 'Войти'}</button>
          </form>
        </div>
        <aside class="auth__perks">
          <h2 class="eyebrow">Зачем аккаунт</h2>
          <ul>
            <li><b>История заказов</b><span>Статус обжарки и доставки каждого заказа</span></li>
            <li><b>Избранное везде</b><span>Сохранённые сорта на любом устройстве</span></li>
            <li><b>Корзина не потеряется</b><span>Гостевая корзина переедет в аккаунт при входе</span></li>
          </ul>
        </aside>
      </section>`;
  }

  const ACCOUNT_TABS = { orders: 'Заказы', favorites: 'Избранное', profile: 'Профиль' };
  const ADMIN_TABS = { 'admin-products': 'Сорта', 'admin-bundles': 'Наборы', 'admin-orders': 'Все заказы' };

  function renderAccount(tab, params) {
    enterView('account', 'Личный кабинет — KORA');
    if (!API.online) { main.innerHTML = offlineHTML('Личный кабинет'); return; }
    if (!API.user) {
      authNext = params.get('next') || '';
      main.innerHTML = authHTML();
      return;
    }
    const tabs = { ...ACCOUNT_TABS, ...(API.user.role === 'admin' ? ADMIN_TABS : {}) };
    if (!tabs[tab]) tab = 'orders';
    adminEditing = null;
    adminBundleEditing = null;
    main.innerHTML = `
      <section class="account container">
        <div class="account__head">
          <div>
            <p class="eyebrow">Личный кабинет${API.user.role === 'admin' ? ' · администратор' : ''}</p>
            <h1 class="h2">Привет, ${esc(API.user.name)}</h1>
          </div>
          <button type="button" class="btn btn--ghost" data-action="logout">Выйти</button>
        </div>
        <nav class="account__tabs" aria-label="Разделы кабинета">
          ${Object.entries(tabs).map(([k, l]) => `<a class="pill${k === tab ? ' is-active' : ''}" href="#/account/${k}"${k === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}
        </nav>
        <div class="account__panel" id="account-panel"><p class="muted">Загрузка…</p></div>
      </section>`;
    renderAccountPanel(tab);
  }

  const orderHTML = (o, admin = false) => `
    <article class="order">
      <div class="order__head">
        <div>
          <b>Заказ ${o.number}</b>
          <span class="eyebrow">${fmtDate(o.createdAt)}${admin ? ' · ' + esc(o.email) : ''}</span>
        </div>
        ${admin
          ? `<label class="visually-hidden" for="st-${o.id}">Статус заказа ${o.number}</label>
             <select class="select" id="st-${o.id}" data-role="order-status" data-id="${o.id}">
               ${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${k === o.status ? ' selected' : ''}>${l}</option>`).join('')}
             </select>`
          : `<span class="tag status status--${o.status}">${STATUS[o.status] || o.status}</span>`}
      </div>
      <ul class="order__items">
        ${o.items.map((i) => `<li><span>${esc(i.title)} <small>${esc(i.desc)} × ${i.qty}</small></span><span>${fmt(i.sum)}</span></li>`).join('')}
      </ul>
      <div class="order__foot">
        <span>${esc(o.contact.name)} · ${esc(o.contact.phone)} · ${esc(o.contact.address)}</span>
        <b>${fmt(o.total)}</b>
      </div>
    </article>`;

  function profileHTML() {
    const u = API.user;
    return `
      <div class="forms">
        <form class="form" data-form="profile" novalidate>
          <h2 class="form__title">Контакты и доставка</h2>
          ${field('name', 'Имя', { value: u.name, autocomplete: 'name' })}
          ${field('email-ro', 'Email', { type: 'email', value: u.email, attrs: 'disabled' })}
          ${field('phone', 'Телефон', { type: 'tel', value: u.phone, autocomplete: 'tel' })}
          ${field('address', 'Адрес доставки', { value: u.address, autocomplete: 'street-address' })}
          <p class="form__error" role="alert"></p>
          <button class="btn btn--accent" type="submit">Сохранить</button>
        </form>
        <form class="form" data-form="password" novalidate>
          <h2 class="form__title">Смена пароля</h2>
          ${field('current', 'Текущий пароль', { type: 'password', autocomplete: 'current-password' })}
          ${field('next', 'Новый пароль', { type: 'password', autocomplete: 'new-password' })}
          <p class="field__hint">Минимум 8 символов. Другие устройства будут разлогинены.</p>
          <p class="form__error" role="alert"></p>
          <button class="btn btn--ghost" type="submit">Сменить пароль</button>
        </form>
      </div>`;
  }

  async function renderAccountPanel(tab) {
    const panel = $('#account-panel');
    try {
      if (tab === 'orders') {
        const { orders } = await API.request('GET', '/api/orders');
        panel.innerHTML = orders.length
          ? `<div class="orders">${orders.map((o) => orderHTML(o)).join('')}</div>`
          : emptyPanel('Заказов пока нет', 'Выберите кофе в каталоге — история появится здесь.');
      } else if (tab === 'favorites') {
        const list = PRODUCTS.filter((p) => favs.has(p.handle));
        panel.innerHTML = list.length
          ? `<div class="grid">${list.map((p, i) => cardHTML(p, { index: i })).join('')}</div>`
          : emptyPanel('В избранном пусто', 'Нажмите ♥ на карточке сорта, чтобы сохранить его.');
      } else if (tab === 'profile') {
        panel.innerHTML = profileHTML();
      } else if (tab === 'admin-products') {
        adminProducts = (await API.request('GET', '/api/admin/products')).products;
        drawAdminProducts(panel);
      } else if (tab === 'admin-bundles') {
        // сорта нужны для выбора состава набора
        const [{ bundles }, { products }] = await Promise.all([
          API.request('GET', '/api/admin/bundles'),
          API.request('GET', '/api/admin/products'),
        ]);
        adminBundles = bundles;
        adminProducts = products;
        drawAdminBundles(panel);
      } else if (tab === 'admin-orders') {
        const { orders } = await API.request('GET', '/api/admin/orders');
        panel.innerHTML = orders.length
          ? `<div class="orders">${orders.map((o) => orderHTML(o, true)).join('')}</div>`
          : emptyPanel('Заказов пока нет', '');
      }
    } catch (e) {
      handleApiError(e, panel);
    }
  }

  function handleApiError(e, el) {
    if (e.status === 401) {
      API.user = null;
      updateAccountBtn();
      toast('Сессия истекла — войдите снова', 'error');
      route();
      return;
    }
    if (el && el.isConnected) el.innerHTML = `<p class="form__error">${esc(e.message)}</p>`;
    else toast(e.message, 'error');
  }

  async function onSignedIn(user) {
    API.user = user;
    updateAccountBtn();
    // избранное гостя переносим в аккаунт
    await Promise.all([...favs].map((h) => API.request('PUT', `/api/favorites/${h}`).catch(() => {})));
    const { handles } = await API.request('GET', '/api/favorites');
    favs.clear();
    handles.forEach((h) => favs.add(h));
    await Cart.refresh(); // сервер уже слил гостевую корзину с корзиной аккаунта
    toast(`Добро пожаловать, ${user.name}!`);
    const target = authNext === 'checkout' ? '#/checkout' : null;
    authNext = '';
    // тот же hash не вызывает hashchange — тогда перерисовываем сами
    if (target && location.hash !== target) location.hash = target;
    else route();
  }

  async function logout() {
    try { await API.request('POST', '/api/auth/logout'); } catch { /* всё равно выходим локально */ }
    API.user = null;
    authMode = 'login';
    favs.clear();
    store.get('kora-favs', []).forEach((h) => favs.add(h));
    updateAccountBtn();
    Cart.reset({ lines: [] });
    toast('Вы вышли из аккаунта');
    route();
  }

  /* ---------- оформление заказа ---------- */
  function renderCheckout() {
    enterView('checkout', 'Оформление заказа — KORA');
    if (!API.online) { main.innerHTML = offlineHTML('Оформление заказа'); return; }
    if (!API.user) {
      authNext = 'checkout';
      authMode = 'login';
      main.innerHTML = authHTML();
      return;
    }
    const u = API.user;
    main.innerHTML = `
      <section class="checkout container">
        <a class="back" href="${lastCatalogHash}">← Продолжить покупки</a>
        <h1 class="h2">Оформление заказа</h1>
        <div class="checkout__grid">
          <form class="form" data-form="checkout" novalidate>
            <h2 class="form__title">Получатель</h2>
            ${field('name', 'Имя и фамилия', { value: u.name, autocomplete: 'name' })}
            ${field('phone', 'Телефон', { type: 'tel', value: u.phone, autocomplete: 'tel', attrs: 'placeholder="+7 900 000-00-00"' })}
            ${field('address', 'Адрес доставки', { value: u.address, autocomplete: 'street-address' })}
            <div class="field">
              <label for="f-comment">Комментарий курьеру</label>
              <textarea id="f-comment" name="comment" rows="3" maxlength="500"></textarea>
            </div>
            <p class="form__error" role="alert"></p>
            <button class="btn btn--accent btn--lg btn--block" type="submit" id="checkout-submit">Подтвердить заказ</button>
            <p class="field__hint">Оплата при получении (демо). <span class="placeholder">[УСЛОВИЯ ДОСТАВКИ]</span></p>
          </form>
          <aside class="summary" id="checkout-summary" aria-live="polite"></aside>
        </div>
      </section>`;
    renderCheckoutSummary();
  }

  function renderCheckoutSummary() {
    const el = $('#checkout-summary');
    if (!el) return;
    const { lines, count, total } = cartView();
    el.innerHTML = `
      <h2 class="form__title">Ваш заказ${count ? ` · ${count} ${plural(count, 'товар', 'товара', 'товаров')}` : ''}</h2>
      ${lines.length ? `
        <ul class="summary__lines">
          ${lines.map((l) => {
            const i = lineInfo(l);
            return `<li>${packHTML(i.pack, { size: 'sm', cls: 'summary__pack' })}<span><b>${esc(i.title)}</b><small>${i.variant} × ${l.qty}</small></span><span>${fmt(l.sum)}</span></li>`;
          }).join('')}
        </ul>` : `<p class="muted">Корзина пуста. <a href="${lastCatalogHash}">Выбрать кофе</a></p>`}
      <div class="summary__row"><span>Доставка</span><span>${total >= FREE_SHIPPING ? 'бесплатно' : `бесплатно от ${fmt(FREE_SHIPPING)}`}</span></div>
      <div class="total"><span>Итого</span><b>${fmt(total)}</b></div>`;
    const submit = $('#checkout-submit');
    if (submit) submit.disabled = !lines.length || Cart.isSyncing;
  }

  function orderPlacedHTML(order) {
    return `
      <section class="container notice">
        <p class="eyebrow">Заказ ${order.number}</p>
        <h1 class="h2">Спасибо! Заказ принят</h1>
        <p>Сумма — ${fmt(order.total)}. Обжарим в ближайший вторник и отправим в тот же день. Статус можно отслеживать в личном кабинете.</p>
        <div class="hero__ctas">
          <a class="btn btn--accent" href="#/account/orders">Мои заказы</a>
          <a class="btn btn--ghost" href="${lastCatalogHash}">В каталог</a>
        </div>
      </section>`;
  }

  /* ---------- админка: сорта ---------- */
  // стрелки ↑↓ для строки списка (клавиатура и телефон); мышью строку можно перетащить
  const moveBtns = (kind, list, i, title) => `
    <button type="button" class="pill pill--sm admin__move" data-action="admin-move" data-kind="${kind}" data-handle="${list[i].handle}" data-dir="-1" aria-label="Выше: ${esc(title)}"${i === 0 ? ' disabled' : ''}>↑</button>
    <button type="button" class="pill pill--sm admin__move" data-action="admin-move" data-kind="${kind}" data-handle="${list[i].handle}" data-dir="1" aria-label="Ниже: ${esc(title)}"${i === list.length - 1 ? ' disabled' : ''}>↓</button>`;
  const GRIP = '<span class="admin__grip" title="Перетащите, чтобы изменить порядок" aria-hidden="true">⠿</span>';

  function drawAdminProducts(panel = $('#account-panel')) {
    if (!panel) return;
    const active = adminProducts.filter((p) => p.active).length;
    panel.innerHTML = `
      <div class="admin__bar">
        <span class="count">${adminProducts.length} ${plural(adminProducts.length, 'сорт', 'сорта', 'сортов')} · ${active} в продаже</span>
        <button type="button" class="btn btn--accent" data-action="admin-new">${adminEditing === 'new' ? 'Отмена' : '+ Добавить сорт'}</button>
      </div>
      <p class="field__hint admin__hint">Порядок здесь — порядок карточек в каталоге («По умолчанию»). Перетащите строку мышью или нажимайте ↑ ↓.</p>
      ${adminEditing === 'new' ? productFormHTML(null) : ''}
      <div class="admin__list">
        ${adminProducts.map((p, i) => `
          <div class="admin__row${p.active ? '' : ' is-off'}" draggable="true" data-drag="products" data-handle="${p.handle}">
            ${GRIP}
            ${packHTML(p, { size: 'sm', cls: 'admin__pack' })}
            <div class="admin__info">
              <b>${esc(p.title)}</b>
              <span>${LABELS.method[p.method]} · ${LABELS.roast[p.roast].toLowerCase()} обжарка · ${esc(p.notes.map((n) => n[0]).join(', '))}</span>
            </div>
            <span class="admin__price">${fmt(p.price)}${p.sale ? ` <small>−${Math.round(p.sale * 100)}%</small>` : ''}${p.prices ? '<small class="admin__manual">цены вручную</small>' : ''}</span>
            <div class="admin__actions">
              ${moveBtns('products', adminProducts, i, p.title)}
              <button type="button" class="pill pill--sm" data-action="admin-toggle" data-handle="${p.handle}" aria-pressed="${p.active}">${p.active ? 'В продаже' : 'Скрыт'}</button>
              <button type="button" class="pill pill--sm" data-action="admin-edit" data-handle="${p.handle}" aria-expanded="${adminEditing === p.handle}">Изменить</button>
              <button type="button" class="pill pill--sm admin__danger" data-action="admin-delete" data-handle="${p.handle}">Удалить</button>
            </div>
          </div>
          ${adminEditing === p.handle ? productFormHTML(p) : ''}`).join('')}
      </div>`;
    const first = panel.querySelector('[data-form="product"] input');
    if (first) first.focus();
  }

  const autoPrice = (price, w) => KORA.round10(price * (w === 500 ? 1.87 : 3.55));

  function pricesFieldHTML(v) {
    const manual = !!v.prices;
    const val = (w) => (manual ? v.prices[w] || '' : v.price ? autoPrice(v.price, w) : '');
    const radio = (mode, label) => `
      <label class="check check--radio"><input type="radio" name="priceMode" value="${mode}"${(mode === 'manual') === manual ? ' checked' : ''}><span class="check__box">${ICON.check}</span><span>${label}</span></label>`;
    return `
      <fieldset class="field">
        <legend>Цены за 500 г и 1 кг</legend>
        <div class="checks">${radio('auto', 'Авто — от цены за 250 г')}${radio('manual', 'Вручную')}</div>
        <p class="field__hint" data-role="auto-prices"${manual ? ' hidden' : ''}>500 г = цена × 1,87, 1 кг = цена × 3,55, с округлением до 10 ₽. Скидка применяется сверху.</p>
        <div class="form__grid" data-role="manual-prices"${manual ? '' : ' hidden data-auto'}>
          ${field('price500', 'Цена за 500 г, ₽', { type: 'number', value: val(500), attrs: 'min="100" step="10" placeholder="авто"' })}
          ${field('price1000', 'Цена за 1 кг, ₽', { type: 'number', value: val(1000), attrs: 'min="100" step="10" placeholder="авто"' })}
        </div>
      </fieldset>`;
  }

  function productFormHTML(p) {
    const v = p || {
      method: 'filter', roast: 'light', process: 'washed', acidity: 'mid', density: 'mid',
      taste: 'fruit', tone: 'saffron', features: ['mono'], tags: ['new'], notes: [], sale: 0,
    };
    const sel = (name, label, opts) => `
      <div class="field">
        <label for="pf-${name}">${label}</label>
        <select class="select" id="pf-${name}" name="${name}">
          ${Object.entries(opts).map(([k, l]) => `<option value="${k}"${v[name] === k ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>`;
    const checks = (name, legend, opts) => `
      <fieldset class="field">
        <legend>${legend}</legend>
        <div class="checks">
          ${Object.entries(opts).map(([k, l]) => `
            <label class="check"><input type="checkbox" name="${name}" value="${k}"${(v[name] || []).includes(k) ? ' checked' : ''}><span class="check__box">${ICON.check}</span><span>${l}</span></label>`).join('')}
        </div>
      </fieldset>`;
    const tagOpts = Object.fromEntries(Object.entries(LABELS.tab).filter(([k]) => k !== 'all' && k !== 'fav'));
    return `
      <form class="form admin__form" data-form="product" data-handle="${p ? p.handle : ''}" novalidate>
        <h3 class="form__title">${p ? 'Редактирование: ' + esc(p.title) : 'Новый сорт'}</h3>
        <div class="form__grid">
          ${field('title', 'Название', { value: v.title || '', attrs: 'placeholder="Эфиопия Иргачефф"' })}
          ${p ? '' : field('handle', 'Адрес в URL (латиница)', { value: '', attrs: 'placeholder="ethiopia-yirgacheffe"' })}
          ${field('country', 'Страна', { value: v.country || '' })}
          ${field('region', 'Регион', { value: v.region || '' })}
          ${field('lead', 'Характер (прилагательное)', { value: v.lead || '', attrs: 'placeholder="Сочный"' })}
          ${field('image', 'Ссылка на фото (необязательно)', { type: 'url', value: v.image || '', attrs: 'placeholder="https://…/pack.jpg"' })}
          ${field('notes', 'Ноты через запятую', { value: (v.notes || []).map((n) => n[0]).join(', '), attrs: 'placeholder="жасмин, лимон, мёд"' })}
          ${field('price', 'Цена за 250 г, ₽', { type: 'number', value: v.price || '', attrs: 'min="100" step="10"' })}
          ${field('sale', 'Скидка, %', { type: 'number', value: Math.round((v.sale || 0) * 100), attrs: 'min="0" max="70"' })}
          ${sel('method', 'Способ', LABELS.method)}
          ${sel('roast', 'Обжарка', LABELS.roast)}
          ${sel('process', 'Обработка', LABELS.process)}
          ${sel('taste', 'Вкус', LABELS.taste)}
          ${sel('acidity', 'Кислотность', LABELS.level)}
          ${sel('density', 'Плотность', LABELS.level)}
        </div>
        ${pricesFieldHTML(v)}
        <fieldset class="field">
          <legend>Цвет пачки</legend>
          <div class="swatches">
            ${Object.entries(TONES).map(([k, t]) => `
              <label class="swatch"><input type="radio" name="tone" value="${k}"${v.tone === k ? ' checked' : ''}><span style="background:${t.bg}"></span><span class="visually-hidden">${k}</span></label>`).join('')}
          </div>
        </fieldset>
        ${checks('features', 'Особенности', LABELS.feature)}
        ${checks('tags', 'Подборки', tagOpts)}
        <p class="form__error" role="alert"></p>
        <div class="form__actions">
          <button class="btn btn--accent" type="submit">${p ? 'Сохранить' : 'Добавить сорт'}</button>
          <button type="button" class="btn btn--ghost" data-action="admin-cancel">Отмена</button>
        </div>
      </form>`;
  }

  async function afterCatalogChange() {
    await API.reloadCatalog();
    rebuildIndex();
    await Cart.refresh(); // сервер уже убрал из корзины скрытые сорта
  }

  async function adminDelete(handle) {
    const p = adminProducts.find((x) => x.handle === handle);
    if (!p || !confirm(`Удалить сорт «${p.title}» навсегда?\n\nОтзывы о нём и строки в корзинах тоже удалятся. Оформленные заказы сохранятся.\nЕсли нужно лишь убрать его с витрины — нажмите «В продаже», чтобы скрыть.`)) return;
    try {
      await API.request('DELETE', `/api/admin/products/${handle}`);
      adminProducts = adminProducts.filter((x) => x.handle !== handle);
      if (adminEditing === handle) adminEditing = null;
      await afterCatalogChange();
      drawAdminProducts();
      toast(`Сорт «${p.title}» удалён`);
    } catch (e) {
      handleApiError(e);
    }
  }

  // порядок карточек: меняем локально, сохраняем на сервере, при ошибке берём порядок с сервера
  async function adminMove(kind, handle, to) {
    const list = kind === 'products' ? adminProducts : adminBundles;
    const from = list.findIndex((x) => x.handle === handle);
    if (from < 0 || to < 0 || to >= list.length || to === from) return;
    list.splice(to, 0, ...list.splice(from, 1));
    const draw = kind === 'products' ? drawAdminProducts : drawAdminBundles;
    draw();
    try {
      await API.request('PUT', `/api/admin/${kind}-order`, { handles: list.map((x) => x.handle) });
      await API.reloadCatalog();
      rebuildIndex();
    } catch (e) {
      handleApiError(e);
      if (kind === 'products') adminProducts = (await API.request('GET', '/api/admin/products')).products;
      else adminBundles = (await API.request('GET', '/api/admin/bundles')).bundles;
      draw();
    }
  }

  /* ---------- админка: наборы ---------- */
  function drawAdminBundles(panel = $('#account-panel')) {
    if (!panel) return;
    const active = adminBundles.filter((b) => b.active && b.price).length;
    const byH = new Map(adminProducts.map((p) => [p.handle, p]));
    panel.innerHTML = `
      <div class="admin__bar">
        <span class="count">${adminBundles.length} ${plural(adminBundles.length, 'набор', 'набора', 'наборов')} · ${active} в продаже</span>
        <button type="button" class="btn btn--accent" data-action="admin-bundle-new">${adminBundleEditing === 'new' ? 'Отмена' : '+ Добавить набор'}</button>
      </div>
      <p class="field__hint admin__hint">Набор стоит сумму пачек по 250 г минус скидка набора и продаётся, только пока в продаже все его сорта. Порядок — как на странице «Наборы».</p>
      ${adminBundleEditing === 'new' ? bundleFormHTML(null) : ''}
      <div class="admin__list">
        ${adminBundles.map((b, i) => {
          const first = byH.get(b.items[0]);
          const off = !b.active || !b.price;
          return `
          <div class="admin__row${off ? ' is-off' : ''}" draggable="true" data-drag="bundles" data-handle="${b.handle}">
            ${GRIP}
            ${first ? packHTML(first, { size: 'sm', cls: 'admin__pack' }) : '<span class="admin__pack"></span>'}
            <div class="admin__info">
              <b>${esc(b.title)}</b>
              <span>${esc(b.tag)} · ${b.items.map((h) => esc(byH.get(h) ? byH.get(h).title : h)).join(', ')}</span>
            </div>
            <span class="admin__price">${b.price ? fmt(b.price.now) : '—'} <small>−${Math.round(b.discount * 100)}%</small>${b.active && !b.price ? '<small class="admin__manual">сорт снят с продажи</small>' : ''}</span>
            <div class="admin__actions">
              ${moveBtns('bundles', adminBundles, i, b.title)}
              <button type="button" class="pill pill--sm" data-action="admin-bundle-toggle" data-handle="${b.handle}" aria-pressed="${b.active}">${b.active ? 'В продаже' : 'Скрыт'}</button>
              <button type="button" class="pill pill--sm" data-action="admin-bundle-edit" data-handle="${b.handle}" aria-expanded="${adminBundleEditing === b.handle}">Изменить</button>
              <button type="button" class="pill pill--sm admin__danger" data-action="admin-bundle-delete" data-handle="${b.handle}">Удалить</button>
            </div>
          </div>
          ${adminBundleEditing === b.handle ? bundleFormHTML(b) : ''}`;
        }).join('')}
      </div>`;
    const firstInput = panel.querySelector('[data-form="bundle"] input');
    if (firstInput) firstInput.focus();
  }

  function bundleFormHTML(b) {
    const v = b || { tag: '', desc: '', discount: 0.15, items: [] };
    return `
      <form class="form admin__form" data-form="bundle" data-handle="${b ? b.handle : ''}" novalidate>
        <h3 class="form__title">${b ? 'Редактирование: ' + esc(b.title) : 'Новый набор'}</h3>
        <div class="form__grid">
          ${field('title', 'Название', { value: v.title || '', attrs: 'placeholder="Набор «Знакомство»"' })}
          ${b ? '' : field('handle', 'Адрес (латиница)', { value: '', attrs: 'placeholder="starter"' })}
          ${field('tag', 'Метка на карточке', { value: v.tag, attrs: 'placeholder="Хит" maxlength="30"' })}
          ${field('discount', 'Скидка набора, %', { type: 'number', value: Math.round(v.discount * 100), attrs: 'min="0" max="50"' })}
        </div>
        <div class="field">
          <label for="bundle-desc-${b ? b.handle : 'new'}">Описание</label>
          <textarea id="bundle-desc-${b ? b.handle : 'new'}" name="desc" rows="2" maxlength="300">${esc(v.desc)}</textarea>
        </div>
        <fieldset class="field">
          <legend>Сорта в наборе (2–6, по 250 г)</legend>
          <div class="checks">
            ${adminProducts.map((p) => `
              <label class="check"><input type="checkbox" name="items" value="${p.handle}"${v.items.includes(p.handle) ? ' checked' : ''}><span class="check__box">${ICON.check}</span><span>${esc(p.title)}${p.active ? '' : ' <small class="muted">(скрыт)</small>'}</span></label>`).join('')}
          </div>
        </fieldset>
        <p class="form__error" role="alert"></p>
        <div class="form__actions">
          <button class="btn btn--accent" type="submit">${b ? 'Сохранить' : 'Добавить набор'}</button>
          <button type="button" class="btn btn--ghost" data-action="admin-bundle-cancel">Отмена</button>
        </div>
      </form>`;
  }

  async function adminBundleToggle(handle) {
    const b = adminBundles.find((x) => x.handle === handle);
    if (!b) return;
    try {
      await API.request('PUT', `/api/admin/bundles/${handle}`, { active: !b.active });
      await afterCatalogChange();
      adminBundles = (await API.request('GET', '/api/admin/bundles')).bundles;
      drawAdminBundles();
      $(`[data-action="admin-bundle-toggle"][data-handle="${handle}"]`).focus();
      toast(!b.active ? `«${b.title}» снова в продаже` : `«${b.title}» скрыт`);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function adminBundleDelete(handle) {
    const b = adminBundles.find((x) => x.handle === handle);
    if (!b || !confirm(`Удалить набор «${b.title}» навсегда? Оформленные заказы сохранятся.`)) return;
    try {
      await API.request('DELETE', `/api/admin/bundles/${handle}`);
      adminBundles = adminBundles.filter((x) => x.handle !== handle);
      if (adminBundleEditing === handle) adminBundleEditing = null;
      await afterCatalogChange();
      drawAdminBundles();
      toast(`Набор «${b.title}» удалён`);
    } catch (e) {
      handleApiError(e);
    }
  }

  async function adminToggle(handle) {
    const p = adminProducts.find((x) => x.handle === handle);
    if (!p) return;
    try {
      const { product } = await API.request('PUT', `/api/admin/products/${handle}`, { active: !p.active });
      Object.assign(p, product);
      await afterCatalogChange();
      drawAdminProducts();
      $(`[data-action="admin-toggle"][data-handle="${handle}"]`).focus();
      toast(product.active ? `«${product.title}» снова в продаже` : `«${product.title}» скрыт из каталога`);
    } catch (e) {
      handleApiError(e);
    }
  }

  /* ---------- отправка форм ---------- */
  const FORMS = {
    async login(d) {
      const { user } = await API.request('POST', '/api/auth/login', { email: d.email, password: d.password });
      await onSignedIn(user);
    },
    async register(d) {
      const { user } = await API.request('POST', '/api/auth/register', { name: d.name, email: d.email, password: d.password });
      await onSignedIn(user);
    },
    async profile(d) {
      const { user } = await API.request('PATCH', '/api/me', { name: d.name, phone: d.phone, address: d.address });
      API.user = user;
      updateAccountBtn();
      $('.account__head h1').textContent = `Привет, ${user.name}`;
      toast('Профиль сохранён');
    },
    async password(d, form) {
      await API.request('POST', '/api/me/password', { current: d.current, next: d.next });
      form.reset();
      toast('Пароль изменён');
    },
    async checkout(d) {
      const { order } = await API.request('POST', '/api/orders', d);
      Cart.reset({ lines: [] });
      main.innerHTML = orderPlacedHTML(order);
      window.scrollTo(0, 0);
    },
    async product(d, form) {
      const old = form.dataset.handle && adminProducts.find((x) => x.handle === form.dataset.handle);
      const colors = new Map(old ? old.notes : []);
      const payload = {
        title: d.title, country: d.country, region: d.region, lead: d.lead, image: String(d.image || '').trim(),
        method: d.method, roast: d.roast, process: d.process, taste: d.taste,
        acidity: d.acidity, density: d.density, tone: d.tone,
        price: Number(d.price) || null, sale: (Number(d.sale) || 0) / 100,
        // пустое поле в ручном режиме — для этого веса цена считается автоматически
        prices: d.priceMode === 'manual' ? { 500: Number(d.price500) || null, 1000: Number(d.price1000) || null } : null,
        notes: String(d.notes || '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean)
          .map((n, i) => [n, colors.get(n) || NOTE_COLORS[i % NOTE_COLORS.length]]),
        features: new FormData(form).getAll('features'),
        tags: new FormData(form).getAll('tags'),
      };
      if (old) {
        await API.request('PUT', `/api/admin/products/${old.handle}`, payload);
      } else {
        await API.request('POST', '/api/admin/products', { ...payload, handle: String(d.handle || '').trim().toLowerCase() });
      }
      adminEditing = null;
      await afterCatalogChange();
      adminProducts = (await API.request('GET', '/api/admin/products')).products;
      drawAdminProducts();
      toast(old ? 'Сорт обновлён' : `Сорт «${payload.title}» добавлен в каталог`);
    },
    async bundle(d, form) {
      const old = form.dataset.handle;
      const payload = {
        title: d.title, tag: d.tag, desc: d.desc,
        discount: (Number(d.discount) || 0) / 100,
        items: new FormData(form).getAll('items'),
      };
      if (old) await API.request('PUT', `/api/admin/bundles/${old}`, payload);
      else await API.request('POST', '/api/admin/bundles', { ...payload, handle: String(d.handle || '').trim().toLowerCase() });
      adminBundleEditing = null;
      await afterCatalogChange();
      adminBundles = (await API.request('GET', '/api/admin/bundles')).bundles;
      drawAdminBundles();
      toast(old ? 'Набор обновлён' : `Набор «${payload.title}» добавлен`);
    },
    async review(d) {
      if (!d.rating) throw new Error('Поставьте оценку — от 1 до 5 звёзд');
      await API.request('POST', `/api/products/${reviewsHandle}/reviews`, { rating: Number(d.rating), text: d.text || '' });
      await afterReviewChange();
      toast('Спасибо за отзыв!');
    },
  };

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form]');
    if (!form || !FORMS[form.dataset.form]) return;
    e.preventDefault();
    const err = form.querySelector('.form__error');
    const btn = form.querySelector('[type="submit"]');
    err.textContent = '';
    btn.disabled = true;
    try {
      await FORMS[form.dataset.form](Object.fromEntries(new FormData(form)), form);
    } catch (ex) {
      if (ex.status === 401 && !['login', 'password'].includes(form.dataset.form)) handleApiError(ex);
      else err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });


  /* ======================================================================
     Роутер (hash: работает и с file://)
     ====================================================================== */
  const PAGES = { '/': 'home', '/catalog': 'catalog', '/sets': 'sets', '/about': 'about', '/subscription': 'subscription', '/checkout': 'checkout' };
  // старые якоря одностраничной версии (#catalog, #sets…) ведут на новые страницы
  const LEGACY = { catalog: '/catalog', results: '/catalog', quiz: '/catalog', sets: '/sets', story: '/about', subscribe: '/subscription' };

  function parseHash() {
    let h = location.hash.slice(1) || '/';
    if (!h.startsWith('/')) h = LEGACY[h] || '/';
    const [raw, qs = ''] = h.split('?');
    const path = raw.replace(/\/+$/, '') || '/';
    const m = path.match(/^\/product\/([\w-]+)$/);
    if (m) return { name: 'product', handle: m[1] };
    const ma = path.match(/^\/account(?:\/([\w-]+))?$/);
    if (ma) return { name: 'account', tab: ma[1] || '', params: new URLSearchParams(qs) };
    // ссылки вида #/?method=filter из прошлой версии — это каталог
    if (path === '/' && qs) return { name: 'catalog', params: new URLSearchParams(qs) };
    return { name: PAGES[path] || 'notfound', params: new URLSearchParams(qs) };
  }

  function scrollToId(id) {
    if (id === 'top') { window.scrollTo({ top: 0, behavior: behavior() }); return; }
    if (id === 'main') { main.focus(); return; }
    const el = document.getElementById(id) || (id === 'quiz' && document.getElementById('catalog'));
    if (el) el.scrollIntoView({ behavior: behavior(), block: 'start' });
  }

  const STATIC_PAGES = {
    home: { title: DEFAULT_TITLE, html: () => homeHTML() },
    sets: { title: 'Наборы кофе — KORA', html: () => setsHTML() },
    about: { title: 'Обжарочная — KORA', html: () => aboutHTML() },
    subscription: { title: 'Подписка на кофе — KORA', html: () => subscriptionHTML() },
    notfound: {
      title: 'Страница не найдена — KORA',
      html: () => `
        <section class="container notice">
          <p class="eyebrow">404</p>
          <h1 class="h2">Такой страницы нет</h1>
          <a class="btn btn--accent" href="#/">На главную</a>
        </section>`,
    },
  };

  // какой пункт меню подсвечивать
  const NAV_FOR = {
    home: '#/', catalog: '#/catalog', product: '#/catalog', sets: '#/sets', subscription: '#/subscription',
    about: '#/about', account: '#/account', checkout: '#/account',
  };
  function updateNav() {
    const cur = state.view === 'catalog' && state.f.tab === 'fav' ? '#/catalog?tab=fav' : NAV_FOR[state.view];
    $$('.nav a, .tabbar a').forEach((a) => {
      if (a.getAttribute('href') === cur) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function routeCatalog(params, prev) {
    const f = readFilters(params);
    if (prev === 'catalog') {
      // фильтры поменялись снаружи (ссылка, «назад»), а не через setFilters
      if (filtersToQuery(f) !== filtersToQuery(state.f)) {
        state.f = f;
        updateCatalog();
        window.scrollTo({ top: 0, behavior: behavior() });
      }
      return;
    }
    enterView('catalog', 'Каталог кофе — KORA');
    state.f = f;
    main.innerHTML = catalogHTML();
    updateCatalog();
    // из карточки товара возвращаемся на ту же позицию
    if (prev === 'product') window.scrollTo(0, catalogScrollY);
  }

  // каталог приходит только из базы: без сервера (и без сохранённой копии) показывать нечего
  const NEEDS_CATALOG = ['home', 'catalog', 'product', 'sets'];
  const noCatalogHTML = () => `
    <section class="container notice">
      ${API.online ? `
      <p class="eyebrow">Каталог пуст</p>
      <h1 class="h2">Сейчас нет сортов в продаже</h1>
      <p>Добавьте сорта или верните скрытые в админке: Кабинет → Сорта.</p>
      <a class="btn btn--accent" href="#/account">Открыть кабинет</a>` : !navigator.onLine ? `
      <p class="eyebrow">Нет сети</p>
      <h1 class="h2">Каталог загружается с сервера</h1>
      <p>Сохранённой копии каталога на этом устройстве нет. Когда соединение вернётся, страница обновится сама.</p>` : `
      <p class="eyebrow">Нужен бэкенд</p>
      <h1 class="h2">Каталог хранится в базе данных</h1>
      <p>Запустите сервер командой <code>npm start</code> и откройте <a href="http://localhost:3000/">localhost:3000</a>.</p>`}
    </section>`;

  function route() {
    const r = parseHash();
    const prev = state.view;
    if (r.name !== 'catalog' && prev === 'catalog') catalogScrollY = window.scrollY;
    if (!PRODUCTS.length && NEEDS_CATALOG.includes(r.name)) {
      enterView('empty', DEFAULT_TITLE); // не 'catalog': иначе следующий переход попробует обновить несуществующую сетку
      main.innerHTML = noCatalogHTML();
    } else if (r.name === 'product') renderProduct(r.handle);
    else if (r.name === 'account') renderAccount(r.tab, r.params);
    else if (r.name === 'checkout') renderCheckout();
    else if (r.name === 'catalog') routeCatalog(r.params, prev);
    else {
      const page = STATIC_PAGES[r.name];
      enterView(r.name, page.title);
      main.innerHTML = page.html();
    }
    updateNav();
    if (pendingScroll) {
      const id = pendingScroll;
      pendingScroll = null;
      requestAnimationFrame(() => scrollToId(id));
    }
  }

  /* ======================================================================
     События
     ====================================================================== */
  let searchTimer;

  function toggleSearch(force) {
    const bar = $('#search-bar');
    const open = force !== undefined ? force : bar.hidden;
    bar.hidden = !open;
    $('.header__actions [data-action="toggle-search"]').setAttribute('aria-expanded', String(open));
    if (open) $('#search-input').focus();
    else $('.header__actions [data-action="toggle-search"]').focus();
  }

  document.addEventListener('click', (e) => {
    // ссылка «страница + место на ней» (skip-link, «Как выбрать кофе»)
    const scrollLink = e.target.closest('[data-scroll]');
    if (scrollLink) {
      e.preventDefault();
      if (cartOpen) closeCart(false);
      const id = scrollLink.dataset.scroll;
      const href = scrollLink.getAttribute('href');
      if (id === 'main' || !href || href === (location.hash || '#/')) scrollToId(id);
      else { pendingScroll = id; location.hash = href; }
      return;
    }
    // ссылка на текущую страницу: hashchange не будет — просто поднимаемся наверх
    const link = e.target.closest('a[href^="#/"]');
    if (link && link.getAttribute('href') === (location.hash || '#/')) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: behavior() });
    }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const f = state.f;
    const p = el.dataset.handle && byHandle.get(el.dataset.handle);

    switch (el.dataset.action) {
      /* каталог */
      case 'pill':
        setFilters({ [el.dataset.key]: el.dataset.value });
        break;
      case 'quick': {
        const q = QUICK.find((x) => x.id === el.dataset.v);
        setFilters(isQuickActive(q) ? { ...DEFAULTS, sort: f.sort } : { ...DEFAULTS, sort: f.sort, ...q.patch });
        break;
      }
      case 'tab':
        setFilters({ tab: el.dataset.v });
        break;
      case 'chip': {
        const { key, value } = el.dataset;
        if (MULTI.includes(key)) setFilters({ [key]: f[key].filter((v) => v !== value) });
        else setFilters({ [key]: '' });
        break;
      }
      case 'reset':
        setFilters({ ...DEFAULTS, sort: f.sort });
        break;
      case 'page':
        setFilters({ p: +el.dataset.v, from: +el.dataset.v }, { keepPage: true });
        scrollToId('results');
        break;
      case 'more': {
        const before = $$('#grid .card').length;
        setFilters({ p: f.p + 1 }, { keepPage: true });
        const next = $$('#grid .card')[before];
        if (next) next.querySelector('.card__link').focus({ preventScroll: true });
        break;
      }
      case 'open-filters': openFilters(); break;
      case 'close-filters': closeFilters(); break;

      /* карточка */
      case 'weight':
        setSel(p, { weight: +el.dataset.weight });
        refreshCards(p.handle);
        break;
      case 'add': {
        const sel = getSel(p);
        Cart.add(variantId(p.handle, sel.weight, sel.grind), 1);
        flashDone(el, () => quickLabel(getSel(p)));
        break;
      }
      case 'fav':
        toggleFav(p);
        break;
      case 'add-set': {
        const h = el.dataset.set;
        Cart.add(setVariantId(h, bundleGrind.get(h) || 'beans'), 1);
        flashDone(el, () => setButtonLabel(bundleByHandle.get(h)));
        break;
      }

      /* квиз */
      case 'quiz':
        quiz.answers[QUIZ[quiz.step].key] = el.dataset.v;
        quiz.step += 1;
        rerenderQuiz();
        break;
      case 'quiz-back':
        quiz.step = Math.max(0, quiz.step - 1);
        rerenderQuiz();
        break;
      case 'quiz-reset':
        quiz = { step: 0, answers: {} };
        rerenderQuiz();
        break;
      case 'quiz-apply':
        applyQuiz();
        break;

      /* корзина */
      case 'open-cart': openCart(); break;
      case 'close-cart': closeCart(); break;
      case 'cart-nav': closeCart(false); break;
      case 'line-inc': {
        const id = el.dataset.variant;
        Cart.setQty(id, Math.min(99, Cart.qtyOf(id) + 1));
        break;
      }
      case 'line-dec': {
        const id = el.dataset.variant;
        Cart.setQty(id, Cart.qtyOf(id) - 1);
        break;
      }
      case 'line-remove':
        Cart.remove(el.dataset.variant);
        break;
      case 'cart-clear': {
        const { count } = cartView();
        if (!count || !confirm(`Убрать из корзины все товары (${count} шт.)?`)) break;
        Cart.clear();
        toast('Корзина очищена');
        $('[data-action="close-cart"]', $('#cart-drawer')).focus(); // кнопка исчезла вместе с подвалом
        break;
      }
      case 'checkout':
        closeCart(false);
        location.hash = '#/checkout';
        break;

      /* аккаунт и админка */
      case 'auth-mode':
        authMode = el.dataset.v;
        main.innerHTML = authHTML();
        $('.auth form input').focus();
        break;
      case 'logout': logout(); break;
      case 'admin-new':
        adminEditing = adminEditing === 'new' ? null : 'new';
        drawAdminProducts();
        break;
      case 'admin-edit':
        adminEditing = adminEditing === el.dataset.handle ? null : el.dataset.handle;
        drawAdminProducts();
        break;
      case 'admin-cancel':
        adminEditing = null;
        drawAdminProducts();
        break;
      case 'admin-toggle': adminToggle(el.dataset.handle); break;
      case 'admin-delete': adminDelete(el.dataset.handle); break;
      case 'admin-move': {
        const list = el.dataset.kind === 'products' ? adminProducts : adminBundles;
        const i = list.findIndex((x) => x.handle === el.dataset.handle);
        const dir = +el.dataset.dir;
        adminMove(el.dataset.kind, el.dataset.handle, i + dir).then(() => {
          // фокус остаётся на той же стрелке перемещённой строки, чтобы двигать дальше
          const btn = $(`[data-action="admin-move"][data-handle="${el.dataset.handle}"][data-dir="${dir}"]`);
          if (btn && !btn.disabled) btn.focus();
        });
        break;
      }
      case 'admin-bundle-new':
        adminBundleEditing = adminBundleEditing === 'new' ? null : 'new';
        drawAdminBundles();
        break;
      case 'admin-bundle-edit':
        adminBundleEditing = adminBundleEditing === el.dataset.handle ? null : el.dataset.handle;
        drawAdminBundles();
        break;
      case 'admin-bundle-cancel':
        adminBundleEditing = null;
        drawAdminBundles();
        break;
      case 'admin-bundle-toggle': adminBundleToggle(el.dataset.handle); break;
      case 'admin-bundle-delete': adminBundleDelete(el.dataset.handle); break;
      case 'review-delete': deleteReview(el.dataset.id); break;

      /* страница товара */
      case 'back':
        e.preventDefault();
        location.hash = lastCatalogHash;
        break;
      case 'pdp-weight': pdp.weight = +el.dataset.v; updatePdp(); break;
      case 'pdp-grind': pdp.grind = el.dataset.v; updatePdp(); break;
      case 'pdp-inc': pdp.qty = Math.min(99, pdp.qty + 1); updatePdp(); break;
      case 'pdp-dec': pdp.qty = Math.max(1, pdp.qty - 1); updatePdp(); break;
      case 'pdp-add':
        Cart.add(variantId(pdp.p.handle, pdp.weight, pdp.grind), pdp.qty);
        flashDone(el, () => `В корзину · ${fmt(priceOf(pdp.p, pdp.weight).now * pdp.qty)}`);
        break;

      /* прочее */
      case 'toggle-search': toggleSearch(); break;
      case 'install': installApp(); break;
      case 'soon': toast(`${el.dataset.soon}: раздел скоро откроется`); break;
      default: break;
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('input[data-facet]')) {
      const k = t.dataset.facet;
      const set = new Set(state.f[k]);
      t.checked ? set.add(t.value) : set.delete(t.value);
      setFilters({ [k]: [...set] });
    } else if (t.id === 'sort') {
      setFilters({ sort: t.value }, { keepPage: true });
    } else if (t.matches('[data-role="grind"]')) {
      setSel(byHandle.get(t.dataset.handle), { grind: t.value });
    } else if (t.matches('[data-role="set-grind"]')) {
      bundleGrind.set(t.dataset.set, t.value);
    } else if (t.name === 'priceMode') {
      // ручной режим: подставляем текущие авто-цены как отправную точку
      const form = t.form;
      const manual = t.value === 'manual';
      form.querySelector('[data-role="manual-prices"]').hidden = !manual;
      form.querySelector('[data-role="auto-prices"]').hidden = manual;
      const price = Number(form.elements.price.value);
      if (manual && price) {
        [500, 1000].forEach((w) => {
          const inp = form.elements['price' + w];
          // поле с авто-ценой, которое ещё не трогали, — пересчитываем от текущей цены за 250 г
          if (!inp.value || (inp.closest('[data-auto]') && inp.value === inp.defaultValue)) inp.value = autoPrice(price, w);
        });
      }
    } else if (t.matches('[data-role="order-status"]')) {
      API.request('PATCH', `/api/admin/orders/${t.dataset.id}`, { status: t.value })
        .then(() => toast('Статус заказа обновлён'), (err) => handleApiError(err));
    }
  });

  /* ---------- админка: перетаскивание строк (сорта, наборы) ---------- */
  let dragging = null; // { kind, handle }
  const dropRow = (e) => {
    const row = e.target.closest && e.target.closest('[data-drag]');
    return row && dragging && row.dataset.drag === dragging.kind ? row : null;
  };
  const clearDrop = () => $$('.admin__row.is-over-top, .admin__row.is-over-bottom').forEach((r) => r.classList.remove('is-over-top', 'is-over-bottom'));
  document.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest('[data-drag]');
    if (!row) return;
    dragging = { kind: row.dataset.drag, handle: row.dataset.handle };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.handle);
    row.classList.add('is-dragging');
  });
  document.addEventListener('dragover', (e) => {
    const row = dropRow(e);
    if (!row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const below = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    clearDrop();
    row.classList.add(below ? 'is-over-bottom' : 'is-over-top');
  });
  document.addEventListener('drop', (e) => {
    const row = dropRow(e);
    if (!row) return;
    e.preventDefault();
    const list = dragging.kind === 'products' ? adminProducts : adminBundles;
    const from = list.findIndex((x) => x.handle === dragging.handle);
    let to = list.findIndex((x) => x.handle === row.dataset.handle);
    if (row.classList.contains('is-over-bottom')) to += 1;
    if (from < to) to -= 1; // после извлечения строки индексы ниже неё сдвигаются
    clearDrop();
    adminMove(dragging.kind, dragging.handle, to);
  });
  document.addEventListener('dragend', () => {
    clearDrop();
    $$('.admin__row.is-dragging').forEach((r) => r.classList.remove('is-dragging'));
    dragging = null;
  });

  $('#search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => {
      setFilters({ q });
    }, 250);
  });
  $('#search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); scrollToId('results'); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (cartOpen) closeCart();
      else if (filtersOpen) closeFilters();
      else if (!$('#search-bar').hidden) toggleSearch(false);
      return;
    }
    if (e.key === 'Tab') {
      if (cartOpen) trapFocus($('#cart-drawer'), e);
      else if (filtersOpen) trapFocus($('#filters'), e);
    }
  });

  /* ---------- PWA: установка и работа без сети ---------- */
  // само событие beforeinstallprompt ловит api.js и показывает кнопку «Установить приложение»
  const hideInstall = () => {
    API.installPrompt = null;
    $$('[data-action="install"]').forEach((b) => { b.hidden = true; });
  };
  window.addEventListener('appinstalled', () => { hideInstall(); toast('KORA установлена на устройство'); });
  async function installApp() {
    const prompt = API.installPrompt;
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    hideInstall();
  }

  window.addEventListener('offline', () => toast('Нет соединения — показываем сохранённую версию', 'error'));
  // открылись без сети на mock-данных — с возвращением сети подключаемся к магазину заново
  window.addEventListener('online', () => { if (!API.online && /^https?:$/.test(location.protocol)) location.reload(); });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('KORA: service worker не зарегистрирован', e));
  }

  /* ---------- старт ---------- */
  initCartFoot();
  Cart.subscribe(() => {
    renderCart();
    if (state.view === 'checkout') renderCheckoutSummary();
  });
  renderCart();
  updateAccountBtn();
  window.addEventListener('hashchange', route);
  route();
});
