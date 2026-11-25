-- Indexes so the desk and the analyst's queue look rows up instead of scanning whole tables
-- (25 Nov 2026: the free plan's 5 million daily row reads were exceeded).
CREATE INDEX IF NOT EXISTS events_ruling_type ON events (ruling_id, type);
CREATE INDEX IF NOT EXISTS signatures_ruling_role ON signatures (ruling_id, role);
CREATE INDEX IF NOT EXISTS rulings_supersedes ON rulings (supersedes);
CREATE INDEX IF NOT EXISTS assets_cmc ON assets (cmc_id);
CREATE INDEX IF NOT EXISTS assets_ticker_upper ON assets (UPPER(ticker));
CREATE INDEX IF NOT EXISTS wave_items_rank ON wave_items (wave, rank);
CREATE INDEX IF NOT EXISTS market_snapshots_taken_rank ON market_snapshots (taken_at, rank);
CREATE INDEX IF NOT EXISTS market_snapshots_cmc_taken ON market_snapshots (cmc_id, taken_at);
CREATE INDEX IF NOT EXISTS questions_asset ON questions (asset_id);
CREATE INDEX IF NOT EXISTS questions_ruling ON questions (ruling_id);
