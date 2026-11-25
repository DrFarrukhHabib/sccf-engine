import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "./fixtures/catalog-v1.json";
import { app } from "../src/index";
import { importCatalog } from "../src/catalog/load";

const db = env.DB;
const auth = { Authorization: "Bearer test-analyst-key", "Content-Type": "application/json" };
const get = (path: string) => app.request(path, { headers: auth }, env);
const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: auth, body: JSON.stringify(body) }, env);
const now = new Date().toISOString();

async function ruling(id: string, asset: string, opts: { signed?: boolean; why?: string | null; supersedes?: string } = {}) {
  await db.prepare(`INSERT INTO rulings (id, asset_id, criteria_version, status, code, confidence, deciding_check, prepared_at, created_at, supersedes)
    VALUES (?, ?, '1.0', 'Halal', 'H1', 'High', 'UTIL-3', ?, ?, ?)`).bind(id, asset, now, now, opts.supersedes ?? null).run();
  const why = opts.why === undefined ? "It is a real service token." : opts.why;
  await db.prepare("INSERT INTO public_fields (ruling_id, what, why, how, know, card_json) VALUES (?, 'a service token', ?, ?, NULL, '{}')")
    .bind(id, why, why === null ? null : "Use it for the service.").run();
  if (opts.signed) await db.prepare("INSERT INTO signatures (ruling_id, role, by_whom, at) VALUES (?, 'approved', 'Shariah Scholar', ?)").bind(id, now).run();
}

beforeAll(async () => {
  await importCatalog(db, fixture as any);
  const assets = [["B-1", "Old Coin", "OLD"], ["B-2", "Full Coin", "FUL"], ["B-3", "No Address Coin", "NAC"], ["B-4", "Redrafted Coin", "RDC"]];
  for (const [id, name, ticker] of assets)
    await db.prepare("INSERT INTO assets (id, name, ticker, class) VALUES (?, ?, ?, 'UTIL')").bind(id, name, ticker).run();
  await ruling("BR-1", "B-1", { signed: true, why: null });
  await ruling("BR-2", "B-2", { signed: true });
  await db.prepare("INSERT INTO network_addresses (asset_id, network, address, source, checked_at) VALUES ('B-2', 'Ethereum', '0xabc', 'analyst', ?)").bind(now).run();
  await ruling("BR-3", "B-3", { signed: true });
  await ruling("BR-4", "B-4", { signed: true, why: null });
  await ruling("BR-4b", "B-4", { supersedes: "BR-4" });
});

describe("backfill of older approved rulings", () => {
  it("the queue lists approved rulings missing the summary or the contract addresses, unless a redraft is already waiting", async () => {
    const q = (await (await get("/analyst/queue")).json()) as any;
    expect(q.backfill.map((r: any) => [r.id, r.rulingId, r.missing])).toEqual([
      ["B-1", "BR-1", ["summary", "networks"]],
      ["B-3", "BR-3", ["networks"]],
    ]);
  });

  it("a refused draft is logged on the token, with the reason", async () => {
    const res = await post("/analyst/drafts", { assetId: "B-2", section: "UTIL", answers: {}, confidence: "High", publicFields: { what: "x" } });
    expect(res.status).toBe(422);
    const ev = await db.prepare("SELECT type, detail FROM events WHERE asset_id = 'B-2' AND type = 'Refused'").first<{ type: string; detail: string }>();
    expect(ev?.detail).toContain("ZERO");
  });

  it("the weekly report counts the week's work, refusals and backfill left, and shows recent drafts with their sources", async () => {
    const res = await get("/analyst/report?days=7");
    expect(res.status).toBe(200);
    const r = (await res.json()) as any;
    expect(r).toMatchObject({ days: 7, drafts: 5, approved: 4, standing: 0, returned: 0, refused: 1, questionsAsked: 0, questionsAnswered: 0, backfillRemaining: 2 });
    expect(r.refusals[0]).toMatchObject({ assetId: "B-2" });
    expect(r.recentDrafts.find((d: any) => d.rulingId === "BR-4b")).toMatchObject({ name: "Redrafted Coin", status: "Halal", code: "H1", webSources: 0, why: "It is a real service token." });
  });

  it("the report window is capped at 31 days", async () => {
    expect(((await (await get("/analyst/report?days=90")).json()) as any).days).toBe(31);
  });
});
