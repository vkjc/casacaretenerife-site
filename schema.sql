CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  lang TEXT,
  town TEXT,
  tier TEXT,
  obj_type TEXT,
  vacancy TEXT,
  services TEXT,
  email TEXT,
  phone TEXT,
  telegram TEXT,
  name TEXT,
  ua TEXT,
  ip_hash TEXT,
  ab_variant TEXT,
  social_provider TEXT,
  oauth_provider TEXT,
  oauth_id TEXT,
  oauth_email TEXT,
  oauth_name TEXT,
  form_data TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_ab_variant ON leads(ab_variant);
CREATE INDEX IF NOT EXISTS idx_leads_social_provider ON leads(social_provider);

CREATE TABLE IF NOT EXISTS ab_variants (
  variant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  traffic_percent INTEGER NOT NULL DEFAULT 0,
  form_module TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO ab_variants (variant_id, name, is_active, traffic_percent, form_module) VALUES
  ('variant-a', 'Форма А — классическая воронка (карта → тип → услуги → контакты)', 1, 50, 'js/forms/variant-a.js'),
  ('variant-b', 'Форма Б — регистрация через соцсети (OAuth/WhatsApp/Telegram/Viber)', 1, 50, 'js/forms/variant-b.js');