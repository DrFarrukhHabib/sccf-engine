import { fetchListings, type Listing } from "../market/cmc";
import { sheetWriter } from "./sheets";
import { fastLane } from "../waves";

const now = () => new Date().toISOString();
const SIGNED = "s.role IN ('approved', 'standing')";

/** Assets whose next review falls within 30 days; each is queued once per review date. */
export async function dueReReviews(db: D1Database) {
  const { results } = await db
    .prepare("SELECT id, name, ticker, class, next_review FROM assets WHERE next_review IS NOT NULL AND next_review <= date('now', '+30 days') ORDER BY next_review, id")
    .all<{ id: string; name: string; ticker: string; class: string; next_review: string }>();
  if (results.length)
    await db.batch(results.map((a) =>
      db.prepare("INSERT OR IGNORE INTO requests (id, type, asset_id, text, at) VALUES (?, 're-review', ?, ?, ?)")
        .bind(`re-review-${a.id}-${a.next_review}`, a.id, `Re-review due ${a.next_review}`, now())));
  return results;
}

/** Records the nightly ranking. Returns the symbols now in the fast lane (top 100 for 7 nights running, outside the newest wave, not yet reviewed). */
export async function recordSnapshot(db: D1Database, listings: Listing[], at = now()): Promise<string[]> {
  for (let i = 0; i < listings.length; i += 50)
    await db.batch(listings.slice(i, i + 50).map((l) =>
      db.prepare("INSERT INTO market_snapshots (taken_at, cmc_id, symbol, name, rank) VALUES (?, ?, ?, ?, ?)").bind(at, String(l.id), l.symbol, l.name, l.cmc_rank)));
  return (await fastLane(db)).map((t) => t.symbol);
}

/** Writes the current approved ruling of every asset through `write`. Returns the row count. */
export async function syncRegister(db: D1Database, write: (rows: unknown[][]) => Promise<void>): Promise<number> {
  const { results } = await db.prepare(
    `SELECT a.id, a.name, a.ticker, r.status, r.code, p.usage_line, substr(s.at, 1, 10) AS approved
     FROM rulings r JOIN signatures s ON s.ruling_id = r.id AND ${SIGNED}
     JOIN assets a ON a.id = r.asset_id LEFT JOIN public_fields p ON p.ruling_id = r.id
     WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = r.id AND e.type = 'Return')
       AND s.at = (SELECT MAX(s2.at) FROM rulings r2 JOIN signatures s2 ON s2.ruling_id = r2.id AND s2.role IN ('approved','standing') WHERE r2.asset_id = a.id)
     ORDER BY a.id`,
  ).all<Record<string, unknown>>();
  const rows = results.map((r) => [r.id, r.name, r.ticker, r.status, r.code, r.usage_line ?? "", r.approved]);
  await write(rows);
  return rows.length;
}

export interface Dump { version: "1"; exportedAt: string; tables: Record<string, Record<string, unknown>[]> }

async function tableNames(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name",
  ).all<{ name: string }>();
  return results.map((r) => r.name);
}

/** Every engine table, every row. */
export async function exportAll(db: D1Database): Promise<Dump> {
  const tables: Dump["tables"] = {};
  for (const t of await tableNames(db)) tables[t] = (await db.prepare(`SELECT * FROM "${t}"`).all<Record<string, unknown>>()).results;
  return { version: "1", exportedAt: now(), tables };
}

/** Loads a dump into a database that has the schema but no rows. Foreign keys are checked at commit. */
export async function restoreExport(db: D1Database, dump: Dump): Promise<void> {
  const names = await tableNames(db);
  for (const t of names) {
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).first<{ n: number }>();
    if (n!.n > 0) throw new Error(`Target database is not empty (${t})`);
  }
  const stmts: D1PreparedStatement[] = [db.prepare("PRAGMA defer_foreign_keys = on")];
  for (const [t, rows] of Object.entries(dump.tables)) {
    if (!names.includes(t)) throw new Error(`Unknown table ${t} in the export`);
    for (const row of rows) {
      const cols = Object.keys(row);
      stmts.push(db.prepare(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .bind(...cols.map((c) => row[c] as string | number | null)));
    }
  }
  await db.batch(stmts);
}

export interface JobEnv {
  DB: D1Database; BACKUPS?: R2Bucket; CMC_API_KEY?: string;
  GOOGLE_SA_JSON?: string; REGISTER_SHEET_ID?: string; REGISTER_TAB?: string;
}
export interface JobDeps { listings?: () => Promise<Listing[]>; writeRegister?: (rows: unknown[][]) => Promise<void> }

/** The daily cron. Each step runs on its own; a failure is reported and the backup still runs. */
export async function runDaily(env: JobEnv, deps: JobDeps = {}) {
  const report = { due: 0, fastLane: 0, registerRows: 0, backupKey: "", errors: [] as string[] };
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { report.errors.push(`${name}: ${(e as Error).message}`); }
  };
  await step("re-reviews", async () => { report.due = (await dueReReviews(env.DB)).length; });
  const listings = deps.listings ?? (env.CMC_API_KEY ? () => fetchListings(env.CMC_API_KEY!, 500) : undefined);
  if (listings) await step("listings", async () => { report.fastLane = (await recordSnapshot(env.DB, await listings())).length; });
  const write = deps.writeRegister ??
    (env.GOOGLE_SA_JSON && env.REGISTER_SHEET_ID ? sheetWriter(env.GOOGLE_SA_JSON, env.REGISTER_SHEET_ID, env.REGISTER_TAB ?? "Engine sync") : undefined);
  if (write) await step("register", async () => { report.registerRows = await syncRegister(env.DB, write); });
  if (!env.BACKUPS) {
    report.errors.push("backup: no BACKUPS bucket is bound");
    return report;
  }
  const dump = await exportAll(env.DB);
  report.backupKey = `exports/${dump.exportedAt.slice(0, 10)}/${dump.exportedAt}.json`;
  await env.BACKUPS.put(report.backupKey, JSON.stringify(dump), { httpMetadata: { contentType: "application/json" } });
  return report;
}
