import { backfillCount } from "./backfill";
import { waveProgress } from "./waves";

/** The week's work in numbers: drafts, approvals, refusals, questions, wave and backfill progress, recent drafts. */
export async function weeklyReport(db: D1Database, daysParam?: string) {
  const days = Math.min(31, Math.max(1, Math.floor(Number(daysParam) || 7)));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const count = async (sql: string) => (await db.prepare(sql).bind(since).first<{ n: number }>())?.n ?? 0;
  const SIGNED = "EXISTS (SELECT 1 FROM signatures s WHERE s.ruling_id = e.ruling_id AND s.role IN ('approved','standing'))";
  const refusals = (await db.prepare("SELECT asset_id AS assetId, at, detail FROM events WHERE type = 'Refused' AND at >= ? ORDER BY at DESC LIMIT 20")
    .bind(since).all()).results;
  const recentDrafts = (await db.prepare(
    `SELECT r.id AS rulingId, r.asset_id AS assetId, a.name, r.status, r.code, r.confidence, r.created_at AS createdAt,
       CASE WHEN EXISTS (SELECT 1 FROM signatures s WHERE s.ruling_id = r.id AND s.role = 'approved') THEN 'approved'
            WHEN EXISTS (SELECT 1 FROM signatures s WHERE s.ruling_id = r.id AND s.role = 'standing') THEN 'standing'
            WHEN EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = r.id AND e.type = 'Return') THEN 'returned'
            WHEN EXISTS (SELECT 1 FROM rulings n WHERE n.supersedes = r.id) THEN 'replaced' ELSE 'waiting' END AS state,
       (SELECT COUNT(DISTINCT k.source_url) FROM ruling_checks k WHERE k.ruling_id = r.id AND k.source_url LIKE 'https://%') AS webSources,
       p.what, p.why, p.how
     FROM rulings r JOIN assets a ON a.id = r.asset_id LEFT JOIN public_fields p ON p.ruling_id = r.id
     WHERE r.created_at >= ? ORDER BY r.created_at DESC LIMIT 25`,
  ).bind(since).all()).results;
  return {
    days, since, until: new Date().toISOString(),
    drafts: await count("SELECT COUNT(*) AS n FROM rulings WHERE created_at >= ?"),
    approved: await count("SELECT COUNT(*) AS n FROM signatures WHERE role = 'approved' AND at >= ?"),
    standing: await count("SELECT COUNT(*) AS n FROM signatures WHERE role = 'standing' AND at >= ?"),
    returned: await count(`SELECT COUNT(*) AS n FROM events e WHERE e.type = 'Return' AND e.at >= ? AND NOT ${SIGNED}`),
    withdrawn: await count(`SELECT COUNT(*) AS n FROM events e WHERE e.type = 'Return' AND e.at >= ? AND ${SIGNED}`),
    refused: await count("SELECT COUNT(*) AS n FROM events WHERE type = 'Refused' AND at >= ?"),
    questionsAsked: await count("SELECT COUNT(*) AS n FROM questions WHERE created_at >= ?"),
    questionsAnswered: await count("SELECT COUNT(*) AS n FROM questions WHERE answered_at >= ?"),
    openQuestions: (await db.prepare("SELECT COUNT(*) AS n FROM questions WHERE answer IS NULL").first<{ n: number }>())?.n ?? 0,
    wave: await waveProgress(db),
    backfillRemaining: await backfillCount(db),
    refusals, recentDrafts,
  };
}
