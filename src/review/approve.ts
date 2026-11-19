import type { RulingRow } from "../db/types";

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
  await sign(db, r, "standing", "Standing approval", "Confirmed under standing approval: no change");
}
