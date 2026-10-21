// KORA backend: node:http + node:sqlite, без внешних зависимостей.
// Отдаёт сайт из /site и JSON API под /api.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openDb, cleanup, closeDb, tx, KORA } from './db.js';
import { hashPassword, verifyPassword, newToken, hashToken, parseCookies, cookie } from './auth.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const PORT = Number(process.env.PORT) || 3000;
const SECURE = process.env.COOKIE_SECURE === '1';
const SESSION_DAYS = 30;
const ORDER_STATUSES = ['new', 'roasting', 'shipped', 'done', 'cancelled'];

const db = openDb();

/* ======================================================================
   Утилиты HTTP
   ====================================================================== */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

async function readJson(req) {
  // Только JSON: обычная HTML-форма с чужого сайта не может его отправить без CORS — это защита от CSRF
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) fail(415, 'Ожидается application/json');
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 100_000) fail(413, 'Слишком большой запрос');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Некорректный JSON'); }
}

function addCookie(res, value) {
  const prev = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...prev, value]);
}

// простой rate limit для входа/регистрации
const hits = new Map();
function rateLimit(req, key, limit = 20, windowMs = 10 * 60_000) {
  const id = `${key}:${req.socket.remoteAddress}`;
  const now = Date.now();
  const h = hits.get(id) || { n: 0, reset: now + windowMs };
  if (now > h.reset) { h.n = 0; h.reset = now + windowMs; }
  h.n += 1;
  hits.set(id, h);
  if (h.n > limit) fail(429, 'Слишком много попыток, попробуйте позже');
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ======================================================================
   Каталог
   ====================================================================== */
const rowToProduct = (r) => ({ ...JSON.parse(r.data), active: !!r.active });

// Каталог читается почти в каждом запросе корзины/заказа — держим его в памяти.
// Свои изменения (админка) сбрасывают кеш явно, чужие (другой процесс правит kora.db)
// ловим по PRAGMA data_version: он меняется после каждого коммита другого подключения.
let catalogCache = null;
const dataVersion = () => db.prepare('PRAGMA data_version').get().data_version;
const invalidateCatalog = () => { catalogCache = null; };

function loadCatalog({ includeInactive = false } = {}) {
  if (includeInactive) return readCatalog({ includeInactive });
  const version = dataVersion();
  if (!catalogCache || catalogCache.version !== version) catalogCache = { version, cat: readCatalog() };
  return catalogCache.cat;
}

// rating/reviews в данных сорта — стартовые значения; отзывы с сайта добавляются к ним
function reviewStats() {
  return new Map(db.prepare('SELECT handle, COUNT(*) AS n, SUM(rating) AS s FROM reviews GROUP BY handle').all().map((r) => [r.handle, r]));
}
function withReviews(p, stats = reviewStats()) {
  const r = stats.get(p.handle);
  if (!r) return p;
  const base = p.reviews || 0;
  const n = base + r.n;
  return { ...p, reviews: n, rating: Math.round((((p.rating || 0) * base + r.s) / n) * 10) / 10 };
}

function readCatalog({ includeInactive = false } = {}) {
  const stats = reviewStats();
  const products = db.prepare(`SELECT * FROM products ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY position, handle`).all()
    .map((r) => withReviews(rowToProduct(r), stats));
  const map = new Map(products.filter((p) => p.active).map((p) => [p.handle, p]));
  const bundles = db.prepare('SELECT * FROM bundles WHERE active = 1 ORDER BY position').all()
    .map((r) => JSON.parse(r.data))
    .filter((b) => KORA.bundlePrice(b, map)); // набор продаётся, только если все сорта в наличии
  return { products, bundles, map, bundleMap: new Map(bundles.map((b) => [b.handle, b])) };
}

function resolveVariant(id, cat = loadCatalog()) {
  return KORA.parseVariant(id, cat.map, cat.bundleMap);
}

function describeVariant(v) {
  const grind = KORA.LABELS.grindShort[v.grind];
  if (v.kind === 'set') return { title: v.bundle.title, desc: `${v.bundle.items.length} × 250 г · ${grind}` };
  return { title: v.product.title, desc: `${v.weight === 1000 ? '1 кг' : v.weight + ' г'} · ${grind}` };
}

/* ======================================================================
   Сессии и пользователи
   ====================================================================== */
const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, phone: u.phone, address: u.address, role: u.role, createdAt: u.created_at };

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).kora_session;
  if (!token) return null;
  return db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(hashToken(token), Date.now()) || null;
}

