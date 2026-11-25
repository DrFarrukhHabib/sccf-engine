import { Hono } from "hono";
import { loadCatalog } from "../catalog/load";
import type { Answer, Code, Status } from "../db/types";
import { fetchListings, type Listing } from "../market/cmc";
import { buildPublic } from "../public/build";
import { assertPublicSafe } from "../public/guard";
import { deriveOutcome } from "../rules/derive";
import type { Bindings } from "../index";
import { backfillCount, backfillList } from "../backfill";
import { fastLane, MATCHES, RANKS, waveProgress } from "../waves";

const BATCH = 15;
/** Older approved rulings re-reviewed per run to complete the standard record. */
const BACKFILL = 10;
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

/** A refused draft is logged on its token, so the weekly report shows what the analyst got wrong. */
analyst.use("/drafts", async (c, next) => {
  await next();
  if (c.req.method !== "POST" || c.res.status !== 422) return;
  try {
    const b = await c.req.json<{ assetId?: string }>();
    const { error } = (await c.res.clone().json()) as { error?: string };
    const asset = b.assetId && (await c.env.DB.prepare("SELECT id FROM assets WHERE id = ?").bind(b.assetId).first());
    if (asset) await c.env.DB.prepare("INSERT INTO events (asset_id, type, at, detail) VALUES (?, 'Refused', ?, ?)")
      .bind(b.assetId, new Date().toISOString(), error ?? "refused").run();
  } catch { /* logging never blocks the answer */ }
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
  // Order: the Scholar's token requests, the fast lane, then the frozen wave by rank (registered tokens first, then new ones).
  const requests = await db.prepare("SELECT id, text, at FROM requests WHERE type = 'scholar-token' AND status = 'open' ORDER BY at").all();
  const lane = await fastLane(db, BATCH);
  const firstReviews = await db
    .prepare(
      `WITH ${RANKS}
       SELECT id, name, ticker, class, (SELECT MIN(k.rank) FROM ranks k WHERE ${MATCHES("k", "assets")}) AS market_rank
       FROM assets WHERE id NOT IN (SELECT asset_id FROM rulings)
       ORDER BY market_rank IS NULL, market_rank, id LIMIT ?`,
    )
    .bind(BATCH).all();
  const reReviews = await db
    .prepare("SELECT id, name, ticker, class, next_review FROM assets WHERE next_review IS NOT NULL AND next_review <= date('now', '+30 days') ORDER BY next_review, id LIMIT ?")
    .bind(BATCH).all();
  const unlisted = await db
    .prepare(
      `WITH ${RANKS}
       SELECT k.cmc_id, k.symbol, k.name, k.rank FROM ranks k
       WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE ${MATCHES("k", "a")})
       ORDER BY k.rank LIMIT ?`,
    )
    .bind(BATCH).all();
  const backfill = await backfillList(db, BACKFILL);
  return c.json({ requests: requests.results, fastLane: lane, firstReviews: firstReviews.results, reReviews: reReviews.results, unlisted: unlisted.results, backfill });
});

