-- Waves: a frozen list of tokens by market cap, worked through in order (Scholar's decision, 24 Nov 2026).
CREATE TABLE waves (
  id INTEGER PRIMARY KEY,
  frozen_at TEXT NOT NULL,
  size INTEGER NOT NULL,
  snapshot_at TEXT NOT NULL
);

CREATE TABLE wave_items (
  wave INTEGER NOT NULL REFERENCES waves(id),
  rank INTEGER NOT NULL,
  cmc_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (wave, cmc_id)
);

-- Wave 1 = the top 500 of the newest CoinMarketCap ranking already recorded. A fresh database has none, so nothing is added there.
INSERT INTO waves (id, frozen_at, size, snapshot_at)
  SELECT 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 500, MAX(taken_at) FROM market_snapshots HAVING MAX(taken_at) IS NOT NULL;
INSERT INTO wave_items (wave, rank, cmc_id, symbol, name)
  SELECT 1, rank, cmc_id, symbol, name FROM market_snapshots
  WHERE taken_at = (SELECT snapshot_at FROM waves WHERE id = 1) AND rank <= 500;

-- The nightly "new listing" requests are replaced by the wave and the fast lane.
UPDATE requests SET status = 'done', result = 'Superseded by Wave 1 (frozen top 500) on 24 Nov 2026'
  WHERE type = 'new-listing' AND status = 'open';