function startSession(res, userId) {
  const token = newToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, Date.now() + SESSION_DAYS * 86_400_000);
  addCookie(res, cookie('kora_session', token, { maxAge: SESSION_DAYS * 86_400, secure: SECURE }));
}

function requireUser(req) {
  const u = currentUser(req);
  if (!u) fail(401, 'Нужно войти в аккаунт');
  return u;
}
function requireAdmin(req) {
  const u = requireUser(req);
  if (u.role !== 'admin') fail(403, 'Недостаточно прав');
  return u;
}

/* ======================================================================
   Корзина: у гостя — по cookie kora_cart, у пользователя — привязана к аккаунту
   ====================================================================== */
function findCart(req, user) {
  if (user) return db.prepare('SELECT * FROM carts WHERE user_id = ?').get(user.id) || null;
  const id = parseCookies(req.headers.cookie).kora_cart;
  return id ? db.prepare('SELECT * FROM carts WHERE id = ? AND user_id IS NULL').get(id) || null : null;
}

function ensureCart(req, res, user) {
  const existing = findCart(req, user);
  if (existing) return existing;
  const id = randomUUID();
  db.prepare('INSERT INTO carts (id, user_id) VALUES (?, ?)').run(id, user ? user.id : null);
  if (!user) addCookie(res, cookie('kora_cart', id, { maxAge: 90 * 86_400, secure: SECURE }));
  return { id };
}

function cartLines(cartId) {
  if (!cartId) return [];
  const cat = loadCatalog();
  const rows = db.prepare('SELECT variant_id, qty FROM cart_lines WHERE cart_id = ? ORDER BY position').all(cartId);
  const valid = rows.filter((r) => resolveVariant(r.variant_id, cat));
  if (valid.length !== rows.length) {
    // сорт сняли с продажи — тихо убираем строку
    const del = db.prepare('DELETE FROM cart_lines WHERE cart_id = ? AND variant_id = ?');
    tx(db, () => rows.filter((r) => !valid.includes(r)).forEach((r) => del.run(cartId, r.variant_id)));
  }
  return valid.map((r) => ({ variantId: r.variant_id, qty: r.qty }));
}

function setLine(cartId, variantId, qty) {
  if (qty <= 0) {
    db.prepare('DELETE FROM cart_lines WHERE cart_id = ? AND variant_id = ?').run(cartId, variantId);
    return;
  }
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM cart_lines WHERE cart_id = ?').get(cartId).p;
  db.prepare(`
    INSERT INTO cart_lines (cart_id, variant_id, qty, position) VALUES (?, ?, ?, ?)
    ON CONFLICT (cart_id, variant_id) DO UPDATE SET qty = excluded.qty`).run(cartId, variantId, Math.min(99, qty), pos);
  db.prepare("UPDATE carts SET updated_at = datetime('now') WHERE id = ?").run(cartId);
}

function applyCartOp(cartId, op) {
  const type = op.type;
  if (type === 'clear') {
    tx(db, () => {
      db.prepare('DELETE FROM cart_lines WHERE cart_id = ?').run(cartId);
      db.prepare("UPDATE carts SET updated_at = datetime('now') WHERE id = ?").run(cartId);
    });
    return;
  }
  const variantId = str(op.variantId, 120);
  if (!['add', 'set', 'remove'].includes(type)) fail(400, 'Неизвестная операция');
  if (type !== 'remove' && !resolveVariant(variantId)) fail(404, 'Такого товара нет в продаже');
  const qty = Number.isInteger(op.qty) ? op.qty : 1;
  if (type !== 'remove' && (qty < 0 || qty > 99)) fail(400, 'Некорректное количество');
  tx(db, () => {
    const current = db.prepare('SELECT qty FROM cart_lines WHERE cart_id = ? AND variant_id = ?').get(cartId, variantId);
    if (type === 'add') setLine(cartId, variantId, (current ? current.qty : 0) + Math.max(1, qty));
    else if (type === 'set') setLine(cartId, variantId, qty);
    else setLine(cartId, variantId, 0);
  });
}

