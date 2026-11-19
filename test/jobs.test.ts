import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { dueReReviews, exportAll, queueNewListings, restoreExport, runDaily, syncRegister } from "../src/jobs/daily";

const db = env.DB;
const listings = [
  { id: 1, symbol: "BTC", name: "Bitcoin", cmc_rank: 1 },
  { id: 5426, symbol: "SOL", name: "Solana", cmc_rank: 5 },
  { id: 9999, symbol: "NEW", name: "Newcoin", cmc_rank: 80 },
];

beforeAll(async () => {
  await db.batch([
    db.prepare("INSERT INTO criteria_versions (version, approved_at) VALUES ('1.0', '2026-11-19')"),
    db.prepare("INSERT INTO assets (id, cmc_id, name, ticker, class, next_review) VALUES ('A-due', '5426', 'Solana', 'SOL', 'NATIVE', date('now', '+29 days'))"),
    db.prepare("INSERT INTO assets (id, cmc_id, name, ticker, class, next_review) VALUES ('A-late', '1', 'Bitcoin', 'BTC', 'NATIVE', date('now', '+31 days'))"),
    db.prepare("INSERT INTO rulings (id, asset_id, criteria_version, status, code, confidence, deciding_check, prepared_at, created_at) VALUES ('R-1', 'A-due', '1.0', 'Halal', 'H1', 'High', 'NATIVE-4', '2026-11-15', '2026-11-15')"),
    db.prepare("INSERT INTO public_fields (ruling_id, what, usage_line, card_json) VALUES ('R-1', 'The coin of Solana.', 'Use it only in permissible activities.', '{\"statusLabel\":\"Halal\"}')"),
    db.prepare("INSERT INTO signatures (ruling_id, role, by_whom, at) VALUES ('R-1', 'approved', 'Dr. Farrukh Habib', '2026-11-15T00:00:00Z')"),
    db.prepare("INSERT INTO rulings (id, asset_id, criteria_version, status, code, confidence, supersedes, created_at) VALUES ('R-2', 'A-due', '1.0', 'Halal', 'H1', 'High', 'R-1', '2026-11-20')"),
    db.prepare("INSERT INTO events (asset_id, ruling_id, type, at, detail) VALUES ('A-due', 'R-1', 'Approval', '2026-11-15', 'ok')"),
  ]);
});

describe("daily jobs", () => {
  it("lists re-reviews due within 30 days and queues each once", async () => {
    expect((await dueReReviews(db)).map((a) => a.id)).toEqual(["A-due"]);
    await dueReReviews(db);
    const { results } = await db.prepare("SELECT asset_id, type FROM requests WHERE type = 're-review'").all();
    expect(results).toEqual([{ asset_id: "A-due", type: "re-review" }]);
  });

  it("queues a new CoinMarketCap listing once, not twice", async () => {
    expect(await queueNewListings(db, listings)).toEqual(["NEW"]);
    expect(await queueNewListings(db, listings)).toEqual([]);
    const { results } = await db.prepare("SELECT id, type, text FROM requests WHERE type = 'new-listing'").all();
    expect(results).toEqual([{ id: "listing-9999", type: "new-listing", text: "Newcoin (NEW), CoinMarketCap rank 80" }]);
  });

  it("syncs approved rulings to the Asset Register through the given writer", async () => {
    let written: unknown[][] = [];
    const n = await syncRegister(db, async (rows) => { written = rows; });
    expect(n).toBe(1);
    expect(written).toEqual([["A-due", "Solana", "SOL", "Halal", "H1", "Use it only in permissible activities.", "2026-11-15"]]);
  });

  it("the export round-trips into an empty database", async () => {
    const dump = await exportAll(db);
    expect(dump.version).toBe("1");
    expect(Object.keys(dump.tables)).toContain("rulings");
    await restoreExport(env.RESTORE_DB, JSON.parse(JSON.stringify(dump)));
    for (const table of ["assets", "rulings", "signatures", "events", "requests", "public_fields", "criteria_versions"]) {
      const a = await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
      const b = await env.RESTORE_DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
      expect(b.results, table).toEqual(a.results);
    }
    await expect(restoreExport(env.RESTORE_DB, dump)).rejects.toThrow(/not empty/);
  });

  it("runDaily writes the export to R2 and reports what it did", async () => {
    const report = await runDaily(
      { DB: db, BACKUPS: env.BACKUPS } as any,
      { listings: async () => listings, writeRegister: async () => {} },
    );
    expect(report).toMatchObject({ due: 1, newListings: 0, registerRows: 1 });
    const obj = await env.BACKUPS.get(report.backupKey);
    expect(obj).not.toBeNull();
    expect(JSON.parse(await obj!.text()).tables.assets).toHaveLength(2);
  });

  it("a failing step does not stop the backup", async () => {
    const report = await runDaily(
      { DB: db, BACKUPS: env.BACKUPS } as any,
      { listings: async () => { throw new Error("CoinMarketCap down"); }, writeRegister: async () => {} },
    );
    expect(report.errors).toEqual(["listings: CoinMarketCap down"]);
    expect(await env.BACKUPS.get(report.backupKey)).not.toBeNull();
  });
});
