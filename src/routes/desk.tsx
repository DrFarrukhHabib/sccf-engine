import { Hono } from "hono";
import { certsProvider, verifyAccess, type AccessConfig, type KeyProvider } from "../auth/access";
import { hashKey, newKey } from "../auth/keys";
import type { Answer } from "../db/types";
import { approve, Refused, returnWithNote } from "../review/approve";
import { compare } from "../review/compare";
import type { Bindings } from "../index";
import { fastLane, freezeWave, waveProgress } from "../waves";
import { CardPage, KeysPage, LibraryPage, QuestionsPage, QueuePage, RulesPage, RulingPage } from "../views/pages";

export interface DeskOptions {
  config?: (env: Bindings) => AccessConfig;
  keys?: KeyProvider;
}

const envConfig = (env: Bindings): AccessConfig => ({
  teamDomain: env.ACCESS_TEAM_DOMAIN ?? "", aud: env.ACCESS_AUD ?? "", email: env.DESK_EMAIL ?? "",
});

const OPEN = `NOT EXISTS (SELECT 1 FROM signatures s WHERE s.ruling_id = r.id AND s.role IN ('approved','standing'))
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = r.id AND e.type = 'Return')`;
const UNANSWERED = `(SELECT COUNT(*) FROM questions q WHERE q.answer IS NULL AND (q.asset_id = r.asset_id OR q.ruling_id = r.id))`;
/** Drafts the Scholar may approve in one click: same status as the old system, High confidence, no open question. */
const MATCHING = `${OPEN} AND r.confidence = 'High' AND a.old_status = r.status AND ${UNANSWERED} = 0`;
const OPEN_QUESTIONS = `SELECT q.id, q.asset_id, a.name AS asset_name, q.question, q.context, q.options_json AS options
  FROM questions q LEFT JOIN assets a ON a.id = q.asset_id WHERE q.answer IS NULL`;

