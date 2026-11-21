import { q } from "../catalog/sql";
import { BY_CLASS, D1, D2_D5, HARAM, strip } from "../public/activity";
import { assertPublicSafe } from "../public/guard";

/** One `tokens/<id>` document of the Review Desk database. */
export interface DeskToken {
  assetId: string; name: string; ticker: string; cls: string; status: string; code: string;
  coingeckoId?: string; confidence?: string; stage: string; approvedBy?: string; approvalDate?: string;
  prepared?: string; nextReview?: string; earlierStatus?: string; reviewType?: string; inQueue?: boolean;
  cardUrl?: string; usageLine?: string; pubWhat?: string; pubWhy?: string; pubHow?: string; pubKnow?: string;
}
/** Review Desk tokens plus the Review History sheet (first row = header). */
export interface DeskExport { tokens: DeskToken[]; history: string[][] }
export interface Statement { sql: string; params: (string | number | null)[] }

/** Review Desk class names → catalog section keys. Unknown names stop the migration. */
const CLASS: Record<string, string> = {
  "Native coin": "NATIVE", "Native coin (evolved meme)": "NATIVE", "Native coin (perps chain)": "NATIVE", "Native coin (meme chain)": "NATIVE",
  "Exchange token": "EXCH", "Governance (DEX)": "EXCH", "Governance": "EXCH",
  "Utility": "UTIL", "Utility (evolved meme)": "MEME", "Utility (gaming)": "GAME", "Utility / NFT": "NFT",
  "Fiat-backed stablecoin": "FIAT", "Crypto-collateralized stablecoin": "CRYPTO", "Crypto-backed token": "LST",
  "Gold token": "GOLD", "Wrapped token": "WRAP", "Real-world-asset platform": "RWA", "Not mal (pure hype)": "MEME",
  // Names used in the Asset Register after the 19 November 2026 reclassifications.
  "Launchpad": "LAUNCH", "Liquid staking token": "LST", "Exchange token (DEX)": "EXCH",
};

/** Check Catalog v1.0 validation, approved 19 November 2026. */
/** fromCls/fromCode: the ruling the Scholar approved before the reclassification (the register may already show the new one). */
const RECLASS: Record<string, { cls: string; code?: string; fromCls?: string; fromCode?: string; note: string }> = {
  "SCCF-0012": { cls: "LAUNCH", code: "H2", fromCls: "EXCH", fromCode: "H1", note: "BIO reclassed as a launchpad token; H1 to H2 (Check Catalog v1.0, 19 November 2026)" },
  "SCCF-0098": { cls: "EXCH", note: "RUNE reclassed as an exchange/DEX token; H2 kept (Check Catalog v1.0, 19 November 2026)" },
  "SCCF-0049": { cls: "LST", note: "JitoSOL relabelled as a liquid staking token (Check Catalog v1.0, 19 November 2026)" },
  "SCCF-0090": { cls: "LST", note: "sfrxETH relabelled as a liquid staking token (Check Catalog v1.0, 19 November 2026)" },
};
const RECLASS_AT = "2026-11-19T00:00:00Z";
const SCHOLAR = "Dr. Farrukh Habib";
const ts = (d: string) => (d.length === 10 ? `${d}T00:00:00Z` : d);
const STANDING = /^Confirmed under standing approval/;

function card(status: string, code: string, cls: string, usageLine: string) {
  const matrix = status === "Haram" ? HARAM : status === "Doubtful" ? (code === "D1" ? D1 : D2_D5) : BY_CLASS[cls];
  assertPublicSafe(usageLine);
  return JSON.stringify({
    statusLabel: code === "R7" ? "Haram: not an asset" : status, usageLine, tiles: [], activity: matrix ? strip(matrix) : null,
  });
}

