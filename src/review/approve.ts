import type { Answer, RulingRow } from "../db/types";
import { compare } from "./compare";

export class Refused extends Error {}

const now = () => new Date().toISOString();

async function getRuling(db: D1Database, id: string): Promise<RulingRow> {
  const r = await db.prepare("SELECT * FROM rulings WHERE id = ?").bind(id).first<RulingRow>();
  if (!r) throw new Refused(`Ruling ${id} not found`);
  return r;
}

const hasSignature = async (db: D1Database, id: string) =>
  !!(await db.prepare("SELECT 1 FROM signatures WHERE ruling_id = ? AND role IN ('approved', 'standing')").bind(id).first());

const wasReturned = async (db: D1Database, id: string) =>
  !!(await db.prepare("SELECT 1 FROM events WHERE ruling_id = ? AND type = 'Return'").bind(id).first());

/** A ruling is public once it carries an approval or standing signature and was never returned. */
export async function isPublic(db: D1Database, rulingId: string): Promise<boolean> {
  return (await hasSignature(db, rulingId)) && !(await wasReturned(db, rulingId));
}

async function sign(db: D1Database, r: RulingRow, role: "approved" | "standing", by: string, detail: string) {
  const at = now();
  await db.batch([
    db.prepare("INSERT INTO signatures (ruling_id, role, by_whom, at) VALUES (?, ?, ?, ?)").bind(r.id, role, by, at),
    db.prepare("INSERT INTO events (asset_id, ruling_id, type, at, detail) VALUES (?, ?, 'Approval', ?, ?)").bind(r.asset_id, r.id, at, detail),
    // Every approval starts the six-month clock to the next review.
    db.prepare("UPDATE assets SET next_review = date(?, '+6 months') WHERE id = ?").bind(at, r.asset_id),
  ]);
}

async function assertOpen(db: D1Database, r: RulingRow) {
  if (await hasSignature(db, r.id)) throw new Refused(`Ruling ${r.id} is already approved`);
  if (await wasReturned(db, r.id)) throw new Refused(`Ruling ${r.id} was returned; a new draft must replace it`);
}

/** The Scholar approves a draft. Writes a signature and an event; the ruling row is never edited. */
export async function approve(db: D1Database, rulingId: string, by: string): Promise<void> {
  const r = await getRuling(db, rulingId);
  await assertOpen(db, r);
  await sign(db, r, "approved", by, `Approved by ${by}`);
}

/** The Scholar sends a draft back. The note is required: it tells the analyst what to fix. */
export async function returnWithNote(db: D1Database, rulingId: string, note: string): Promise<void> {
  if (!note?.trim()) throw new Refused("A return needs a note");
  const r = await getRuling(db, rulingId);
  await assertOpen(db, r);
  await db
    .prepare("INSERT INTO events (asset_id, ruling_id, type, at, detail) VALUES (?, ?, 'Return', ?, ?)")
    .bind(r.asset_id, r.id, now(), note.trim())
    .run();
}

/**
 * The Scholar withdraws a published ruling, with a note. It stops being public at once; the token's
 * previous approved ruling, if any, applies again. Recorded like a return, so every query treats it alike.
 */
export async function withdraw(db: D1Database, rulingId: string, note: string): Promise<void> {
  if (!note?.trim()) throw new Refused("A withdrawal needs a note");
  const r = await getRuling(db, rulingId);
  if (!(await isPublic(db, r.id))) throw new Refused(`Ruling ${r.id} is not published, so it cannot be withdrawn`);
  await db
    .prepare("INSERT INTO events (asset_id, ruling_id, type, at, detail) VALUES (?, ?, 'Return', ?, ?)")
    .bind(r.asset_id, r.id, now(), `Withdrawn: ${note.trim()}`)
    .run();
}

/**
 * Confirms an unchanged re-review under the Scholar's standing approval.
 * Refuses anything that must reach the Scholar: a changed status or code, an open question,
 * Low confidence, D1, a Scholar item, an unstructured import, or no approved earlier ruling.
 */
export async function standingConfirm(db: D1Database, rulingId: string): Promise<void> {
  const r = await getRuling(db, rulingId);
  await assertOpen(db, r);
  if (!r.supersedes) throw new Refused("Standing approval needs an earlier approved ruling");
  const prev = await getRuling(db, r.supersedes);
  if (!(await isPublic(db, prev.id))) throw new Refused("Standing approval needs an earlier approved ruling");
  if (prev.status !== r.status) throw new Refused(`The status changed (${prev.status} to ${r.status})`);
  if (prev.code !== r.code) throw new Refused(`The code changed (${prev.code} to ${r.code})`);
  if (r.code === "D1") throw new Refused("A D1 result always goes to the Scholar");
  if (r.confidence === "Low") throw new Refused("Low confidence always goes to the Scholar");
  if (r.send_to_scholar) throw new Refused("This ruling is marked for the Scholar");
  if (!r.checks_structured) throw new Refused("The ruling has no structured checks to compare");
  const open = await db
    .prepare("SELECT 1 FROM questions WHERE (ruling_id = ? OR (asset_id = ? AND ruling_id IS NULL)) AND answer IS NULL")
    .bind(r.id, r.asset_id)
    .first();
  if (open) throw new Refused("There is an open question for the Scholar");

  const checksOf = async (id: string) =>
    (await db.prepare("SELECT check_id, answer, source_url FROM ruling_checks WHERE ruling_id = ?").bind(id)
      .all<{ check_id: string; answer: Answer; source_url: string | null }>()).results;
  const [before, now_] = [await checksOf(prev.id), await checksOf(r.id)];
  const diff = compare(
    { status: prev.status, code: prev.code, checksStructured: !!prev.checks_structured, rewardRulings: [],
      checks: before.map((c) => ({ checkId: c.check_id, answer: c.answer, sourceUrl: c.source_url })) },
    { answers: Object.fromEntries(now_.map((c) => [c.check_id, c.answer])),
      outcome: { status: r.status, code: r.code, decidingCheckId: r.deciding_check, sendToScholar: false, useConditions: [], rewardRulings: [] } },
  );
  if (diff.needsScholar)
    throw new Refused(`Answers changed since the earlier ruling: ${diff.changes.map((c) => `${c.checkId} ${c.from} to ${c.to}`).join(", ") || "earlier ruling has no structured checks"}`);
  await sign(db, r, "standing", "Standing approval", "Confirmed under standing approval: no change");
}