// при входе гостевая корзина вливается в корзину аккаунта
function mergeGuestCart(req, res, user) {
  const guestId = parseCookies(req.headers.cookie).kora_cart;
  if (!guestId) return;
  const guest = db.prepare('SELECT id FROM carts WHERE id = ? AND user_id IS NULL').get(guestId);
  if (guest) {
    tx(db, () => {
      const lines = db.prepare('SELECT variant_id, qty FROM cart_lines WHERE cart_id = ? ORDER BY position').all(guest.id);
      if (lines.length) {
        const target = ensureCart(req, res, user);
        for (const l of lines) {
          const cur = db.prepare('SELECT qty FROM cart_lines WHERE cart_id = ? AND variant_id = ?').get(target.id, l.variant_id);
          setLine(target.id, l.variant_id, (cur ? cur.qty : 0) + l.qty);
        }
      }
      db.prepare('DELETE FROM carts WHERE id = ?').run(guest.id);
    });
  }
  addCookie(res, cookie('kora_cart', '', { maxAge: 0 }));
}

/* ======================================================================
   Валидация сорта (админка)
   ====================================================================== */
const L = KORA.LABELS;
function isImageUrl(s) {
  if (s.startsWith('/')) return !s.startsWith('//') && !/[\s"'<>\\]/.test(s);
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !/[\s"'<>]/.test(s);
  } catch {
    return false;
  }
}

function sanitizeProduct(input, existing) {
  const p = { ...(existing || {}) };
  const pick = (k, allowed) => {
    if (input[k] === undefined) return;
    if (!allowed.includes(input[k])) fail(400, `Поле ${k}: недопустимое значение`);
    p[k] = input[k];
  };
  if (!existing) {
    const handle = str(input.handle, 60);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(handle)) fail(400, 'Адрес (handle): латиница, цифры и дефисы');
    p.handle = handle;
    p.id = 'p-' + handle;
  }
  for (const k of ['title', 'country', 'region', 'lead']) {
    if (input[k] !== undefined) p[k] = str(input[k], 80);
  }
  if (!p.title) fail(400, 'Укажите название');
  if (!p.country) fail(400, 'Укажите страну');
  p.region = p.region || p.country;
  p.lead = p.lead || 'Сбалансированный';
  pick('method', Object.keys(L.method));
  pick('roast', Object.keys(L.roast));
  pick('process', Object.keys(L.process));
  pick('acidity', Object.keys(L.level));
  pick('density', Object.keys(L.level));
  pick('taste', Object.keys(L.taste));
  pick('tone', Object.keys(KORA.TONES));
  for (const k of ['method', 'roast', 'process', 'acidity', 'density', 'taste', 'tone']) {
    if (!p[k]) fail(400, `Заполните поле ${k}`);
  }
  if (input.price !== undefined) {
    if (input.price === null || input.price === '' || Number(input.price) === 0) fail(400, 'Укажите цену за 250 г');
    const price = Math.round(Number(input.price));
    if (!(price >= 100 && price <= 100_000)) fail(400, 'Цена за 250 г: от 100 до 100 000 ₽');
    p.price = price;
  }
  if (!p.price) fail(400, 'Укажите цену');
  // prices: null — 500 г и 1 кг считаются по формуле (авто), { 500, 1000 } — заданы вручную.
  // Незаполненный вес в ручном режиме не ошибка: для него остаётся авто-цена.
  if (input.prices !== undefined) {
    if (input.prices !== null && (typeof input.prices !== 'object' || Array.isArray(input.prices))) fail(400, 'prices: объект { 500, 1000 } или null');
    const prices = {};
    for (const w of [500, 1000]) {
      const raw = input.prices && input.prices[w];
      if (raw === undefined || raw === null || raw === '' || Number(raw) === 0) continue;
      const v = Math.round(Number(raw));
      if (!(v >= 100 && v <= 1_000_000)) fail(400, `Цена за ${w === 1000 ? '1 кг' : '500 г'}: от 100 до 1 000 000 ₽`);
      prices[w] = v;
    }
    if (Object.keys(prices).length) p.prices = prices;
    else delete p.prices;
  }
  if (input.sale !== undefined) {
    const sale = Number(input.sale);
    if (!(sale >= 0 && sale <= 0.7)) fail(400, 'Скидка: от 0 до 70%');
    p.sale = Math.round(sale * 100) / 100;
  }
  if (input.features !== undefined) {
    if (!Array.isArray(input.features)) fail(400, 'features: массив');
    p.features = [...new Set(input.features.filter((f) => Object.keys(L.feature).includes(f)))];
  }
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) fail(400, 'tags: массив');
    const allowed = Object.keys(L.tab).filter((t) => t !== 'all' && t !== 'fav');
    p.tags = [...new Set(input.tags.filter((t) => allowed.includes(t)))];
  }
  if (input.image !== undefined) {
    // ссылка на фото: внешний http(s) или путь на этом сайте; пустая строка — убрать фото
    const image = str(input.image, 500);
    if (image && !isImageUrl(image)) fail(400, 'Ссылка на фото: https://… или путь вида /img/pack.jpg');
    p.image = image;
  }
  if (input.notes !== undefined) {
    if (!Array.isArray(input.notes) || !input.notes.length || input.notes.length > 5) fail(400, 'Ноты: от 1 до 5');
    p.notes = input.notes.map((n) => {
      const [text, color] = Array.isArray(n) ? n : [n, ''];
      const t = str(text, 40).toLowerCase();
      if (!t) fail(400, 'Пустая нота');
      return [t, /^#[0-9a-f]{6}$/i.test(color) ? color : '#A99E8F'];
    });
  }
  if (!p.notes || !p.notes.length) fail(400, 'Добавьте хотя бы одну ноту');
  p.features = p.features || [];
  p.tags = p.tags || [];
  p.image = p.image || '';
  p.altitude = p.altitude || '[ВЫСОТА]';
  p.sale = p.sale || 0;
  p.rating = p.rating || 0;
  p.reviews = p.reviews || 0;
  return p;
}

