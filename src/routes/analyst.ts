import { Hono } from "hono";
import { loadCatalog } from "../catalog/load";
import type { Answer, Code, Status } from "../db/types";
import { fetchListings, type Listing } from "../market/cmc";
import { buildPublic } from "../public/build";
import { assertPublicSafe } from "../public/guard";
import { deriveOutcome } from "../rules/derive";
import type { Bindings } from "../index";

/** Playbook "Next batch" class order. Classes not listed come last. */
const CLASS_ORDER = ["NATIVE", "EXCH", "UTIL", "FIAT", "CRYPTO", "MEME"];
const BATCH = 15;
/** Analysts may log these; approvals and returns come only from the review desk. */
const ANALYST_EVENTS = ["First", "Re-review", "Trigger", "Migration", "Note"];

async function sameKey(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const [p, q] = [new Uint8Array(x), new Uint8Array(y)];
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}

const fail = (msg: string) => ({ error: msg });

export const analyst = new Hono<{ Bindings: Bindings }>();

analyst.use("*", async (c, next) => {
  const given = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (!c.env.ANALYST_KEY || !(await sameKey(given, c.env.ANALYST_KEY))) return c.json(fail("Unauthorized"), 401);
  await next();
});

/** The live check questions, so the analyst answers exactly what the engine derives from. `?section=ZERO,FIAT` narrows it. */
analyst.get("/catalog", async (c) => {
  const catalog = await loadCatalog(c.env.DB, "1.0");
  const wanted = c.req.query("section")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const sections: Record<string, { id: string; type: string; question: string; ifYes: string | null; ifNotFound: string | null; judgment: boolean }[]> = {};
  for (const [key, checks] of Object.entries(catalog.sections)) {
    if (wanted && !wanted.includes(key)) continue;
    sections[key] = checks.map(({ id, type, question, ifYes, ifNotFound, judgment }) => ({ id, type, question, ifYes, ifNotFound, judgment }));
  }
  return c.json({ version: catalog.version, sections });
});

analyst.get("/queue", async (c) => {
  const db = c.env.DB;
  const order = `CASE class ${CLASS_ORDER.map((k, i) => `WHEN '${k}' THEN ${i}`).join(" ")} ELSE ${CLASS_ORDER.length} END`;
  const firstReviews = await db
    .prepare(`SELECT id, name, ticker, class FROM assets WHERE id NOT IN (SELECT asset_id FROM rulings) ORDER BY ${order}, id LIMIT ?`)
    .bind(BATCH).all();
  const reReviews = await db
    .prepare("SELECT id, name, ticker, class, next_review FROM assets WHERE next_review IS NOT NULL AND next_review <= date('now', '+30 days') ORDER BY next_review, id LIMIT ?")
    .bind(BATCH).all();
  const unlisted = await db
    .prepare(
      `SELECT cmc_id, symbol, name, rank FROM market_snapshots
       WHERE taken_at = (SELECT MAX(taken_at) FROM market_snapshots)
         AND cmc_id NOT IN (SELECT cmc_id FROM assets WHERE cmc_id IS NOT NULL)
       ORDER BY rank LIMIT ?`,
    )
    .bind(BATCH).all();
  return c.json({ firstReviews: firstReviews.results, reReviews: reReviews.results, unlisted: unlisted.results });
});

interface DraftBody {
  assetId: string;
  section: string;
  answers: Record<string, Answer>;
  codes?: Record<string, Code>;
  evidence?: Record<string, { evidence?: string; sourceUrl?: string; accessedAt?: string }>;
  rewards?: { section: string; answers: Record<string, Answer> }[];
  confidence: "High" | "Medium" | "Low";
  supersedes?: string;
  publicFields: { what: string; why?: string; how?: string; know?: string };
  cardUrl?: string;
  /** Wrapped tokens (WRAP-4, WRAP-5): the asset whose approved ruling they take. */
  underlyingAssetId?: string;
  /** WRAP-4: the added feature's own table (yield through LST, rewards through REWARD). */
  feature?: { section: string; answers: Record<string, Answer>; codes?: Record<string, Code> };
}

