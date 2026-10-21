// SQLite-хранилище KORA: схема, сид каталога из site/js/data.js и админ по умолчанию.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { hashPassword, verifyPassword } from './auth.js';
import * as SEED from './seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// data.js — браузерный скрипт (window.KORA). Исполняем его в песочнице,
// чтобы сервер и фронт делили одни и те же справочники и формулы цен.
// Сам каталог в data.js пустой: он живёт только в базе.
export function loadShared() {
  const code = readFileSync(join(ROOT, 'site/js/data.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { filename: 'data.js' });
  return sandbox.window.KORA;
}

export const KORA = loadShared();

export function openDb(file = process.env.DB_FILE || join(ROOT, 'data/kora.db')) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    -- без busy_timeout любая чужая блокировка (sqlite3 CLI, скрипт, второй сервер) сразу даёт «database is locked» → 500
    PRAGMA busy_timeout = 5000;
    -- в режиме WAL NORMAL безопасен и не делает fsync на каждый коммит
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name          TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      address       TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'customer',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      handle   TEXT PRIMARY KEY,
      data     TEXT NOT NULL,
      active   INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bundles (
      handle   TEXT PRIMARY KEY,
      data     TEXT NOT NULL,
      active   INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS carts (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cart_lines (
      cart_id    TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
      variant_id TEXT NOT NULL,
      qty        INTEGER NOT NULL CHECK (qty > 0),
      position   INTEGER NOT NULL,
      PRIMARY KEY (cart_id, variant_id)
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      handle  TEXT NOT NULL,
      PRIMARY KEY (user_id, handle)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status     TEXT NOT NULL DEFAULT 'new',
      items      TEXT NOT NULL,
      total      INTEGER NOT NULL,
      contact    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- один отзыв на сорт от пользователя; повторная отправка его обновляет
    CREATE TABLE IF NOT EXISTS reviews (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      handle     TEXT NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      text       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (handle, user_id)
    );

    CREATE INDEX IF NOT EXISTS reviews_user_id ON reviews(user_id);
    CREATE INDEX IF NOT EXISTS orders_user_id ON orders(user_id);
    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS carts_guest_updated ON carts(updated_at) WHERE user_id IS NULL;

    -- CHECK в существующую таблицу не добавить, поэтому статус стерегут триггеры
    CREATE TRIGGER IF NOT EXISTS orders_status_insert BEFORE INSERT ON orders
      WHEN NEW.status NOT IN ('new', 'roasting', 'shipped', 'done', 'cancelled')
      BEGIN SELECT RAISE(ABORT, 'invalid order status'); END;
    CREATE TRIGGER IF NOT EXISTS orders_status_update BEFORE UPDATE OF status ON orders
      WHEN NEW.status NOT IN ('new', 'roasting', 'shipped', 'done', 'cancelled')
      BEGIN SELECT RAISE(ABORT, 'invalid order status'); END;
  `);
  seed(db);
  return db;
}

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (count === 0) {
    const ins = db.prepare('INSERT INTO products (handle, data, position) VALUES (?, ?, ?)');
    tx(db, () => SEED.PRODUCTS.forEach((p, i) => ins.run(p.handle, JSON.stringify(p), i)));
    console.log(`[db] каталог: добавлено ${SEED.PRODUCTS.length} сортов из server/seed.js`);
  }
  const bcount = db.prepare('SELECT COUNT(*) AS n FROM bundles').get().n;
  if (bcount === 0) {
    const ins = db.prepare('INSERT INTO bundles (handle, data, position) VALUES (?, ?, ?)');
    tx(db, () => SEED.BUNDLES.forEach((b, i) => ins.run(b.handle, JSON.stringify(b), i)));
    console.log(`[db] наборы: добавлено ${SEED.BUNDLES.length} из server/seed.js`);
  }

  const email = process.env.ADMIN_EMAIL || 'admin@kora.local';
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!exists) {
    const password = process.env.ADMIN_PASSWORD || 'kora-admin';
    db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Администратор', ?, 'admin')")
      .run(email, hashPassword(password));
    console.log(`[db] создан администратор ${email}${process.env.ADMIN_PASSWORD ? '' : ' / kora-admin (смените пароль!)'}`);
  }

  // напоминаем при каждом старте, пока у какого-то админа стоит пароль из README
  for (const a of db.prepare("SELECT email, password_hash FROM users WHERE role = 'admin'").all()) {
    if (verifyPassword('kora-admin', a.password_hash)) {
      console.warn(`[db] ВНИМАНИЕ: у администратора ${a.email} пароль по умолчанию — смените его в личном кабинете`);
    }
  }
}

// Транзакция с захватом записи сразу (IMMEDIATE): отложенная транзакция «чтение → запись»
// в WAL получает SQLITE_BUSY без ожидания busy_timeout. Вложенные вызовы выполняются в внешней.
const inTx = new WeakSet();
export function tx(db, fn) {
  if (inTx.has(db)) return fn();
  db.exec('BEGIN IMMEDIATE');
  inTx.add(db);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    inTx.delete(db);
  }
}

// протухшие сессии и брошенные гостевые корзины (cookie kora_cart живёт 90 дней)
export function cleanup(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare("DELETE FROM carts WHERE user_id IS NULL AND updated_at < datetime('now', '-90 days')").run();
}

// переносим WAL в основной файл и закрываем базу: после этого kora.db самодостаточен
export function closeDb(db) {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}