function sanitizeBundle(input, existing) {
  const b = { ...(existing || {}) };
  if (!existing) {
    const handle = str(input.handle, 60);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(handle)) fail(400, 'Адрес набора (handle): латиница, цифры и дефисы');
    b.handle = handle;
  }
  if (input.title !== undefined) b.title = str(input.title, 80);
  if (!b.title) fail(400, 'Укажите название набора');
  if (input.tag !== undefined) b.tag = str(input.tag, 30);
  b.tag = b.tag || 'Набор';
  if (input.desc !== undefined) b.desc = str(input.desc, 300);
  b.desc = b.desc || '';
  if (input.discount !== undefined) {
    const d = Number(input.discount);
    if (!(d >= 0 && d <= 0.5)) fail(400, 'Скидка набора: от 0 до 50%');
    b.discount = Math.round(d * 100) / 100;
  }
  if (b.discount === undefined) fail(400, 'Укажите скидку набора');
  if (input.items !== undefined) {
    if (!Array.isArray(input.items)) fail(400, 'items: массив');
    const items = [...new Set(input.items.map((h) => str(h, 60)).filter(Boolean))];
    if (items.length < 2 || items.length > 6) fail(400, 'В наборе от 2 до 6 сортов');
    const exists = db.prepare('SELECT 1 FROM products WHERE handle = ?');
    for (const h of items) if (!exists.get(h)) fail(400, `Сорт ${h} не найден`);
    b.items = items;
  }
  if (!b.items || b.items.length < 2) fail(400, 'Выберите от 2 до 6 сортов');
  return b;
}

// порядок карточек: клиент присылает полный список handle в нужном порядке
const SORTABLE = new Set(['products', 'bundles']);
function reorder(table, handles) {
  if (!SORTABLE.has(table)) throw new Error('unknown table');
  if (!Array.isArray(handles)) fail(400, 'handles: массив');
  const all = db.prepare(`SELECT handle FROM ${table}`).all().map((r) => r.handle);
  const known = new Set(all);
  if (handles.length !== all.length || new Set(handles).size !== all.length || !handles.every((h) => known.has(h))) {
    fail(409, 'Список устарел — обновите страницу');
  }
  const upd = db.prepare(`UPDATE ${table} SET position = ? WHERE handle = ?`);
  tx(db, () => handles.forEach((h, i) => upd.run(i, h)));
  invalidateCatalog();
}

