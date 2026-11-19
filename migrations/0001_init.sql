-- SCCF engine schema v1. Rulings, signatures and events are append-only.
PRAGMA foreign_keys = ON;

CREATE TABLE criteria_versions (
  version TEXT PRIMARY KEY,
  approved_at TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,                 -- SCCF-####
  cmc_id TEXT,
  coingecko_id TEXT,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  class TEXT NOT NULL,                 -- catalog section key, e.g. FIAT, NATIVE
  issuer TEXT,
  earlier_status TEXT,
  next_review TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE network_addresses (
  id INTEGER PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  checked_at TEXT
);

CREATE TABLE catalog_checks (
  id TEXT NOT NULL,
  version TEXT NOT NULL REFERENCES criteria_versions(version),
  position INTEGER NOT NULL,
  section TEXT NOT NULL,
  type TEXT NOT NULL,
  question TEXT NOT NULL,
  if_yes TEXT,
  if_not_found TEXT,
  evidence TEXT,
  re_review INTEGER NOT NULL DEFAULT 0,
  tile TEXT,
  public_line TEXT,
  standing_decision TEXT,
  sources TEXT,
  judgment INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, version)
);

CREATE TABLE rulings (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  criteria_version TEXT NOT NULL REFERENCES criteria_versions(version),
  status TEXT NOT NULL CHECK (status IN ('Halal', 'Doubtful', 'Haram', 'Check the company')),
  code TEXT NOT NULL CHECK (code IN ('H1','H2','D1','D2','D3','D4','D5','R1','R2','R3','R4','R5','R7','S1')),
  plain_name TEXT,
  class TEXT,
  confidence TEXT CHECK (confidence IS NULL OR confidence IN ('High', 'Medium', 'Low')),
  review_type TEXT CHECK (review_type IS NULL OR review_type IN ('First', 'Re-review')),
  deciding_check TEXT,
  checks_structured INTEGER NOT NULL DEFAULT 1,
  send_to_scholar INTEGER NOT NULL DEFAULT 0,
  card_url TEXT,
  prepared_at TEXT,
  next_review TEXT,
  supersedes TEXT REFERENCES rulings(id),
  created_at TEXT NOT NULL
);
CREATE INDEX rulings_asset ON rulings(asset_id, created_at);

CREATE TABLE ruling_checks (
  ruling_id TEXT NOT NULL REFERENCES rulings(id),
  check_id TEXT NOT NULL,
  answer TEXT NOT NULL CHECK (answer IN ('yes', 'no', 'not_found')),
  evidence TEXT,
  source_url TEXT,
  accessed_at TEXT,
  PRIMARY KEY (ruling_id, check_id)
);

CREATE TABLE public_fields (
  ruling_id TEXT PRIMARY KEY REFERENCES rulings(id),
  what TEXT, why TEXT, how TEXT, know TEXT,
  usage_line TEXT,
  card_json TEXT
);

CREATE TABLE trust_ratings (
  ruling_id TEXT PRIMARY KEY REFERENCES rulings(id),
  points_json TEXT NOT NULL,
  stars INTEGER CHECK (stars IS NULL OR stars BETWEEN 1 AND 5)
);

CREATE TABLE signatures (
  id INTEGER PRIMARY KEY,
  ruling_id TEXT NOT NULL REFERENCES rulings(id),
  role TEXT NOT NULL CHECK (role IN ('prepared', 'approved', 'co-signed', 'standing')),
  by_whom TEXT NOT NULL,
  at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX signatures_ruling ON signatures(ruling_id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  ruling_id TEXT REFERENCES rulings(id),
  type TEXT NOT NULL,                  -- First, Re-review, Approval, Return, Trigger, Rule change, Migration
  at TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX events_asset ON events(asset_id, at);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES assets(id),
  ruling_id TEXT REFERENCES rulings(id),
  question TEXT NOT NULL,
  context TEXT,
  options_json TEXT,
  answer TEXT,
  answered_at TEXT,
  applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  asset_id TEXT,
  text TEXT,
  at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  result TEXT
);

CREATE TABLE rule_proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  where_text TEXT,
  current TEXT,
  proposed TEXT,
  reason TEXT,
  affects TEXT,
  decision TEXT CHECK (decision IS NULL OR decision IN ('approved', 'rejected')),
  note TEXT,
  applied INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE api_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  preliminary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE market_snapshots (
  id INTEGER PRIMARY KEY,
  taken_at TEXT NOT NULL,
  cmc_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL
);

CREATE TRIGGER rulings_no_update BEFORE UPDATE ON rulings BEGIN SELECT RAISE(ABORT, 'rulings are append-only'); END;
CREATE TRIGGER rulings_no_delete BEFORE DELETE ON rulings BEGIN SELECT RAISE(ABORT, 'rulings are append-only'); END;
CREATE TRIGGER signatures_no_update BEFORE UPDATE ON signatures BEGIN SELECT RAISE(ABORT, 'signatures are append-only'); END;
CREATE TRIGGER signatures_no_delete BEFORE DELETE ON signatures BEGIN SELECT RAISE(ABORT, 'signatures are append-only'); END;
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
