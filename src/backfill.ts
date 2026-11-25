import { MATCHES, RANKS } from "./waves";

/**
 * Backfill: tokens whose published ruling was approved before the standard record (25 Nov 2026) and so lacks
 * the full summary (what / why / how) or the token's contract addresses. The analyst re-reviews them so every
 * client record is complete. A token with a redraft already waiting on the desk is left out.
 */
const CANDIDATES = `
  cur AS (
    SELECT r.id, r.asset_id, ROW_NUMBER() OVER (PARTITION BY r.asset_id ORDER BY s.at DESC) AS rn
    FROM rulings r JOIN signatures s ON s.ruling_id = r.id AND s.role IN ('approved', 'standing')
    WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = r.id AND e.type = 'Return')),
  gaps AS (
    SELECT a.id, a.name, a.ticker, a.class, a.cmc_id, c.id AS ruling_id,
      (COALESCE(TRIM(p.what), '') = '' OR COALESCE(TRIM(p.why), '') = '' OR COALESCE(TRIM(p.how), '') = '') AS no_summary,
      NOT EXISTS (SELECT 1 FROM network_addresses n WHERE n.asset_id = a.id) AS no_networks
    FROM cur c JOIN assets a ON a.id = c.asset_id LEFT JOIN public_fields p ON p.ruling_id = c.id
    WHERE c.rn = 1
      AND NOT EXISTS (
        SELECT 1 FROM rulings d WHERE d.asset_id = a.id
          AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.ruling_id = d.id AND s.role IN ('approved', 'standing'))
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = d.id AND e.type = 'Return')
          AND NOT EXISTS (SELECT 1 FROM rulings n WHERE n.supersedes = d.id)))`;

export interface BackfillItem { id: string; name: string; ticker: string; class: string; rulingId: string; missing: ("summary" | "networks")[] }

/** Highest market cap first (the frozen wave's ranks), unranked tokens last. */
export async function backfillList(db: D1Database, limit: number): Promise<BackfillItem[]> {
  const { results } = await db.prepare(
    `WITH ${RANKS}, ${CANDIDATES}
     SELECT g.id, g.name, g.ticker, g.class, g.ruling_id, g.no_summary, g.no_networks,
       (SELECT MIN(k.rank) FROM ranks k WHERE ${MATCHES("k", "g")}) AS market_rank
     FROM gaps g WHERE g.no_summary OR g.no_networks
     ORDER BY market_rank IS NULL, market_rank, g.id LIMIT ?`,
  ).bind(limit).all<{ id: string; name: string; ticker: string; class: string; ruling_id: string; no_summary: number; no_networks: number }>();
  return results.map((r) => ({
    id: r.id, name: r.name, ticker: r.ticker, class: r.class, rulingId: r.ruling_id,
    missing: [...(r.no_summary ? ["summary" as const] : []), ...(r.no_networks ? ["networks" as const] : [])],
  }));
}

export async function backfillCount(db: D1Database): Promise<number> {
  const row = await db.prepare(`WITH ${CANDIDATES} SELECT COUNT(*) AS n FROM gaps WHERE no_summary OR no_networks`).first<{ n: number }>();
  return row?.n ?? 0;
}