/* ======================================================================
   Заказы
   ====================================================================== */
const rowToOrder = (r) => ({
  id: r.id, number: 'K-' + String(r.id).padStart(5, '0'), status: r.status,
  items: JSON.parse(r.items), total: r.total, contact: JSON.parse(r.contact), createdAt: r.created_at,
  ...(r.email ? { email: r.email } : {}),
});

/* ======================================================================
   Роуты
   ====================================================================== */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/health$/, () => ({ ok: true, provider: 'kora-node' }));

route('GET', /^\/api\/catalog$/, () => {
  const { products, bundles } = loadCatalog();
  return { products, bundles };
});

route('GET', /^\/api\/products\/([a-z0-9-]+)$/, (req, res, [handle]) => {
  const row = db.prepare('SELECT * FROM products WHERE handle = ? AND active = 1').get(handle);
  if (!row) fail(404, 'Сорт не найден');
  return withReviews(rowToProduct(row));
});

/* --- отзывы --- */
const reviewRow = (r, user) => ({
  id: r.id, name: r.name, rating: r.rating, text: r.text, createdAt: r.created_at,
  mine: !!user && r.user_id === user.id,
});

route('GET', /^\/api\/products\/([a-z0-9-]+)\/reviews$/, (req, res, [handle]) => {
  if (!db.prepare('SELECT 1 FROM products WHERE handle = ? AND active = 1').get(handle)) fail(404, 'Сорт не найден');
  const user = currentUser(req);
  const rows = db.prepare(`
    SELECT r.*, u.name FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.handle = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 100`).all(handle);
  return { reviews: rows.map((r) => reviewRow(r, user)) };
});

route('POST', /^\/api\/products\/([a-z0-9-]+)\/reviews$/, async (req, res, [handle]) => {
  const user = requireUser(req);
  rateLimit(req, 'review', 30);
  const body = await readJson(req);
  if (!db.prepare('SELECT 1 FROM products WHERE handle = ? AND active = 1').get(handle)) fail(404, 'Сорт не найден');
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, 'Поставьте оценку от 1 до 5');
  const text = str(body.text, 2000);
  db.prepare(`
    INSERT INTO reviews (handle, user_id, rating, text) VALUES (?, ?, ?, ?)
    ON CONFLICT (handle, user_id) DO UPDATE SET rating = excluded.rating, text = excluded.text, created_at = datetime('now')`)
    .run(handle, user.id, rating, text);
  invalidateCatalog();
  const row = db.prepare('SELECT r.*, u.name FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.handle = ? AND r.user_id = ?').get(handle, user.id);
  return { review: reviewRow(row, user) };
});

// удалить может автор или администратор
route('DELETE', /^\/api\/reviews\/(\d+)$/, async (req, res, [id]) => {
  const user = requireUser(req);
  await readJson(req);
  const row = db.prepare('SELECT user_id FROM reviews WHERE id = ?').get(Number(id));
  if (!row) fail(404, 'Отзыв не найден');
  if (row.user_id !== user.id && user.role !== 'admin') fail(403, 'Недостаточно прав');
  db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(id));
  invalidateCatalog();
  return { ok: true };
});

/* --- аккаунт --- */
route('GET', /^\/api\/me$/, (req) => ({ user: publicUser(currentUser(req)) }));

route('POST', /^\/api\/auth\/register$/, async (req, res) => {
  rateLimit(req, 'auth');
  const body = await readJson(req);
  const email = str(body.email, 120).toLowerCase();
  const name = str(body.name, 80);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Проверьте email');
  if (password.length < 8) fail(400, 'Пароль — минимум 8 символов');
  if (!name) fail(400, 'Как к вам обращаться?');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) fail(409, 'Этот email уже зарегистрирован');
  const { lastInsertRowid } = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
    .run(email, name, hashPassword(password));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  startSession(res, user.id);
  mergeGuestCart(req, res, user);
  return { user: publicUser(user) };
});

