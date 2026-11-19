import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { approve, isPublic, returnWithNote, standingConfirm } from "../src/review/approve";

const db = env.DB;
let n = 0;

beforeAll(async () => {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO criteria_versions (version, approved_at) VALUES ('1.0', '2026-11-19')"),
    db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class, created_at) VALUES ('SCCF-0104', 'USD Coin', 'USDC', 'FIAT', '2026-11-03')"),
  ]);
});

async function ruling(over: Partial<{ status: string; code: string; confidence: string; supersedes: string | null; send: number; structured: number }> = {}) {
  const id = `R-${++n}`;
  const r = { status: "Halal", code: "H2", confidence: "High", supersedes: null, send: 0, structured: 1, ...over };
  await db
    .prepare(
      `INSERT INTO rulings (id, asset_id, criteria_version, status, code, confidence, review_type, supersedes, send_to_scholar, checks_structured, created_at)
       VALUES (?, 'SCCF-0104', '1.0', ?, ?, ?, ?, ?, ?, ?, '2026-11-19')`,
    )
    .bind(id, r.status, r.code, r.confidence, r.supersedes ? "Re-review" : "First", r.supersedes, r.send, r.structured)
    .run();
  return id;
}

async function approvedEarlier(over = {}) {
  const prev = await ruling(over);
  await approve(db, prev, "Shariah Scholar");
  return prev;
}

describe("approval", () => {
  it("a draft is not public", async () => {
    expect(await isPublic(db, await ruling())).toBe(false);
  });

  it("an approved ruling is public, with a signature and an event", async () => {
    const id = await ruling();
    await approve(db, id, "Shariah Scholar");
    expect(await isPublic(db, id)).toBe(true);
    const sig = await db.prepare("SELECT role, by_whom FROM signatures WHERE ruling_id = ?").bind(id).first();
    expect(sig).toEqual({ role: "approved", by_whom: "Shariah Scholar" });
    const ev = await db.prepare("SELECT type FROM events WHERE ruling_id = ?").bind(id).first();
    expect(ev).toEqual({ type: "Approval" });
  });

  it("refuses to approve twice", async () => {
    const id = await approvedEarlier();
    await expect(approve(db, id, "Shariah Scholar")).rejects.toThrow(/already approved/);
  });

  it("refuses an unknown ruling", async () => {
    await expect(approve(db, "nope", "Shariah Scholar")).rejects.toThrow(/not found/);
  });

  it("returnWithNote needs a note", async () => {
    const id = await ruling();
    await expect(returnWithNote(db, id, "  ")).rejects.toThrow(/note/);
  });

  it("a returned ruling is not public and cannot then be approved", async () => {
    const id = await ruling();
    await returnWithNote(db, id, "Check the reward terms again");
    expect(await isPublic(db, id)).toBe(false);
    const ev = await db.prepare("SELECT type, detail FROM events WHERE ruling_id = ?").bind(id).first();
    expect(ev).toEqual({ type: "Return", detail: "Check the reward terms again" });
    await expect(approve(db, id, "Shariah Scholar")).rejects.toThrow(/returned/);
  });
});

describe("standingConfirm", () => {
  it("confirms an unchanged re-review under standing approval", async () => {
    const prev = await approvedEarlier();
    const id = await ruling({ supersedes: prev });
    await standingConfirm(db, id);
    expect(await isPublic(db, id)).toBe(true);
    const sig = await db.prepare("SELECT role FROM signatures WHERE ruling_id = ?").bind(id).first();
    expect(sig).toEqual({ role: "standing" });
  });

  it("refuses when the status differs from the earlier status", async () => {
    const prev = await approvedEarlier();
    const id = await ruling({ supersedes: prev, status: "Haram", code: "R1" });
    await expect(standingConfirm(db, id)).rejects.toThrow(/status/);
  });

  it("refuses when the code differs", async () => {
    const prev = await approvedEarlier({ code: "H1" });
    const id = await ruling({ supersedes: prev, code: "H2" });
    await expect(standingConfirm(db, id)).rejects.toThrow(/code/);
  });

  it("refuses when there is an open question", async () => {
    const prev = await approvedEarlier();
    const id = await ruling({ supersedes: prev });
    await db.prepare("INSERT INTO questions (id, ruling_id, question) VALUES (?, ?, 'Is the reward automatic?')").bind(`Q-${id}`, id).run();
    await expect(standingConfirm(db, id)).rejects.toThrow(/open question/);
  });

  it("refuses when confidence is Low", async () => {
    const prev = await approvedEarlier();
    const id = await ruling({ supersedes: prev, confidence: "Low" });
    await expect(standingConfirm(db, id)).rejects.toThrow(/Low/);
  });

  it("refuses a D1 result", async () => {
    const prev = await approvedEarlier({ status: "Doubtful", code: "D1" });
    const id = await ruling({ supersedes: prev, status: "Doubtful", code: "D1" });
    await expect(standingConfirm(db, id)).rejects.toThrow(/D1/);
  });

  it("refuses a first review, an unapproved earlier ruling, a Scholar item and an unstructured import", async () => {
    await expect(standingConfirm(db, await ruling())).rejects.toThrow(/earlier/);
    const draft = await ruling();
    await expect(standingConfirm(db, await ruling({ supersedes: draft }))).rejects.toThrow(/earlier/);
    const prev = await approvedEarlier();
    await expect(standingConfirm(db, await ruling({ supersedes: prev, send: 1 }))).rejects.toThrow(/Scholar/);
    await expect(standingConfirm(db, await ruling({ supersedes: prev, structured: 0 }))).rejects.toThrow(/structured/);
  });
});