export function createDesk(opts: DeskOptions = {}) {
  const desk = new Hono<{ Bindings: Bindings; Variables: { scholar: string } }>();

  desk.use("*", async (c, next) => {
    const cfg = (opts.config ?? envConfig)(c.env);
    const email = await verifyAccess(c.req.header("Cf-Access-Jwt-Assertion"), cfg, opts.keys ?? certsProvider(cfg.teamDomain));
    if (!email) return c.text("Forbidden", 403);
    if (c.req.method !== "GET" && c.req.header("Origin") !== new URL(c.req.url).origin) return c.text("Forbidden", 403);
    c.set("scholar", email);
    await next();
  });

  desk.get("/", (c) => c.redirect("/desk/queue"));

  desk.get("/queue", async (c) => {
    const db = c.env.DB;
    const drafts = await db.prepare(
      `SELECT r.*, a.name, a.ticker, a.old_status, a.old_code, ${UNANSWERED} AS open_questions
       FROM rulings r JOIN assets a ON a.id = r.asset_id WHERE ${OPEN} ORDER BY r.send_to_scholar DESC, r.created_at`,
    ).all<Record<string, any>>();
    const returned = await db.prepare(
      `SELECT r.id, a.name, a.ticker, e.detail FROM rulings r JOIN assets a ON a.id = r.asset_id
       JOIN events e ON e.ruling_id = r.id AND e.type = 'Return'
       WHERE NOT EXISTS (SELECT 1 FROM rulings n WHERE n.supersedes = r.id) ORDER BY e.at`,
    ).all();
    const questions = await db.prepare(`${OPEN_QUESTIONS} ORDER BY q.created_at`).all();
    const eligible = await db.prepare(`SELECT COUNT(*) AS n FROM rulings r JOIN assets a ON a.id = r.asset_id WHERE ${MATCHING}`).first<{ n: number }>();
    const approved = await db.prepare(
      `SELECT COUNT(DISTINCT r.asset_id) AS n FROM rulings r JOIN signatures s ON s.ruling_id = r.id AND s.role IN ('approved','standing')
       WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.ruling_id = r.id AND e.type = 'Return')`,
    ).first<{ n: number }>();
    const progress = await waveProgress(db);
    const lane = (await fastLane(db, 50)).length;
    const asked = await db.prepare("SELECT id, text, at FROM requests WHERE type = 'scholar-token' AND status = 'open' ORDER BY at").all();
    return c.html(<QueuePage drafts={drafts.results} returned={returned.results} questions={questions.results}
      approved={approved?.n ?? 0} eligible={eligible?.n ?? 0} progress={progress} fastLane={lane} asked={asked.results} />);
  });

  desk.post("/approve-matching", async (c) => {
    const db = c.env.DB;
    const { results } = await db.prepare(`SELECT r.id FROM rulings r JOIN assets a ON a.id = r.asset_id WHERE ${MATCHING}`).all<{ id: string }>();
    for (const { id } of results) await approve(db, id, c.get("scholar"));
    return c.redirect("/desk/queue", 303);
  });

  const load = async (db: D1Database, id: string) =>
    db.prepare("SELECT r.*, a.name, a.ticker, a.old_status, a.old_code, a.earlier_status FROM rulings r JOIN assets a ON a.id = r.asset_id WHERE r.id = ?").bind(id).first<Record<string, any>>();
  const checksOf = async (db: D1Database, id: string) =>
    (await db.prepare(
      `SELECT rc.*, cc.question FROM ruling_checks rc
       LEFT JOIN catalog_checks cc ON cc.id = rc.check_id AND cc.version = (SELECT criteria_version FROM rulings WHERE id = rc.ruling_id)
       WHERE rc.ruling_id = ? ORDER BY rc.check_id`,
    ).bind(id).all<Record<string, any>>()).results;

  desk.get("/rulings/:id", async (c) => {
    const db = c.env.DB;
    const r = await load(db, c.req.param("id"));
    if (!r) return c.notFound();
    const checks = await checksOf(db, r.id);
    let previous = null, changes = null;
    if (r.supersedes) {
      previous = await load(db, r.supersedes);
      if (previous) {
        const before = await checksOf(db, previous.id);
        changes = compare(
          { status: previous.status, code: previous.code, checksStructured: !!previous.checks_structured, rewardRulings: [],
            checks: before.map((x) => ({ checkId: x.check_id, answer: x.answer as Answer, sourceUrl: x.source_url })) },
          { answers: Object.fromEntries(checks.map((x) => [x.check_id, x.answer as Answer])),
            sources: Object.fromEntries(checks.filter((x) => x.source_url).map((x) => [x.check_id, x.source_url])),
            outcome: { status: r.status, code: r.code, decidingCheckId: r.deciding_check, sendToScholar: false, useConditions: [], rewardRulings: [] } },
        ).changes;
      }
    }
    const open = !!(await db.prepare(`SELECT 1 FROM rulings r WHERE r.id = ? AND ${OPEN}`).bind(r.id).first());
    const questions = (await db.prepare(`${OPEN_QUESTIONS} AND (q.asset_id = ? OR q.ruling_id = ?) ORDER BY q.created_at`)
      .bind(r.asset_id, r.id).all<Record<string, any>>()).results;
    const deciding = await db.prepare("SELECT question FROM catalog_checks WHERE id = ? AND version = ?")
      .bind(r.deciding_check, r.criteria_version).first<{ question: string }>();
    return c.html(<RulingPage r={r} checks={checks} changes={changes} previous={previous} isOpen={open}
      questions={questions} decidingText={deciding?.question ?? null} />);
  });

  desk.get("/rulings/:id/card", async (c) => {
    const db = c.env.DB;
    const r = await load(db, c.req.param("id"));
    const pub = r && (await db.prepare("SELECT card_json FROM public_fields WHERE ruling_id = ?").bind(r.id).first<{ card_json: string }>());
    if (!r || !pub?.card_json) return c.notFound();
    return c.html(<CardPage r={r} card={JSON.parse(pub.card_json)} />);
  });

  const act = (fn: (db: D1Database, id: string, form: Record<string, string>, by: string) => Promise<void>, back = "/desk/queue") => async (c: any) => {
    const form = (await c.req.parseBody()) as Record<string, string>;
    try {
      await fn(c.env.DB, c.req.param("id"), form, c.get("scholar"));
    } catch (e) {
      if (e instanceof Refused) return c.text((e as Error).message, 422);
      throw e;
    }
    const to = typeof form.back === "string" && /^\/desk\/[\w\-\/]*$/.test(form.back) ? form.back : back;
    return c.redirect(to, 303);
  };
  desk.post("/rulings/:id/approve", act((db, id, _f, by) => approve(db, id, by)));
  desk.post("/rulings/:id/return", act((db, id, f) => returnWithNote(db, id, f.note ?? "")));

  desk.post("/requests/token", act(async (db, _id, f) => {
    const name = f.name?.trim(), ticker = f.ticker?.trim().toUpperCase();
    if (!name || !ticker) throw new Refused("Give the token's name and ticker");
    const note = f.note?.trim();
    await db.prepare("INSERT INTO requests (id, type, text, at) VALUES (?, 'scholar-token', ?, ?)")
      .bind(crypto.randomUUID(), `${name} (${ticker})${note ? `: ${note}` : ""}`, new Date().toISOString()).run();
  }));

  desk.post("/waves", act(async (db, _id, f) => {
    const size = Number(f.size);
    if (!Number.isInteger(size) || size < 1 || size > 5000) throw new Refused("Choose a size between 1 and 5000");
    try { await freezeWave(db, size); } catch (e) { throw new Refused((e as Error).message); }
  }));

  desk.get("/questions", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT q.id, q.asset_id, a.name AS asset_name, q.question, q.context, q.options_json AS options, q.answer, q.answered_at, q.applied
       FROM questions q LEFT JOIN assets a ON a.id = q.asset_id ORDER BY q.created_at`,
    ).all<Record<string, any>>();
    return c.html(<QuestionsPage open={results.filter((q) => q.answer == null)} answered={results.filter((q) => q.answer != null)} />);
  });

  desk.post("/questions/:id/answer", act(async (db, id, f) => {
    if (!f.answer?.trim()) throw new Refused("An answer is required");
    await db.prepare("UPDATE questions SET answer = ?, answered_at = ? WHERE id = ? AND answer IS NULL").bind(f.answer.trim(), new Date().toISOString(), id).run();
  }, "/desk/questions"));

  desk.get("/rules", async (c) => {
    const { results } = await c.env.DB.prepare("SELECT * FROM rule_proposals ORDER BY decision IS NOT NULL, id").all();
    return c.html(<RulesPage rows={results} />);
  });

  desk.post("/rules/:id/decide", act(async (db, id, f) => {
    if (f.decision !== "approved" && f.decision !== "rejected") throw new Refused("Choose Approve or Reject");
    await db.prepare("UPDATE rule_proposals SET decision = ?, note = ? WHERE id = ? AND decision IS NULL")
      .bind(f.decision, f.note?.trim() || null, id).run();
  }, "/desk/rules"));

  desk.get("/library", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT a.id, a.name, a.ticker, a.class, r.status, r.code, s.at AS approved
       FROM assets a JOIN rulings r ON r.asset_id = a.id JOIN signatures s ON s.ruling_id = r.id AND s.role IN ('approved','standing')
       WHERE NOT EXISTS (SELECT 1 FROM rulings n JOIN signatures ns ON ns.ruling_id = n.id AND ns.role IN ('approved','standing')
                         WHERE n.asset_id = a.id AND ns.at > s.at)
       ORDER BY a.id`,
    ).all();
    return c.html(<LibraryPage rows={results} />);
  });

  const clients = async (db: D1Database) =>
    (await db.prepare("SELECT id, name, preliminary, created_at, revoked_at FROM api_clients ORDER BY created_at").all()).results;

  desk.get("/keys", async (c) => c.html(<KeysPage clients={await clients(c.env.DB)} />));

  desk.post("/keys", async (c) => {
    const f = (await c.req.parseBody()) as Record<string, string>;
    const name = f.name?.trim();
    if (!name) return c.text("A client name is required", 422);
    const key = newKey();
    await c.env.DB.prepare("INSERT INTO api_clients (id, name, key_hash, preliminary, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), name, await hashKey(key), f.preliminary ? 1 : 0, new Date().toISOString()).run();
    c.header("Cache-Control", "no-store");
    return c.html(<KeysPage clients={await clients(c.env.DB)} newKey={key} name={name} />);
  });

  desk.post("/keys/:id/revoke", async (c) => {
    await c.env.DB.prepare("UPDATE api_clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), c.req.param("id")).run();
    return c.redirect("/desk/keys", 303);
  });

  return desk;
}