route('POST', /^\/api\/auth\/login$/, async (req, res) => {
  rateLimit(req, 'auth');
  const body = await readJson(req);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(str(body.email, 120).toLowerCase());
  if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) fail(401, 'Неверный email или пароль');
  startSession(res, user.id);
  mergeGuestCart(req, res, user);
  return { user: publicUser(user) };
});

route('POST', /^\/api\/auth\/logout$/, async (req, res) => {
  await readJson(req);
  const token = parseCookies(req.headers.cookie).kora_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  addCookie(res, cookie('kora_session', '', { maxAge: 0 }));
  return { ok: true };
});

route('PATCH', /^\/api\/me$/, async (req) => {
  const user = requireUser(req);
  const body = await readJson(req);
  const next = {
    name: body.name !== undefined ? str(body.name, 80) : user.name,
    phone: body.phone !== undefined ? str(body.phone, 40) : user.phone,
    address: body.address !== undefined ? str(body.address, 300) : user.address,
  };
  if (!next.name) fail(400, 'Имя не может быть пустым');
  db.prepare('UPDATE users SET name = ?, phone = ?, address = ? WHERE id = ?').run(next.name, next.phone, next.address, user.id);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) };
});

route('POST', /^\/api\/me\/password$/, async (req, res) => {
  const user = requireUser(req);
  rateLimit(req, 'password', 10);
  const body = await readJson(req);
  if (!verifyPassword(String(body.current || ''), user.password_hash)) fail(400, 'Текущий пароль неверный');
  if (typeof body.next !== 'string' || body.next.length < 8) fail(400, 'Новый пароль — минимум 8 символов');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.next), user.id);
  // разлогиниваем остальные устройства, текущую сессию пересоздаём
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  startSession(res, user.id);
  return { ok: true };
});

/* --- избранное --- */
route('GET', /^\/api\/favorites$/, (req) => {
  const user = requireUser(req);
  return { handles: db.prepare('SELECT handle FROM favorites WHERE user_id = ?').all(user.id).map((r) => r.handle) };
});
route('PUT', /^\/api\/favorites\/([a-z0-9-]+)$/, async (req, res, [handle]) => {
  const user = requireUser(req);
  await readJson(req);
  if (!db.prepare('SELECT 1 FROM products WHERE handle = ?').get(handle)) fail(404, 'Сорт не найден');
  db.prepare('INSERT OR IGNORE INTO favorites (user_id, handle) VALUES (?, ?)').run(user.id, handle);
  return { ok: true };
});
route('DELETE', /^\/api\/favorites\/([a-z0-9-]+)$/, async (req, res, [handle]) => {
  const user = requireUser(req);
  await readJson(req);
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND handle = ?').run(user.id, handle);
  return { ok: true };
});

/* --- корзина --- */
route('GET', /^\/api\/cart$/, (req) => {
  const cart = findCart(req, currentUser(req));
  return { lines: cartLines(cart && cart.id) };
});
route('POST', /^\/api\/cart\/ops$/, async (req, res) => {
  const body = await readJson(req);
  const cart = ensureCart(req, res, currentUser(req));
  applyCartOp(cart.id, body);
  return { lines: cartLines(cart.id) };
});

/* --- заказы --- */
route('GET', /^\/api\/orders$/, (req) => {
  const user = requireUser(req);
  return { orders: db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(user.id).map(rowToOrder) };
});

route('POST', /^\/api\/orders$/, async (req) => {
  const user = requireUser(req);
  const body = await readJson(req);
  const contact = {
    name: str(body.name, 80), phone: str(body.phone, 40),
    address: str(body.address, 300), comment: str(body.comment, 500),
  };
  if (!contact.name) fail(400, 'Укажите имя получателя');
  if (!/^[+\d][\d\s()-]{5,}$/.test(contact.phone)) fail(400, 'Проверьте телефон');
  if (contact.address.length < 5) fail(400, 'Укажите адрес доставки');

  const cart = findCart(req, user);
  const cat = loadCatalog();
  const lines = cartLines(cart && cart.id);
  if (!lines.length) fail(400, 'Корзина пуста');

  // цены считаются на сервере, клиентским суммам не доверяем
  const items = lines.map((l) => {
    const v = resolveVariant(l.variantId, cat);
    return { variantId: l.variantId, ...describeVariant(v), qty: l.qty, unit: v.unit, sum: v.unit * l.qty };
  });
  const total = items.reduce((s, i) => s + i.sum, 0);

  return tx(db, () => {
    const { lastInsertRowid } = db.prepare('INSERT INTO orders (user_id, items, total, contact) VALUES (?, ?, ?, ?)')
      .run(user.id, JSON.stringify(items), total, JSON.stringify(contact));
    db.prepare('DELETE FROM cart_lines WHERE cart_id = ?').run(cart.id);
    if (!user.phone || !user.address) {
      db.prepare('UPDATE users SET phone = COALESCE(NULLIF(phone, \'\'), ?), address = COALESCE(NULLIF(address, \'\'), ?) WHERE id = ?')
        .run(contact.phone, contact.address, user.id);
    }
    return { order: rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(lastInsertRowid)) };
  });
});

