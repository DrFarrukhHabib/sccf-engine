import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "./fixtures/desk-export.json";
import { app } from "../src/index";
import { hashKey } from "../src/auth/keys";
import { deskToStatements, statementsToSql, type DeskExport } from "../src/migrate/desk";
import { isPublic, standingConfirm } from "../src/review/approve";

const db = env.DB;
const input = fixture as unknown as DeskExport;
let report: ReturnType<typeof deskToStatements>["report"];

beforeAll(async () => {
  await db.prepare("INSERT OR IGNORE INTO criteria_versions (version, approved_at) VALUES ('1.0', '2026-11-19')").run();
  const out = deskToStatements(input);
  report = out.report;
  await db.batch(out.statements.map((s) => db.prepare(s.sql).bind(...s.params)));
  await db.prepare("INSERT INTO api_clients (id, name, key_hash, preliminary, created_at) VALUES ('m1', 'Test', ?, 0, '2026-11-19')").bind(await hashKey("sccf_migrate")).run();
});

const ruling = (asset: string) =>
  db.prepare("SELECT * FROM rulings WHERE asset_id = ? ORDER BY created_at").bind(asset).all<Record<string, any>>().then((r) => r.results);
const sigs = (rulingId: string) =>
  db.prepare("SELECT role, by_whom, at FROM signatures WHERE ruling_id = ?").bind(rulingId).all().then((r) => r.results);

describe("migration from the Review Desk", () => {
  it("imports every asset, with earlier statuses, and rulings only for reviewed ones", async () => {
    expect((await db.prepare("SELECT COUNT(*) AS n FROM assets").first<{ n: number }>())!.n).toBe(6);
    expect(await db.prepare("SELECT earlier_status, next_review FROM assets WHERE id = 'SCCF-0002'").first()).toEqual({ earlier_status: "Halal", next_review: null });
    expect(await ruling("SCCF-0002")).toEqual([]);
    expect(report).toMatchObject({ assets: 6, rulings: 6, approved: 4, drafts: 1, historyRows: 10 });
  });

  it("approval dates carry over as signatures; standing confirmations as standing", async () => {
    const [jito] = await ruling("SCCF-0049");
    expect(await sigs(jito.id)).toEqual([{ role: "approved", by_whom: "Dr. Farrukh Habib", at: "2026-11-13T00:00:00Z" }]);
    const [rune] = await ruling("SCCF-0098");
    expect(await sigs(rune.id)).toEqual([{ role: "standing", by_whom: "Dr. Farrukh Habib", at: "2026-11-15T00:00:00Z" }]);
    expect(await isPublic(db, jito.id)).toBe(true);
    const [ethfi] = await ruling("SCCF-0031");
    expect(await sigs(ethfi.id)).toEqual([]);
    expect(await isPublic(db, ethfi.id)).toBe(false);
  });

  it("applies the reclassifications of 19 November 2026", async () => {
    const cls = async (id: string) => (await db.prepare("SELECT class FROM assets WHERE id = ?").bind(id).first<{ class: string }>())!.class;
    expect(await cls("SCCF-0012")).toBe("LAUNCH");
    expect(await cls("SCCF-0098")).toBe("EXCH");
    expect(await cls("SCCF-0049")).toBe("LST");
    expect(await cls("SCCF-0090")).toBe("LST");

    const bio = await ruling("SCCF-0012");
    expect(bio.map((r) => [r.class, r.status, r.code])).toEqual([["EXCH", "Halal", "H1"], ["LAUNCH", "Halal", "H2"]]);
    expect(bio[1].supersedes).toBe(bio[0].id);
    expect(await sigs(bio[1].id)).toEqual([{ role: "approved", by_whom: "Dr. Farrukh Habib", at: "2026-11-19T00:00:00Z" }]);
    const rune = await ruling("SCCF-0098");
    expect(rune.map((r) => [r.class, r.code])).toEqual([["EXCH", "H2"]]);
  });

  it("serves the migrated rulings through the API, BIO as its 19 November ruling", async () => {
    const res = await app.request("/v1/assets/SCCF-0012", { headers: { "X-API-Key": "sccf_migrate" } }, env);
    const body = (await res.json()) as any;
    expect(body.ruling).toMatchObject({ status: "Halal", approvedAt: "2026-11-19", class: "LAUNCH",
      usageLine: "Do not use the launchpad to buy or launch hype or prohibited tokens." });
    const fr = (await (await app.request("/v1/assets/SCCF-0090", { headers: { "X-API-Key": "sccf_migrate" } }, env)).json()) as any;
    expect(fr.ruling).toMatchObject({ status: "Haram", usageLine: "Do not hold, buy or trade it. If you hold it, exit." });
  });

  it("marks every migrated ruling as checks not yet structured, so re-reviews go to the Scholar", async () => {
    const { results } = await db.prepare("SELECT DISTINCT checks_structured FROM rulings").all();
    expect(results).toEqual([{ checks_structured: 0 }]);
    const [jito] = await ruling("SCCF-0049");
    await db.prepare(`INSERT INTO rulings (id, asset_id, criteria_version, status, code, confidence, checks_structured, supersedes, created_at)
      VALUES ('re-1', 'SCCF-0049', '1.0', 'Halal', 'H1', 'High', 1, ?, '2027-05-01')`).bind(jito.id).run();
    await expect(standingConfirm(db, "re-1")).rejects.toThrow(/structured/);
  });

  it("loses no history row", async () => {
    const { results } = await db.prepare("SELECT asset_id, at, type, detail FROM events WHERE type != 'Migration' ORDER BY id").all<Record<string, string>>();
    expect(results).toHaveLength(input.history.length - 1);
    expect(results[0]).toMatchObject({ asset_id: "SCCF-0049", at: "2026-11-03", type: "First" });
    expect(JSON.parse(results[1].detail).reason).toMatch(/^Final Rulings List had Halal H1/);
    for (const r of results) expect(JSON.parse(r.detail).reportLink).toMatch(/^https:/);
  });

  it("refuses a history row for an asset that is not in the export", () => {
    const bad = { ...input, history: [...input.history, ["SCCF-9999", "X", "X", "2026-11-01", "First", "Halal", "H1", "High", "Preliminary", "N", "x", "https://x"]] };
    expect(() => deskToStatements(bad as DeskExport)).toThrow(/SCCF-9999/);
  });

  it("refuses an unknown class name instead of guessing", () => {
    const bad = { ...input, tokens: input.tokens.map((t, i) => (i === 0 ? { ...t, cls: "Something new" } : t)) };
    expect(() => deskToStatements(bad as DeskExport)).toThrow(/Something new/);
  });

  it("renders the same statements as an SQL file", () => {
    const sql = statementsToSql(deskToStatements(input).statements);
    expect(sql).toContain("INSERT OR IGNORE INTO assets");
    expect(sql).toContain("'A token you receive for staking SOL with Jito''s staking pool on Solana.'");
  });
});

