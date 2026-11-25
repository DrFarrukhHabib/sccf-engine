import { Hono } from "hono";
import { hashKey } from "../auth/keys";
import { footerFor, type PublicCard } from "../public/build";
import type { Bindings } from "../index";

const POWERED_BY = "Najm Screener";
const DISCLAIMER = "Preliminary: prepared with AI and not yet reviewed by a Shariah Scholar; it may contain errors.";
const STATUSES = ["Halal", "Doubtful", "Haram", "Check the company"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOMENT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z)?$/;
/** Requests one client may make per day (UTC). A daily sync needs a handful. */
export const DAILY_LIMIT = 1000;
const RECORD_VERSION = "1";

const SIGNED = `
  SELECT r.id, r.asset_id, r.status, r.prepared_at, r.created_at, s.at AS signed_at,
         ROW_NUMBER() OVER (PARTITION BY r.asset_id ORDER BY s.at DESC) AS rn
  FROM rulings r JOIN signatures s ON s.ruling_id = r.id AND s.role IN ('approved', 'standing')
  WHERE s.at <= ?1
    AND NOT EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = r.id AND e.type = 'Return')`;
const DRAFTS = `
  SELECT r.id, r.asset_id, r.status, r.prepared_at, r.created_at, NULL AS signed_at,
         ROW_NUMBER() OVER (PARTITION BY r.asset_id ORDER BY r.created_at DESC) AS rn
  FROM rulings r
  WHERE NOT EXISTS (SELECT 1 FROM signatures s WHERE s.ruling_id = r.id AND s.role IN ('approved', 'standing'))
    AND NOT EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = r.id AND e.type = 'Return')`;
const COLS = `x.id, x.asset_id, x.status, x.prepared_at, x.created_at, x.signed_at, a.name, a.ticker, a.class, a.coingecko_id, a.next_review,
  p.card_json, p.what, p.why, p.how, p.know`;

interface Row {
  id: string; asset_id: string; status: string; prepared_at: string | null; created_at: string; signed_at: string | null;
  name: string; ticker: string; class: string; coingecko_id: string | null; next_review: string | null; card_json: string | null;
  what: string | null; why: string | null; how: string | null; know: string | null;
}
type Networks = Map<string, { network: string; address: string }[]>;

/** The standard ruling record, version 1: the only shape that leaves the engine. No codes, checks, trust rating or market data. */
function present(r: Row, networks: Networks) {
  const card = (r.card_json ? JSON.parse(r.card_json) : {}) as Partial<PublicCard>;
  const approvedAt = r.signed_at ? r.signed_at.slice(0, 10) : null;
  const lastReviewed = (r.prepared_at ?? r.created_at).slice(0, 10);
  return {
    recordVersion: RECORD_VERSION, rulingId: r.id,
    assetId: r.asset_id, name: r.name, ticker: r.ticker, coingeckoId: r.coingecko_id, networks: networks.get(r.asset_id) ?? [], class: r.class,
    status: card.statusLabel ?? r.status, usageLine: card.usageLine ?? null,
    summary: { whatItIs: r.what, why: r.why, howToUse: r.how, thingsToKnow: r.know },
    tiles: card.tiles ?? [], activity: card.activity ?? null,
    approvedAt, lastReviewed, nextReview: approvedAt ? r.next_review : null, updatedAt: r.signed_at ?? r.created_at,
    preliminary: !approvedAt, ...(approvedAt ? {} : { disclaimer: DISCLAIMER }),
    footer: footerFor(approvedAt, lastReviewed), criteria: "SCCF 1.0",
  };
}
type Item = ReturnType<typeof present> & { lastApproved?: { status: string; approvedAt: string | null } };

