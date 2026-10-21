/* KORA — клиент API. Каталог, корзина, аккаунт и избранное берутся с сервера (база data/kora.db).
   Последний полученный каталог кешируется в localStorage, чтобы установленное приложение
   могло показать его без сети. Нет ни сервера, ни копии — каталог пуст, app.js покажет подсказку. */
window.KORA_API = (() => {
  const K = window.KORA;
  const api = { online: false, user: null, initialCart: null, favorites: null, installPrompt: null };

  // приглашение установить PWA может прийти раньше, чем app.js дождётся API, — ловим сразу
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    api.installPrompt = e;
    document.querySelectorAll('[data-action="install"]').forEach((b) => { b.hidden = false; });
  });

  async function request(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body || {});
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Сервер недоступен, попробуйте ещё раз');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const SNAPSHOT = 'kora_catalog';

  function applyCatalog({ products, bundles }, { save = true } = {}) {
    K.PRODUCTS.splice(0, K.PRODUCTS.length, ...products);
    K.BUNDLES.splice(0, K.BUNDLES.length, ...bundles);
    if (save) {
      try { localStorage.setItem(SNAPSHOT, JSON.stringify({ products, bundles })); } catch { /* приватный режим / нет места */ }
    }
  }

  // копия каталога с прошлого визита — только для работы без сервера
  function applySnapshot() {
    try {
      const snap = JSON.parse(localStorage.getItem(SNAPSHOT) || 'null');
      if (snap && Array.isArray(snap.products) && Array.isArray(snap.bundles)) applyCatalog(snap, { save: false });
    } catch { /* битая или недоступная копия — остаёмся с пустым каталогом */ }
  }

  async function boot() {
    if (!/^https?:$/.test(location.protocol)) { applySnapshot(); return api; }
    try {
      const health = await request('GET', '/api/health');
      if (!health.ok) { applySnapshot(); return api; }
    } catch {
      applySnapshot(); // нет сети или статический хостинг без API
      return api;
    }
    const [catalog, me, cart] = await Promise.all([
      request('GET', '/api/catalog'),
      request('GET', '/api/me'),
      request('GET', '/api/cart'),
    ]);
    applyCatalog(catalog);
    api.user = me.user;
    api.initialCart = cart;
    if (api.user) api.favorites = (await request('GET', '/api/favorites')).handles;
    api.online = true;
    return api;
  }

  Object.assign(api, {
    request,
    async reloadCatalog() { applyCatalog(await request('GET', '/api/catalog')); },
  });

  api.ready = boot().catch((e) => {
    console.warn('KORA: API недоступен, каталог из сохранённой копии', e);
    api.online = false;
    if (!K.PRODUCTS.length) applySnapshot();
    return api;
  });
  return api;
})();