describe("migration from the Asset Register export (reclassifications already applied)", () => {
  it("rebuilds BIO's history from its register row and maps the new class names", () => {
    const tokens = input.tokens.map((t) =>
      t.assetId === "SCCF-0012" ? { ...t, cls: "Launchpad", code: "H2" }
      : t.assetId === "SCCF-0098" ? { ...t, cls: "Exchange token (DEX)" }
      : t.assetId === "SCCF-0049" || t.assetId === "SCCF-0090" ? { ...t, cls: "Liquid staking token" } : t);
    const sql = deskToStatements({ ...input, tokens }).statements;
    const bio = sql.filter((s) => s.sql.includes("INTO rulings") && s.params[1] === "SCCF-0012").map((s) => [s.params[0], s.params[4], s.params[3]]);
    expect(bio).toEqual([["MIG-SCCF-0012", "EXCH", "H1"], ["MIG-SCCF-0012-R2", "LAUNCH", "H2"]]);
    const cls = (id: string) => sql.find((s) => s.sql.includes("INTO assets") && s.params[0] === id)!.params[4];
    expect([cls("SCCF-0098"), cls("SCCF-0049"), cls("SCCF-0090")]).toEqual(["EXCH", "LST", "LST"]);
  });

  it("is safe to run twice", async () => {
    const out = deskToStatements(input);
    await expect(db.batch(out.statements.map((s) => db.prepare(s.sql).bind(...s.params)))).resolves.toBeDefined();
    expect((await db.prepare("SELECT COUNT(*) AS n FROM rulings WHERE id LIKE 'MIG-%'").first<{ n: number }>())!.n).toBe(6);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE type != 'Migration'").first<{ n: number }>())!.n).toBe(input.history.length - 1);
  });
});