/** The week's work in numbers, for the weekly check-in: drafts, approvals, refusals, questions, wave and backfill progress. */
analyst.get("/report", async (c) => {
  const db = c.env.DB;
  const days = Math.min(31, Math.max(1, Math.floor(Number(c.req.query("days")) || 7)));
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
  return c.json({
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
  });
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
  /** The token's chains and contract addresses, as confirmed in the identity step. */
  networks?: { network: string; address: string }[];
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

const WEB = /^https?:\/\/[^\s]+$/i;
const SCHOLAR = /^scholar-answer:(.+)$/;

/** The research quality floor. Returns what is missing, or null when the draft passes. */
async function qualityFloor(db: D1Database, assetId: string, answers: Record<string, Answer>,
  evidence: NonNullable<DraftBody["evidence"]>): Promise<string | null> {
  const web = new Set<string>();
  for (const [id, a] of Object.entries(answers)) {
    const ev = evidence[id];
    const url = ev?.sourceUrl?.trim();
    if (!url) {
      if (a === "yes") return `Cite a source for ${id}: every "yes" answer needs one`;
      continue;
    }
    const scholar = url.match(SCHOLAR);
    if (scholar) {
      const q = await db.prepare("SELECT 1 FROM questions WHERE id = ? AND asset_id = ? AND answer IS NOT NULL").bind(scholar[1], assetId).first();
      if (!q) return `${id} cites ${url}, which is not an answered question for ${assetId}`;
      continue;
    }
    if (!WEB.test(url)) return `${id}: the source must be a web address (https://…) or scholar-answer:<question id>`;
    if (!ev?.accessedAt?.trim()) return `${id}: give the access date for ${url}`;
    if (!ev?.evidence?.trim()) return `${id}: say what ${url} shows`;
    web.add(url.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase());
  }
  if (web.size < 2) return `A draft must rest on at least two different web sources (found ${web.size})`;
  return null;
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
  // A redraft that names nothing replaces the token's open draft (unapproved, not returned, not already replaced).
  if (!b.supersedes) {
    const open = await db.prepare(
      `SELECT r.id FROM rulings r WHERE r.asset_id = ?
         AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.ruling_id = r.id AND s.role IN ('approved','standing'))
         AND NOT EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = r.id AND e.type = 'Return')
         AND NOT EXISTS (SELECT 1 FROM rulings n WHERE n.supersedes = r.id)
       ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`,
    ).bind(b.assetId).first<{ id: string }>();
    if (open) b.supersedes = open.id;
  }
  const catalog = await loadCatalog(db, "1.0");
  // Every draft passes the ZERO gate first ("Is it an asset?"): it can stop the review or send it to WRAP.
  const zeroIds = (catalog.sections.ZERO ?? []).filter((c) => !c.question.startsWith("Otherwise")).map((c) => c.id);
  const missing = zeroIds.filter((id) => !(id in (b.answers ?? {})));
  if (missing.length) return c.json(fail(`Answer the ZERO checks first: ${missing.join(", ")}`), 422);
  let outcome;
  try {
    const zero = deriveOutcome(catalog, "ZERO", Object.fromEntries(zeroIds.map((id) => [id, b.answers[id]])));
    if (zero.route === "WRAP" && b.section !== "WRAP") return c.json(fail("ZERO-2 says this is a bridged or wrapped copy: submit it through WRAP"), 422);
    outcome = zero.status ? zero : deriveOutcome(catalog, b.section, b.answers, b.codes);
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

  // The standard record: every ruling explains what the token is, why it got this ruling, and how to use it.
  for (const [k, label] of [["what", "what it is"], ["why", "why"], ["how", "how to use it"]] as const)
    if (!b.publicFields?.[k]?.trim()) return c.json(fail(`publicFields.${k} (${label}) is required`), 422);
  for (const n of b.networks ?? [])
    if (!n?.network?.trim() || !n?.address?.trim()) return c.json(fail("Each network needs a network name and an address"), 422);

  // Quality floor: every "yes" cites a source, web sources carry an access date, and a draft rests on at least two web sources.
  const answered: Record<string, Answer> = { ...b.answers };
  for (const r of b.rewards ?? []) Object.assign(answered, r.answers);
  if (b.feature) Object.assign(answered, b.feature.answers);
  const floor = await qualityFloor(db, b.assetId, answered, b.evidence ?? {});
  if (floor) return c.json(fail(floor), 422);

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
  // A re-review revisits an approved ruling; until something is approved, every draft is a first review.
  const reviewType = (await approvedRuling(db, b.assetId)) ? "Re-review" : "First";

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
    ...(b.networks ?? []).map((n) =>
      db.prepare("INSERT OR IGNORE INTO network_addresses (asset_id, network, address, source, checked_at) VALUES (?, ?, ?, 'analyst', ?)")
        .bind(b.assetId, n.network.trim(), n.address.trim(), now)),
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

/** Registers a token from the market list (`unlisted`) so it can be reviewed. Takes the next SCCF id. */
analyst.post("/assets", async (c) => {
  const db = c.env.DB;
  const b = await c.req.json<{ cmcId?: string; coingeckoId?: string; name?: string; ticker?: string; class?: string }>();
  if (!b.name?.trim() || !b.ticker?.trim() || !b.class?.trim()) return c.json(fail("name, ticker and class are required"), 422);
  const catalog = await loadCatalog(db, "1.0");
  const cls = b.class.trim().toUpperCase();
  if (!catalog.sections[cls] || cls === "ZERO") return c.json(fail(`Unknown class ${b.class}`), 422);
  const dup = await db.prepare(
    `SELECT id FROM assets WHERE (?1 IS NOT NULL AND cmc_id = ?1) OR (?2 IS NOT NULL AND coingecko_id = ?2)
       OR (UPPER(ticker) = UPPER(?3) AND UPPER(name) = UPPER(?4))`,
  ).bind(b.cmcId ? String(b.cmcId) : null, b.coingeckoId ?? null, b.ticker.trim(), b.name.trim()).first<{ id: string }>();
  if (dup) return c.json(fail(`Already registered as ${dup.id}`), 409);
  const last = await db.prepare("SELECT MAX(CAST(SUBSTR(id, 6) AS INTEGER)) AS n FROM assets WHERE id LIKE 'SCCF-%'").first<{ n: number | null }>();
  const id = `SCCF-${String((last?.n ?? 0) + 1).padStart(4, "0")}`;
  await db.prepare("INSERT INTO assets (id, cmc_id, coingecko_id, name, ticker, class) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, b.cmcId ? String(b.cmcId) : null, b.coingeckoId ?? null, b.name.trim(), b.ticker.trim(), cls).run();
  return c.json({ id }, 201);
});

/** The Scholar's answers that the analyst has not yet acted on. */
analyst.get("/answers", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT q.id, q.asset_id, q.ruling_id, q.question, q.context, q.answer, q.answered_at,
       (SELECT r.id FROM rulings r WHERE r.asset_id = q.asset_id ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS latestRulingId
     FROM questions q WHERE q.answer IS NOT NULL AND q.applied = 0 ORDER BY q.answered_at`,
  ).all();
  return c.json(results);
});

analyst.post("/questions/:id/applied", async (c) => {
  const r = await c.env.DB.prepare("UPDATE questions SET applied = 1 WHERE id = ? AND answer IS NOT NULL").bind(c.req.param("id")).run();
  if (!r.meta.changes) return c.json(fail("No answered question with that id"), 422);
  return c.json({ ok: true });
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

analyst.post("/requests/:id/done", async (c) => {
  const b = await c.req.json<{ result?: string }>().catch(() => ({} as { result?: string }));
  const r = await c.env.DB.prepare("UPDATE requests SET status = 'done', result = ? WHERE id = ? AND status = 'open'")
    .bind(b.result?.trim() || null, c.req.param("id")).run();
  if (!r.meta.changes) return c.json(fail("No open request with that id"), 422);
  return c.json({ ok: true });
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
