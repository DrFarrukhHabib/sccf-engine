import { Hono } from "hono";
import { hashKey } from "../auth/keys";
import { footerFor, type PublicCard } from "../public/build";
import type { Bindings } from "../index";

const POWERED_BY = "Azka Advisors";
const DISCLAIMER = "Preliminary: prepared with AI and not yet reviewed by a Shariah Scholar; it may contain errors.";
const STATUSES = ["Halal", "Doubtful", "Haram", "Check the company"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
const COLS = `x.id, x.asset_id, x.status, x.prepared_at, x.created_at, x.signed_at, a.name, a.ticker, a.class, a.coingecko_id, p.card_json`;

interface Row {
  id: string; asset_id: string; status: string; prepared_at: string | null; created_at: string; signed_at: string | null;
  name: string; ticker: string; class: string; coingecko_id: string | null; card_json: string | null;
}

/** The only shape that leaves the engine. No codes, checks, trust rating or market data. */
function present(r: Row) {
  const card = (r.card_json ? JSON.parse(r.card_json) : {}) as Partial<PublicCard>;
  const approvedAt = r.signed_at ? r.signed_at.slice(0, 10) : null;
  const lastReviewed = (r.prepared_at ?? r.created_at).slice(0, 10);
  return {
    assetId: r.asset_id, name: r.name, ticker: r.ticker, coingeckoId: r.coingecko_id, class: r.class,
    status: card.statusLabel ?? r.status, usageLine: card.usageLine ?? null, tiles: card.tiles ?? [], activity: card.activity ?? null,
    approvedAt, lastReviewed, preliminary: !approvedAt, ...(approvedAt ? {} : { disclaimer: DISCLAIMER }),
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
  const signed = new Map((await run(SIGNED)).map((r) => [r.asset_id, r]));
  const items = new Map<string, Item>([...signed].map(([k, r]) => [k, present(r)]));
  if (opts.preliminary && !opts.asOf) {
    const drafts = await db.prepare(`SELECT ${COLS} FROM (${DRAFTS}) x JOIN assets a ON a.id = x.asset_id LEFT JOIN public_fields p ON p.ruling_id = x.id
      WHERE x.rn = 1 ${opts.assetId ? "AND x.asset_id = ?1" : ""} ORDER BY x.asset_id`);
    for (const d of (await (opts.assetId ? drafts.bind(opts.assetId) : drafts).all<Row>()).results) {
      const s = signed.get(d.asset_id);
      if (s && s.created_at >= d.created_at) continue;
      const item: Item = present(d);
      if (s) item.lastApproved = { status: present(s).status, approvedAt: present(s).approvedAt };
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

export const api = new Hono<{ Bindings: Bindings; Variables: { preliminary: boolean } }>();

api.use("*", async (c, next) => {
  const key = c.req.header("X-API-Key");
  const client = key && (await c.env.DB.prepare("SELECT preliminary FROM api_clients WHERE key_hash = ? AND revoked_at IS NULL")
    .bind(await hashKey(key)).first<{ preliminary: number }>());
  if (!client) return c.json({ error: "A valid X-API-Key header is required", poweredBy: POWERED_BY }, 401);
  c.set("preliminary", client.preliminary === 1);
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

api.get("/changes", async (c) => {
  const since = c.req.query("since");
  if (!since || !DATE.test(since)) return c.json({ error: "since must be YYYY-MM-DD", poweredBy: POWERED_BY }, 400);
  const changes = (await currentRulings(c.env.DB, { preliminary: false }))
    .filter((r) => r.approvedAt && r.approvedAt >= since)
    .map(({ assetId, name, ticker, status, approvedAt }) => ({ assetId, name, ticker, status, approvedAt }));
  return c.json({ poweredBy: POWERED_BY, since, changes });
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