const SEVERITY: Record<string, number> = { Halal: 0, "Check the company": 1, Doubtful: 2, Haram: 3 };
/** The stricter of two results: the more severe status, then the higher code within it. */
const stricter = (a: { status: Status; code: Code }, b: { status: Status; code: Code }) =>
  SEVERITY[b.status] > SEVERITY[a.status] || (b.status === a.status && b.code > a.code) ? b : a;

async function approvedRuling(db: D1Database, assetId: string) {
  return db.prepare(
    `SELECT r.status, r.code FROM rulings r JOIN signatures s ON s.ruling_id = r.id AND s.role IN ('approved', 'standing')
     WHERE r.asset_id = ? AND NOT EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = r.id AND e.type = 'Return')
     ORDER BY s.at DESC LIMIT 1`,
  ).bind(assetId).first<{ status: Status; code: Code }>();
}

analyst.post("/drafts", async (c) => {
  const db = c.env.DB;
  const b = await c.req.json<DraftBody>();
  const asset = await db.prepare("SELECT id FROM assets WHERE id = ?").bind(b.assetId).first();
  if (!asset) return c.json(fail(`Unknown asset ${b.assetId}`), 422);

  if (b.supersedes) {
    const prev = await db.prepare("SELECT asset_id FROM rulings WHERE id = ?").bind(b.supersedes).first<{ asset_id: string }>();
    if (!prev || prev.asset_id !== b.assetId) return c.json(fail(`supersedes must name an earlier ruling of ${b.assetId}`), 422);
  }
  const catalog = await loadCatalog(db, "1.0");
  let outcome;
  try {
    outcome = deriveOutcome(catalog, b.section, b.answers, b.codes);
    for (const r of b.rewards ?? []) outcome.rewardRulings.push(...deriveOutcome(catalog, r.section, r.answers).rewardRulings);
  } catch (e) {
    return c.json(fail((e as Error).message), 422);
  }
  if (outcome.route === "UNDERLYING" || outcome.route === "UNDERLYING_AND_FEATURE") {
    const under = b.underlyingAssetId ? await approvedRuling(db, b.underlyingAssetId) : null;
    if (!under) return c.json(fail("A wrapped token needs underlyingAssetId with an approved ruling"), 422);
    let result = under;
    if (outcome.route === "UNDERLYING_AND_FEATURE") {
      if (!b.feature) return c.json(fail("WRAP-4: submit the added feature's table in `feature`"), 422);
      let f;
      try { f = deriveOutcome(catalog, b.feature.section, b.feature.answers, b.feature.codes); }
      catch (e) { return c.json(fail((e as Error).message), 422); }
      outcome.rewardRulings.push(...f.rewardRulings);
      if (f.status && f.code) result = stricter(under, { status: f.status, code: f.code });
      else if (f.route || f.sendToScholar) outcome.sendToScholar = true;
    }
    outcome.status = result.status;
    outcome.code = result.code;
    delete outcome.route;
  }
  if (outcome.route) return c.json(fail(`This table routes to ${outcome.route}: submit the answers for that table`), 422);
  if (!outcome.status || !outcome.code) return c.json(fail("No status or code could be derived: raise a question for the Scholar"), 422);

  const now = new Date().toISOString();
  let card;
  try {
    for (const v of Object.values(b.publicFields)) if (v) assertPublicSafe(v);
    card = buildPublic(catalog, outcome, { section: b.section, whatItIs: b.publicFields.what, approvedAt: null, lastReviewed: now });
  } catch (e) {
    return c.json(fail((e as Error).message), 422);
  }

  const id = crypto.randomUUID();
  const allAnswers: Record<string, Answer> = { ...b.answers };
  for (const r of b.rewards ?? []) Object.assign(allAnswers, r.answers);
  if (b.feature) Object.assign(allAnswers, b.feature.answers);
  const reviewType = b.supersedes ? "Re-review" : "First";

  await db.batch([
    db.prepare(
      `INSERT INTO rulings (id, asset_id, criteria_version, status, code, class, confidence, review_type, deciding_check,
         checks_structured, send_to_scholar, card_url, prepared_at, supersedes, created_at)
       VALUES (?, ?, '1.0', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    ).bind(id, b.assetId, outcome.status, outcome.code, b.section, b.confidence, reviewType, outcome.decidingCheckId,
      outcome.sendToScholar ? 1 : 0, b.cardUrl ?? null, now, b.supersedes ?? null, now),
    ...Object.entries(allAnswers).map(([checkId, answer]) => {
      const ev = b.evidence?.[checkId];
      return db.prepare("INSERT INTO ruling_checks (ruling_id, check_id, answer, evidence, source_url, accessed_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, checkId, answer, ev?.evidence ?? null, ev?.sourceUrl ?? null, ev?.accessedAt ?? null);
    }),
    db.prepare("INSERT INTO public_fields (ruling_id, what, why, how, know, usage_line, card_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, b.publicFields.what, b.publicFields.why ?? null, b.publicFields.how ?? null, b.publicFields.know ?? null, card.usageLine, JSON.stringify(card)),
    db.prepare("INSERT INTO events (asset_id, ruling_id, type, at, detail) VALUES (?, ?, ?, ?, ?)")
      .bind(b.assetId, id, reviewType, now, `Draft prepared: ${outcome.status}, ${outcome.code} via ${outcome.decidingCheckId}`),
  ]);

  return c.json({ rulingId: id, ...outcome }, 201);
});

analyst.post("/questions", async (c) => {
  const b = await c.req.json<{ assetId?: string; rulingId?: string; question: string; context?: string; options?: string[] }>();
  if (!b.question?.trim()) return c.json(fail("A question is required"), 422);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO questions (id, asset_id, ruling_id, question, context, options_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, b.assetId ?? null, b.rulingId ?? null, b.question.trim(), b.context ?? null, b.options ? JSON.stringify(b.options) : null)
    .run();
  return c.json({ id }, 201);
});

analyst.post("/events", async (c) => {
  const b = await c.req.json<{ assetId: string; rulingId?: string; type: string; detail?: string }>();
  if (!ANALYST_EVENTS.includes(b.type)) return c.json(fail(`Analysts cannot log "${b.type}" events`), 422);
  await c.env.DB.prepare("INSERT INTO events (asset_id, ruling_id, type, at, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(b.assetId, b.rulingId ?? null, b.type, new Date().toISOString(), b.detail ?? null)
    .run();
  return c.json({ ok: true }, 201);
});

analyst.get("/requests", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM requests WHERE status = 'open' ORDER BY at").all();
  return c.json(results);
});

analyst.post("/snapshot", async (c) => {
  const b = await c.req.json<{ listings?: Listing[]; limit?: number }>().catch(() => ({} as { listings?: Listing[]; limit?: number }));
  let listings = b.listings;
  if (!listings) {
    if (!c.env.CMC_API_KEY) return c.json(fail("No listings given and no CoinMarketCap key configured"), 422);
    listings = await fetchListings(c.env.CMC_API_KEY, b.limit ?? 500);
  }
  const at = new Date().toISOString();
  const db = c.env.DB;
  for (let i = 0; i < listings.length; i += 50) {
    await db.batch(listings.slice(i, i + 50).map((l) =>
      db.prepare("INSERT INTO market_snapshots (taken_at, cmc_id, symbol, name, rank) VALUES (?, ?, ?, ?, ?)").bind(at, String(l.id), l.symbol, l.name, l.cmc_rank)));
  }
  return c.json({ takenAt: at, count: listings.length }, 201);
});