export function deskToStatements(input: DeskExport) {
  const st: Statement[] = [];
  const add = (sql: string, ...params: Statement["params"]) => st.push({ sql, params });
  // Signatures and events get fixed ids so that running the same export twice adds nothing.
  let sigId = 0, eventId = 0;
  const ids = new Set(input.tokens.map((t) => t.assetId));
  const [, ...rows] = input.history;
  const missing = rows.filter((r) => !ids.has(r[0])).map((r) => r[0]);
  if (missing.length) throw new Error(`History rows for assets not in the export: ${[...new Set(missing)].join(", ")}`);

  const standing = new Set(rows.filter((r) => r[4] === "Approval" && STANDING.test(r[10] ?? "")).map((r) => r[0]));
  const report = { assets: 0, rulings: 0, approved: 0, drafts: 0, historyRows: rows.length };

  for (const t of input.tokens) {
    const original = CLASS[t.cls];
    if (!original) throw new Error(`Unknown Review Desk class "${t.cls}" on ${t.assetId}`);
    const re = RECLASS[t.assetId];
    const cls = re?.cls ?? original;
    const reviewed = t.stage !== "Not reviewed";
    add(`INSERT OR IGNORE INTO assets (id, coingecko_id, name, ticker, class, earlier_status, next_review, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      t.assetId, t.coingeckoId || null, t.name, t.ticker, cls, t.earlierStatus || null, reviewed ? t.nextReview || null : null, RECLASS_AT);
    report.assets++;
    if (!reviewed) continue;

    const approved = t.stage === "Scholar approved" && !!t.approvalDate;
    const id = `MIG-${t.assetId}`;
    const created = ts(t.prepared || t.approvalDate || RECLASS_AT.slice(0, 10));
    const firstCls = re?.fromCls ?? (re?.code ? original : cls);
    const firstCode = re?.fromCode ?? t.code;
    const ruling = (rid: string, c: string, code: string, createdAt: string, supersedes: string | null, usage: string) => {
      add(`INSERT OR IGNORE INTO rulings (id, asset_id, criteria_version, status, code, class, confidence, review_type, checks_structured, send_to_scholar,
             card_url, prepared_at, next_review, supersedes, created_at) VALUES (?, ?, '1.0', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        rid, t.assetId, t.status, code, c, t.confidence || null, t.reviewType === "Re-review" ? "Re-review" : "First",
        approved ? 0 : 1, t.cardUrl || null, createdAt, t.nextReview || null, supersedes, createdAt);
      add(`INSERT OR IGNORE INTO public_fields (ruling_id, what, why, how, know, usage_line, card_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        rid, t.pubWhat || null, t.pubWhy || null, t.pubHow || null, t.pubKnow || null, usage, card(t.status, code, c, usage));
      report.rulings++;
    };
    ruling(id, firstCls, firstCode, created, null, t.usageLine ?? "");
    if (approved) {
      add(`INSERT OR IGNORE INTO signatures (id, ruling_id, role, by_whom, at, note) VALUES (?, ?, ?, ?, ?, 'Migrated from the Review Desk')`,
        ++sigId, id, standing.has(t.assetId) ? "standing" : "approved", t.approvedBy || SCHOLAR, ts(t.approvalDate!));
      report.approved++;
    } else report.drafts++;

    if (re?.code && approved) {
      const rid = `${id}-R2`;
      ruling(rid, cls, re.code, RECLASS_AT, id, BY_CLASS[cls].condition);
      add(`INSERT OR IGNORE INTO signatures (id, ruling_id, role, by_whom, at, note) VALUES (?, ?, 'approved', ?, ?, ?)`, ++sigId, rid, SCHOLAR, RECLASS_AT, re.note);
    }
    add(`INSERT OR IGNORE INTO events (id, asset_id, ruling_id, type, at, detail) VALUES (?, ?, ?, 'Migration', ?, ?)`,
      ++eventId, t.assetId, id, RECLASS_AT, re ? `Migrated from the Review Desk. ${re.note}` : "Migrated from the Review Desk");
  }

  for (const r of rows) {
    const [assetId, name, ticker, at, type, status, code, confidence, stage, changed, reason, reportLink] = r;
    add(`INSERT OR IGNORE INTO events (id, asset_id, ruling_id, type, at, detail) VALUES (?, ?, NULL, ?, ?, ?)`, ++eventId, assetId, type, at,
      JSON.stringify({ name, ticker, status, code, confidence, stage, changed, reason, reportLink }));
  }
  return { statements: st, report };
}

/** The statements as one SQL file for `wrangler d1 execute --file`. */
export function statementsToSql(statements: Statement[]): string {
  return statements.map((s) => {
    let i = 0;
    return s.sql.replace(/\?/g, () => q(s.params[i++])).replace(/\s+/g, " ") + ";";
  }).join("\n") + "\n";
}
