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
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);