/* --- админка --- */
route('GET', /^\/api\/admin\/products$/, (req) => {
  requireAdmin(req);
  return { products: loadCatalog({ includeInactive: true }).products };
});

route('POST', /^\/api\/admin\/products$/, async (req) => {
  requireAdmin(req);
  const p = sanitizeProduct(await readJson(req), null);
  if (db.prepare('SELECT 1 FROM products WHERE handle = ?').get(p.handle)) fail(409, 'Сорт с таким адресом уже есть');
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM products').get().p;
  db.prepare('INSERT INTO products (handle, data, position) VALUES (?, ?, ?)').run(p.handle, JSON.stringify(p), pos);
  invalidateCatalog();
  return { product: { ...p, active: true } };
});

route('PUT', /^\/api\/admin\/products\/([a-z0-9-]+)$/, async (req, res, [handle]) => {
  requireAdmin(req);
  const row = db.prepare('SELECT * FROM products WHERE handle = ?').get(handle);
  if (!row) fail(404, 'Сорт не найден');
  const body = await readJson(req);
  const { active: _drop, ...existing } = rowToProduct(row);
  const p = sanitizeProduct(body, existing);
  const active = body.active === undefined ? row.active : body.active ? 1 : 0;
  db.prepare("UPDATE products SET data = ?, active = ?, updated_at = datetime('now') WHERE handle = ?")
    .run(JSON.stringify(p), active, handle);
  invalidateCatalog();
  return { product: { ...p, active: !!active } };
});

// удаление сорта: старые заказы хранят снимок позиций и не ломаются
route('DELETE', /^\/api\/admin\/products\/([a-z0-9-]+)$/, async (req, res, [handle]) => {
  requireAdmin(req);
  await readJson(req);
  const row = db.prepare('SELECT data FROM products WHERE handle = ?').get(handle);
  if (!row) fail(404, 'Сорт не найден');
  const inBundles = db.prepare('SELECT data FROM bundles').all().map((r) => JSON.parse(r.data)).filter((b) => b.items.includes(handle));
  if (inBundles.length) {
    fail(409, `Сорт входит в наборы: ${inBundles.map((b) => `«${b.title}»`).join(', ')}. Сначала уберите его из наборов.`);
  }
  tx(db, () => {
    db.prepare('DELETE FROM favorites WHERE handle = ?').run(handle);
    db.prepare('DELETE FROM reviews WHERE handle = ?').run(handle);
    db.prepare('DELETE FROM cart_lines WHERE variant_id LIKE ?').run(handle + '|%');
    db.prepare('DELETE FROM products WHERE handle = ?').run(handle);
  });
  invalidateCatalog();
  return { ok: true };
});

route('PUT', /^\/api\/admin\/products-order$/, async (req) => {
  requireAdmin(req);
  reorder('products', (await readJson(req)).handles);
  return { ok: true };
});

/* --- админка: наборы --- */
route('GET', /^\/api\/admin\/bundles$/, (req) => {
  requireAdmin(req);
  const { map } = loadCatalog();
  const bundles = db.prepare('SELECT * FROM bundles ORDER BY position, handle').all().map((r) => {
    const b = JSON.parse(r.data);
    return { ...b, active: !!r.active, price: KORA.bundlePrice(b, map) }; // price null — какой-то сорт не в продаже
  });
  return { bundles };
});

