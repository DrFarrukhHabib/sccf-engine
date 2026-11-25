-- Client API v1 (25 Nov 2026): per-client usage tracking and a daily limit; one row per token address.
ALTER TABLE api_clients ADD COLUMN last_used_at TEXT;

CREATE TABLE api_usage (
  client_id TEXT NOT NULL REFERENCES api_clients(id),
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, day)
);

CREATE UNIQUE INDEX network_addresses_unique ON network_addresses (asset_id, network, address);