async function currentRulings(db: D1Database, opts: { asOf?: string; preliminary: boolean; assetId?: string }): Promise<Item[]> {
  const asOf = opts.asOf ? `${opts.asOf}T23:59:59.999Z` : "9999-12-31";
  const where = opts.assetId ? "AND x.asset_id = ?2" : "";
  const run = async (sql: string) => {
    const stmt = db.prepare(`SELECT ${COLS} FROM (${sql}) x JOIN assets a ON a.id = x.asset_id LEFT JOIN public_fields p ON p.ruling_id = x.id
      WHERE x.rn = 1 ${where} ORDER BY x.asset_id`);
    return (await (opts.assetId ? stmt.bind(asOf, opts.assetId) : stmt.bind(asOf)).all<Row>()).results;
  };
  const nets: Networks = new Map();
  const addr = db.prepare(`SELECT asset_id, network, address FROM network_addresses ${opts.assetId ? "WHERE asset_id = ?" : ""} ORDER BY network, address`);
  for (const n of (await (opts.assetId ? addr.bind(opts.assetId) : addr).all<{ asset_id: string; network: string; address: string }>()).results)
    nets.set(n.asset_id, [...(nets.get(n.asset_id) ?? []), { network: n.network, address: n.address }]);
  const signed = new Map((await run(SIGNED)).map((r) => [r.asset_id, r]));
  const items = new Map<string, Item>([...signed].map(([k, r]) => [k, present(r, nets)]));
  if (opts.preliminary && !opts.asOf) {
    const drafts = await db.prepare(`SELECT ${COLS} FROM (${DRAFTS}) x JOIN assets a ON a.id = x.asset_id LEFT JOIN public_fields p ON p.ruling_id = x.id
      WHERE x.rn = 1 ${opts.assetId ? "AND x.asset_id = ?1" : ""} ORDER BY x.asset_id`);
    for (const d of (await (opts.assetId ? drafts.bind(opts.assetId) : drafts).all<Row>()).results) {
      const s = signed.get(d.asset_id);
      if (s && s.created_at >= d.created_at) continue;
      const item: Item = present(d, nets);
      if (s) item.lastApproved = { status: present(s, nets).status, approvedAt: present(s, nets).approvedAt };
      items.set(d.asset_id, item);
    }
  }
  return [...items.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export const api = new Hono<{ Bindings: Bindings; Variables: { preliminary: boolean; clientId: string } }>();

api.use("*", async (c, next) => {
  const key = c.req.header("X-API-Key");
  const db = c.env.DB;
  const client = key && (await db.prepare("SELECT id, preliminary FROM api_clients WHERE key_hash = ? AND revoked_at IS NULL")
    .bind(await hashKey(key)).first<{ id: string; preliminary: number }>());
  if (!client) return c.json({ error: "A valid X-API-Key header is required", poweredBy: POWERED_BY }, 401);
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const used = await db.prepare("SELECT requests FROM api_usage WHERE client_id = ? AND day = ?").bind(client.id, day).first<{ requests: number }>();
  if ((used?.requests ?? 0) >= DAILY_LIMIT)
    return c.json({ error: `This key has reached its daily limit of ${DAILY_LIMIT} requests; try again after 00:00 UTC`, poweredBy: POWERED_BY }, 429);
  await db.batch([
    db.prepare("INSERT INTO api_usage (client_id, day, requests) VALUES (?, ?, 1) ON CONFLICT (client_id, day) DO UPDATE SET requests = requests + 1").bind(client.id, day),
    db.prepare("UPDATE api_clients SET last_used_at = ? WHERE id = ?").bind(now, client.id),
  ]);
  c.set("preliminary", client.preliminary === 1);
  c.set("clientId", client.id);
  await next();
});

api.get("/rulings", async (c) => {
  const status = c.req.query("status");
  const cls = c.req.query("class");
  if (status && !STATUSES.includes(status)) return c.json({ error: `status must be one of ${STATUSES.join(", ")}`, poweredBy: POWERED_BY }, 400);
  let rulings = await currentRulings(c.env.DB, { preliminary: c.get("preliminary") });
  if (status) rulings = rulings.filter((r) => (r.status === "Haram: not an asset" ? "Haram" : r.status) === status);
  if (cls) rulings = rulings.filter((r) => r.class === cls);
  return c.json({ poweredBy: POWERED_BY, count: rulings.length, rulings });
});

api.get("/assets/:id", async (c) => {
  const [ruling] = await currentRulings(c.env.DB, { preliminary: c.get("preliminary"), assetId: c.req.param("id") });
  if (!ruling) return c.json({ error: "No published ruling for this asset", poweredBy: POWERED_BY }, 404);
  return c.json({ poweredBy: POWERED_BY, ruling });
});

api.get("/assets/:id/on/:date", async (c) => {
  const date = c.req.param("date");
  if (!DATE.test(date)) return c.json({ error: "date must be YYYY-MM-DD", poweredBy: POWERED_BY }, 400);
  const [ruling] = await currentRulings(c.env.DB, { preliminary: false, assetId: c.req.param("id"), asOf: date });
  if (!ruling) return c.json({ error: "No ruling was live on that date", poweredBy: POWERED_BY }, 404);
  return c.json({ poweredBy: POWERED_BY, on: date, ruling });
});

/** Finds a token by CoinGecko id, CoinMarketCap id, ticker, or network and contract address. */
api.get("/lookup", async (c) => {
  const db = c.env.DB;
  const q = (k: string) => c.req.query(k)?.trim() || undefined;
  const [coingeckoId, cmcId, ticker, network, address] = ["coingeckoId", "cmcId", "ticker", "network", "address"].map(q);
  let ids: string[];
  if (network || address) {
    if (!network || !address) return c.json({ error: "Give both network and address", poweredBy: POWERED_BY }, 400);
    ids = (await db.prepare("SELECT DISTINCT asset_id AS id FROM network_addresses WHERE LOWER(network) = LOWER(?) AND LOWER(address) = LOWER(?)")
      .bind(network, address).all<{ id: string }>()).results.map((r) => r.id);
  } else if (coingeckoId || cmcId || ticker) {
    const [col, val] = coingeckoId ? ["coingecko_id", coingeckoId] : cmcId ? ["cmc_id", cmcId] : ["ticker", ticker!];
    ids = (await db.prepare(`SELECT id FROM assets WHERE LOWER(${col}) = LOWER(?) ORDER BY id`).bind(val).all<{ id: string }>()).results.map((r) => r.id);
  } else {
    return c.json({ error: "Give one of coingeckoId, cmcId, ticker, or network and address", poweredBy: POWERED_BY }, 400);
  }
  const rulings: Item[] = [];
  for (const id of ids) rulings.push(...(await currentRulings(db, { preliminary: c.get("preliminary"), assetId: id })));
  return c.json({ poweredBy: POWERED_BY, count: rulings.length, rulings });
});

/**
 * What changed since a moment: each token whose published ruling was approved or withdrawn after `since`,
 * with the record now in force (null when none). Keep `until` and send it as `since` next time.
 */
api.get("/changes", async (c) => {
  const db = c.env.DB;
  const raw = c.req.query("since");
  if (!raw || !MOMENT.test(raw)) return c.json({ error: "since must be YYYY-MM-DD or a UTC timestamp like 2026-12-01T00:00:00Z", poweredBy: POWERED_BY }, 400);
  const since = DATE.test(raw) ? `${raw}T00:00:00Z` : raw;
  const { results } = await db.prepare(
    `SELECT r.asset_id, s.at, 'approved' AS change FROM signatures s JOIN rulings r ON r.id = s.ruling_id
       WHERE s.role IN ('approved','standing') AND s.at > ?1
     UNION ALL
     SELECT e.asset_id, e.at, 'withdrawn' AS change FROM events e
       WHERE e.type = 'Return' AND e.at > ?1
         AND EXISTS (SELECT 1 FROM signatures s WHERE s.ruling_id = e.ruling_id AND s.role IN ('approved','standing'))
     ORDER BY 2`,
  ).bind(since).all<{ asset_id: string; at: string; change: "approved" | "withdrawn" }>();
  // The bookmark: now, or the newest change returned if that is later, so nothing is skipped or repeated.
  const now = new Date().toISOString();
  const newest = results.length ? results[results.length - 1].at : "";
  const until = newest > now ? newest : now;
  const latest = new Map<string, { at: string; change: "approved" | "withdrawn" }>();
  for (const r of results) latest.set(r.asset_id, { at: r.at, change: r.change });
  const changes = [];
  for (const [assetId, ev] of [...latest].sort((a, b) => a[1].at.localeCompare(b[1].at))) {
    const [ruling] = await currentRulings(db, { preliminary: false, assetId });
    changes.push({ assetId, change: ev.change, changedAt: ev.at, ruling: ruling ?? null });
  }
  return c.json({ poweredBy: POWERED_BY, since, until, count: changes.length, changes });
});

async function exportData(db: D1Database) {
  const rulings = await currentRulings(db, { preliminary: false });
  return { rulings, fingerprint: await sha256(JSON.stringify(rulings)), generatedAt: new Date().toISOString() };
}

api.get("/export.json", async (c) => {
  const { rulings, fingerprint, generatedAt } = await exportData(c.env.DB);
  return c.json({ poweredBy: POWERED_BY, version: "1", generatedAt, count: rulings.length, fingerprint, rulings });
});

api.get("/export.csv", async (c) => {
  const { rulings, fingerprint, generatedAt } = await exportData(c.env.DB);
  const lines = [
    "asset_id,name,ticker,status,usage_line,approved_at,last_reviewed,powered_by",
    ...rulings.map((r) => [r.assetId, r.name, r.ticker, r.status, r.usageLine, r.approvedAt, r.lastReviewed, POWERED_BY].map(csvCell).join(",")),
  ];
  return c.body(lines.join("\n") + "\n", 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "X-Powered-By": POWERED_BY, "X-SCCF-Version": "1", "X-SCCF-Date": generatedAt, "X-SCCF-Fingerprint": fingerprint,
  });
});