route('POST', /^\/api\/admin\/bundles$/, async (req) => {
  requireAdmin(req);
  const b = sanitizeBundle(await readJson(req), null);
  if (db.prepare('SELECT 1 FROM bundles WHERE handle = ?').get(b.handle)) fail(409, 'Набор с таким адресом уже есть');
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM bundles').get().p;
  db.prepare('INSERT INTO bundles (handle, data, position) VALUES (?, ?, ?)').run(b.handle, JSON.stringify(b), pos);
  invalidateCatalog();
  return { bundle: { ...b, active: true } };
});

route('PUT', /^\/api\/admin\/bundles\/([a-z0-9-]+)$/, async (req, res, [handle]) => {
  requireAdmin(req);
  const row = db.prepare('SELECT * FROM bundles WHERE handle = ?').get(handle);
  if (!row) fail(404, 'Набор не найден');
  const body = await readJson(req);
  const b = sanitizeBundle(body, JSON.parse(row.data));
  const active = body.active === undefined ? row.active : body.active ? 1 : 0;
  db.prepare('UPDATE bundles SET data = ?, active = ? WHERE handle = ?').run(JSON.stringify(b), active, handle);
  invalidateCatalog();
  return { bundle: { ...b, active: !!active } };
});

route('DELETE', /^\/api\/admin\/bundles\/([a-z0-9-]+)$/, async (req, res, [handle]) => {
  requireAdmin(req);
  await readJson(req);
  if (!db.prepare('SELECT 1 FROM bundles WHERE handle = ?').get(handle)) fail(404, 'Набор не найден');
  tx(db, () => {
    db.prepare('DELETE FROM cart_lines WHERE variant_id LIKE ?').run(`set:${handle}|%`);
    db.prepare('DELETE FROM bundles WHERE handle = ?').run(handle);
  });
  invalidateCatalog();
  return { ok: true };
});

route('PUT', /^\/api\/admin\/bundles-order$/, async (req) => {
  requireAdmin(req);
  reorder('bundles', (await readJson(req)).handles);
  return { ok: true };
});

route('GET', /^\/api\/admin\/orders$/, (req) => {
  requireAdmin(req);
  const rows = db.prepare('SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 200').all();
  return { orders: rows.map(rowToOrder) };
});

route('PATCH', /^\/api\/admin\/orders\/(\d+)$/, async (req, res, [id]) => {
  requireAdmin(req);
  const body = await readJson(req);
  if (!ORDER_STATUSES.includes(body.status)) fail(400, 'Неизвестный статус');
  const r = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(body.status, Number(id));
  if (!r.changes) fail(404, 'Заказ не найден');
  return { ok: true };
});

/* ======================================================================
   Статика
   ====================================================================== */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(SITE, rel));
  // с разделителем: иначе /..%2fsite-video/ проходит проверку как «начинается с site»
  if (!file.startsWith(SITE + sep)) { res.writeHead(403).end(); return; }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Не найдено');
  }
}

/* ======================================================================
   Сервер
   ====================================================================== */
const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      await serveStatic(req, res, pathname);
      return;
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.pattern);
      if (!m) continue;
      const result = await r.handler(req, res, m.slice(1));
      send(res, 200, result);
      return;
    }
    fail(404, 'Метод API не найден');
  } catch (e) {
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else {
      console.error(e);
      send(res, 500, { error: 'Внутренняя ошибка сервера' });
    }
  }
});

// протухшие сессии и старые гостевые корзины чистим при старте и раз в час
cleanup(db);
setInterval(() => cleanup(db), 3_600_000).unref();

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`\n[server] Порт ${PORT} уже занят — скорее всего, KORA уже запущена в другом окне.`);
  console.error('  Остановите её там (Ctrl+C) или найдите процесс: netstat -ano | findstr :' + PORT + '  →  taskkill /PID <номер> /F');
  console.error(`  Либо запустите на другом порту: $env:PORT=${PORT + 1}; npm start\n`);
  try { closeDb(db); } catch { /* база уже закрыта */ }
  process.exit(1);
});
server.listen(PORT, () => console.log(`KORA: http://localhost:${PORT}`));

// Ctrl+C / остановка: дописываем WAL в kora.db, чтобы файл базы можно было просто скопировать
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close();
  server.closeAllConnections();
  try { closeDb(db); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
