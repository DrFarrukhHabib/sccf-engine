/** Waves: a frozen market-cap list worked through in order, plus a fast lane for big newcomers (decision of 24 Nov 2026). */

export const FAST_LANE_RANK = 100;

/** The ranking the queue follows: the newest wave's frozen list, or the newest snapshot when no wave exists yet. */
export const RANKS = `ranks AS (
  SELECT cmc_id, symbol, name, rank FROM wave_items WHERE wave = (SELECT MAX(id) FROM waves)
  UNION ALL
  SELECT cmc_id, symbol, name, rank FROM market_snapshots
  WHERE NOT EXISTS (SELECT 1 FROM waves) AND taken_at = (SELECT MAX(taken_at) FROM market_snapshots)
)`;

/** A listed token matches a registered asset by CoinMarketCap id, or by ticker when the asset has no id. */
export const MATCHES = (listed: string, asset: string) =>
  `(${asset}.cmc_id = ${listed}.cmc_id OR (${asset}.cmc_id IS NULL AND UPPER(${asset}.ticker) = UPPER(${listed}.symbol)))`;

const HAS_RULING = (asset: string) => `EXISTS (SELECT 1 FROM rulings r WHERE r.asset_id = ${asset}.id)`;
const APPROVED = (asset: string) =>
  `EXISTS (SELECT 1 FROM rulings r JOIN signatures s ON s.ruling_id = r.id AND s.role IN ('approved','standing')
     WHERE r.asset_id = ${asset}.id AND NOT EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = r.id AND e.type = 'Return'))`;

/** Tokens now in the top 100 that are outside the newest wave and not yet reviewed. Empty when no wave exists. */
export async function fastLane(db: D1Database, limit = 15) {
  const { results } = await db.prepare(
    `SELECT m.cmc_id, m.symbol, m.name, m.rank,
       (SELECT a.id FROM assets a WHERE ${MATCHES("m", "a")} ORDER BY a.id LIMIT 1) AS assetId
     FROM market_snapshots m
     WHERE m.taken_at = (SELECT MAX(taken_at) FROM market_snapshots) AND m.rank <= ?
       AND EXISTS (SELECT 1 FROM waves)
       AND m.cmc_id NOT IN (SELECT cmc_id FROM wave_items WHERE wave = (SELECT MAX(id) FROM waves))
       AND NOT EXISTS (SELECT 1 FROM assets a WHERE ${MATCHES("m", "a")} AND ${HAS_RULING("a")})
     ORDER BY m.rank LIMIT ?`,
  ).bind(FAST_LANE_RANK, limit).all<{ cmc_id: string; symbol: string; name: string; rank: number; assetId: string | null }>();
  return results;
}

export interface WaveProgress { id: number; size: number; snapshotAt: string; approved: number; drafted: number; toGo: number }

/** How far the newest wave has got: approved, drafted but not approved, and not yet reviewed. */
export async function waveProgress(db: D1Database): Promise<WaveProgress | null> {
  const wave = await db.prepare("SELECT id, size, snapshot_at FROM waves ORDER BY id DESC LIMIT 1")
    .first<{ id: number; size: number; snapshot_at: string }>();
  if (!wave) return null;
  const row = await db.prepare(
    `SELECT
       SUM(CASE WHEN EXISTS (SELECT 1 FROM assets a WHERE ${MATCHES("w", "a")} AND ${APPROVED("a")}) THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM assets a WHERE ${MATCHES("w", "a")} AND ${APPROVED("a")})
                 AND EXISTS (SELECT 1 FROM assets a WHERE ${MATCHES("w", "a")} AND ${HAS_RULING("a")}) THEN 1 ELSE 0 END) AS drafted,
       COUNT(*) AS total
     FROM wave_items w WHERE w.wave = ?`,
  ).bind(wave.id).first<{ approved: number | null; drafted: number | null; total: number }>();
  const approved = row?.approved ?? 0, drafted = row?.drafted ?? 0, total = row?.total ?? 0;
  return { id: wave.id, size: total, snapshotAt: wave.snapshot_at, approved, drafted, toGo: total - approved - drafted };
}

/** Freezes the next wave: the top `size` tokens of the newest recorded ranking. */
export async function freezeWave(db: D1Database, size: number): Promise<number> {
  const latest = await db.prepare("SELECT MAX(taken_at) AS at FROM market_snapshots").first<{ at: string | null }>();
  if (!latest?.at) throw new Error("No market ranking has been recorded yet");
  const next = ((await db.prepare("SELECT MAX(id) AS n FROM waves").first<{ n: number | null }>())?.n ?? 0) + 1;
  await db.batch([
    db.prepare("INSERT INTO waves (id, frozen_at, size, snapshot_at) VALUES (?, ?, ?, ?)").bind(next, new Date().toISOString(), size, latest.at),
    db.prepare("INSERT OR IGNORE INTO wave_items (wave, rank, cmc_id, symbol, name) SELECT ?, rank, cmc_id, symbol, name FROM market_snapshots WHERE taken_at = ? AND rank <= ?")
      .bind(next, latest.at, size),
  ]);
  return next;
}
