-- Схема D1. Воркер выполняет эти же команды сам при первом запросе (CREATE IF NOT EXISTS),
-- файл нужен как справка и для ручного запуска:
--   npx wrangler d1 execute site-builder --remote --file=schema.sql

-- Настройки сайта (ключ 'config': глубина вложенности, матрица совместимости, языки LTR/RTL)
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- Страницы. type: 'page' | 'modal' (модальные окна появятся в фазе 2)
-- doc — JSON-дерево блоков (см. README)
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'page',
  doc TEXT NOT NULL,
  updated INTEGER NOT NULL,
  published_at INTEGER
);

-- История версий (автоматически раз в несколько минут, хранится последние 30)
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL,
  doc TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_page ON versions(page_id, id);

-- Готовый HTML опубликованных страниц (воркер только читает и отдаёт)
CREATE TABLE IF NOT EXISTS published (
  slug TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  updated INTEGER NOT NULL,
  meta TEXT            -- описание форм страницы (для проверки заявок на сервере)
);
-- База из фазы 1: ALTER TABLE published ADD COLUMN meta TEXT;  (воркер делает это сам)

-- Фаза 2: заявки с публичных форм. IP хранится только в виде хеша.
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL, form TEXT NOT NULL, lang TEXT,
  data TEXT NOT NULL, ip_hash TEXT NOT NULL, created INTEGER NOT NULL,
  mail TEXT            -- статус письма: 'ok' или 'err: …' (база фазы 2: ALTER TABLE submissions ADD COLUMN mail TEXT)
);
CREATE INDEX IF NOT EXISTS idx_sub_ip ON submissions(ip_hash, created);

-- Библиотека медиа: загруженные файлы (сами файлы лежат в R2 под именем key)
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,        -- имя объекта в R2 (адрес /media/<key>)
  name TEXT NOT NULL,              -- видимое имя, уникальное без учёта регистра
  name_lc TEXT NOT NULL UNIQUE,
  orig TEXT NOT NULL,              -- имя файла так, как его загрузили
  mime TEXT NOT NULL, size INTEGER NOT NULL, w INTEGER, h INTEGER, dur REAL,
  tags TEXT NOT NULL DEFAULT '[]', -- JSON: ["товар","обувь"]
  tip TEXT NOT NULL DEFAULT '{}',  -- JSON: {"ru":"…","en":"…"} подсказка при наведении
  created INTEGER NOT NULL
);
-- Где используется файл (обновляется при каждом сохранении страницы)
CREATE TABLE IF NOT EXISTS media_use (page_id INTEGER NOT NULL, key TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_mu_key ON media_use(key);

-- Фаза 3 (витрина): products_schema, products — добавим позже
