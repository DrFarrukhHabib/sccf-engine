import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { hashKey } from "../src/auth/keys";

const db = env.DB;
const FULL = "sccf_full_client_key_for_tests_0000000000000000";
const PRELIM = "sccf_preliminary_client_key_for_tests_00000000000";
const BUSY = "sccf_busy_client_key_for_tests_0000000000000000000";
const get = (path: string, key: string | null = FULL) => app.request(path, { headers: key ? { "X-API-Key": key } : {} }, env);
const LEAK = /\b(H[12]|D[1-5]|R[1-7]|S1)\b|deciding|trust|rating|stars|cmc|coinmarketcap|rank/i;

const card = (statusLabel: string) => JSON.stringify({
  statusLabel, usageLine: "Use it only in permissible activities.",
  tiles: [{ title: "Is it an asset?", result: "Pass", line: "Yes." }], activity: { hold: "Yes" },
  footer: "Preliminary: prepared with AI and not yet reviewed by a Shariah Scholar; it may contain errors. Last reviewed 1 November 2026. This is a Shariah opinion, not investment advice. Powered by Najm Screener.",
});

async function ruling(id: string, asset: string, status: string, code: string, created: string, signedAt?: string, opts: { returned?: boolean } = {}) {
  await db.prepare(`INSERT INTO rulings (id, asset_id, criteria_version, status, code, confidence, deciding_check, prepared_at, created_at)
    VALUES (?, ?, '1.0', ?, ?, 'High', 'X-1', ?, ?)`).bind(id, asset, status, code, created, created).run();
  await db.prepare("INSERT INTO public_fields (ruling_id, what, why, how, know, card_json) VALUES (?, 'a dollar stablecoin', 'It pays holders nothing.', 'Exchange it on the spot.', 'No concerns found.', ?)").bind(id, card(status)).run();
  if (signedAt) await db.prepare("INSERT INTO signatures (ruling_id, role, by_whom, at) VALUES (?, 'approved', 'Shariah Scholar', ?)").bind(id, signedAt).run();
  if (opts.returned) await db.prepare("INSERT INTO events (asset_id, ruling_id, type, at, detail) VALUES (?, ?, 'Return', ?, 'fix')").bind(asset, id, created).run();
}

beforeAll(async () => {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO criteria_versions (version, approved_at) VALUES ('1.0', '2026-11-19')"),
    db.prepare("INSERT INTO assets (id, cmc_id, coingecko_id, name, ticker, class) VALUES ('A-1', '3408', 'usd-coin', 'USD Coin', 'USDC', 'FIAT')"),
    db.prepare("INSERT INTO assets (id, cmc_id, name, ticker, class) VALUES ('A-2', '9', 'Staked Frax Ether', 'sfrxETH', 'LST')"),
    db.prepare("INSERT INTO assets (id, name, ticker, class) VALUES ('A-3', 'Tokenized Apple', 'AAPLx', 'STOCK')"),
    db.prepare("INSERT INTO assets (id, name, ticker, class) VALUES ('A-4', 'Draft Only', 'DRFT', 'UTIL')"),
    db.prepare("INSERT INTO api_clients (id, name, key_hash, preliminary, created_at) VALUES ('c1', 'Exchange', ?, 0, '2026-11-01')").bind(await hashKey(FULL)),
    db.prepare("INSERT INTO api_clients (id, name, key_hash, preliminary, created_at) VALUES ('c2', 'Najm', ?, 1, '2026-11-01')").bind(await hashKey(PRELIM)),
    db.prepare("INSERT INTO api_clients (id, name, key_hash, preliminary, created_at, revoked_at) VALUES ('c3', 'Old', ?, 1, '2026-11-01', '2026-11-02')").bind(await hashKey("sccf_revoked")),
    db.prepare("INSERT INTO api_clients (id, name, key_hash, preliminary, created_at) VALUES ('c4', 'Busy', ?, 0, '2026-11-01')").bind(await hashKey(BUSY)),
    db.prepare("INSERT INTO network_addresses (asset_id, network, address) VALUES ('A-1', 'Ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')"),
  ]);
  // USDC: Halal approved 3 Nov; a re-review approved 10 Dec changes it to Doubtful.
  await ruling("U-1", "A-1", "Halal", "H2", "2026-11-03T09:00:00Z", "2026-11-03T12:00:00Z");
  await ruling("U-2", "A-1", "Doubtful", "D1", "2026-12-10T09:00:00Z", "2026-12-10T12:00:00Z");
  await ruling("U-3", "A-1", "Haram", "R1", "2026-12-12T09:00:00Z"); // newer draft, unsigned
  await ruling("F-1", "A-2", "Haram", "R1", "2026-11-03T09:00:00Z", "2026-11-03T12:00:00Z");
  await ruling("S-1", "A-3", "Check the company", "S1", "2026-11-19T09:00:00Z", "2026-11-19T12:00:00Z");
  await ruling("X-1", "A-4", "Halal", "H1", "2026-11-19T09:00:00Z");
  await ruling("X-2", "A-4", "Halal", "H1", "2026-11-18T09:00:00Z", undefined, { returned: true });
});

describe("public API v1", () => {
  it("needs a valid, unrevoked key", async () => {
    expect((await get("/v1/rulings", null)).status).toBe(401);
    expect((await get("/v1/rulings", "sccf_wrong")).status).toBe(401);
    expect((await get("/v1/rulings", "sccf_revoked")).status).toBe(401);
  });

  it("an unsigned ruling never appears for a full client", async () => {
    const body = (await (await get("/v1/rulings")).json()) as any;
    expect(body.poweredBy).toBe("Najm Screener");
    expect(body.rulings.map((r: any) => r.assetId).sort()).toEqual(["A-1", "A-2", "A-3"]);
    const usdc = body.rulings.find((r: any) => r.assetId === "A-1");
    expect(usdc).toMatchObject({ status: "Doubtful", preliminary: false, approvedAt: "2026-12-10" });
    expect(usdc.footer).toBe("Approved by a Shariah Scholar on 10 December 2026. Last reviewed 10 December 2026. This is a Shariah opinion, not investment advice. Powered by Najm Screener.");
    expect((await get("/v1/assets/A-4")).status).toBe(404);
  });

  it("preliminary rulings appear only for a preliminary client, with the disclaimer; returned drafts never", async () => {
    const body = (await (await get("/v1/rulings", PRELIM)).json()) as any;
    const usdc = body.rulings.find((r: any) => r.assetId === "A-1");
    expect(usdc).toMatchObject({ status: "Haram", preliminary: true, approvedAt: null });
    expect(usdc.disclaimer).toBe("Preliminary: prepared with AI and not yet reviewed by a Shariah Scholar; it may contain errors.");
    expect(usdc.lastApproved).toMatchObject({ status: "Doubtful", approvedAt: "2026-12-10" });
    const drft = body.rulings.find((r: any) => r.assetId === "A-4");
    expect(drft).toMatchObject({ preliminary: true });
    expect(body.rulings.filter((r: any) => r.assetId === "A-4")).toHaveLength(1);
  });

  it("filters by status and class; S1 tokens are not Halal", async () => {
    const halal = (await (await get("/v1/rulings?status=Halal")).json()) as any;
    expect(halal.rulings).toEqual([]);
    const s1 = (await (await get("/v1/rulings?status=Check%20the%20company")).json()) as any;
    expect(s1.rulings.map((r: any) => r.assetId)).toEqual(["A-3"]);
    const lst = (await (await get("/v1/rulings?class=LST")).json()) as any;
    expect(lst.rulings.map((r: any) => r.assetId)).toEqual(["A-2"]);
    expect((await get("/v1/rulings?status=H2")).status).toBe(400);
  });

  it("returns one asset", async () => {
    const body = (await (await get("/v1/assets/A-2")).json()) as any;
    expect(body).toMatchObject({ poweredBy: "Najm Screener", ruling: { assetId: "A-2", ticker: "sfrxETH", status: "Haram" } });
  });

  it("status on a date returns the ruling live on that date", async () => {
    const before = (await (await get("/v1/assets/A-1/on/2026-11-30")).json()) as any;
    expect(before.ruling).toMatchObject({ status: "Halal", approvedAt: "2026-11-03" });
    const after = (await (await get("/v1/assets/A-1/on/2026-12-10")).json()) as any;
    expect(after.ruling).toMatchObject({ status: "Doubtful" });
    expect((await get("/v1/assets/A-1/on/2026-10-01")).status).toBe(404);
    expect((await get("/v1/assets/A-1/on/yesterday")).status).toBe(400);
  });

  it("every ruling is the standard record: identifiers, summary, dates", async () => {
    const r = ((await (await get("/v1/assets/A-1")).json()) as any).ruling;
    expect(r).toMatchObject({
      recordVersion: "1", rulingId: "U-2", assetId: "A-1", name: "USD Coin", ticker: "USDC", coingeckoId: "usd-coin",
      networks: [{ network: "Ethereum", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }],
      status: "Doubtful", usageLine: "Use it only in permissible activities.",
      summary: { whatItIs: "a dollar stablecoin", why: "It pays holders nothing.", howToUse: "Exchange it on the spot.", thingsToKnow: "No concerns found." },
      approvedAt: "2026-12-10", updatedAt: "2026-12-10T12:00:00Z",
    });
  });

  it("finds a token by CoinGecko id, CoinMarketCap id, ticker or contract address", async () => {
    const ids = async (q: string) => (((await (await get(`/v1/lookup?${q}`)).json()) as any).rulings ?? []).map((r: any) => r.assetId);
    expect(await ids("coingeckoId=usd-coin")).toEqual(["A-1"]);
    expect(await ids("cmcId=3408")).toEqual(["A-1"]);
    expect(await ids("ticker=usdc")).toEqual(["A-1"]);
    expect(await ids("network=ethereum&address=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")).toEqual(["A-1"]);
    expect(await ids("ticker=NOPE")).toEqual([]);
    expect((await get("/v1/lookup")).status).toBe(400);
    expect((await get("/v1/lookup?address=0xabc")).status).toBe(400);
  });

  it("changes: approvals and withdrawals since a moment, each with the record now in force, and a bookmark for next time", async () => {
    const body = (await (await get("/v1/changes?since=2026-12-01T00:00:00Z")).json()) as any;
    expect(body.until).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.changes.map((c: any) => [c.assetId, c.change, c.ruling?.status])).toEqual([["A-1", "approved", "Doubtful"]]);
    expect(((await (await get("/v1/changes?since=2026-12-10T12:00:01Z")).json()) as any).changes).toEqual([]);
    expect((await get("/v1/changes")).status).toBe(400);
    expect((await get("/v1/changes?since=soon")).status).toBe(400);
  });

  it("tracks each client's use and refuses over the daily limit", async () => {
    await get("/v1/rulings", FULL);
    const c = await db.prepare("SELECT last_used_at FROM api_clients WHERE id = 'c1'").first<{ last_used_at: string }>();
    expect(c?.last_used_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await db.prepare("INSERT INTO api_usage (client_id, day, requests) VALUES ('c4', date('now'), 1000)").run();
    const res = await get("/v1/rulings", BUSY);
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error).toMatch(/daily limit/);
  });

  it("exports JSON and CSV with version, date and a SHA-256 fingerprint", async () => {
    const res = await get("/v1/export.json");
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ poweredBy: "Najm Screener", version: "1", count: 3 });
    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body.rulings)));
    expect(body.fingerprint).toBe([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));

    const csv = await get("/v1/export.csv");
    expect(csv.headers.get("Content-Type")).toMatch(/text\/csv/);
    expect(csv.headers.get("X-SCCF-Fingerprint")).toMatch(/^[0-9a-f]{64}$/);
    expect(csv.headers.get("X-Powered-By")).toBe("Najm Screener");
    const text = await csv.text();
    expect(text.split("\n")[0]).toBe("asset_id,name,ticker,status,usage_line,approved_at,last_reviewed,powered_by");
    expect(text).toContain('"A-2","Staked Frax Ether","sfrxETH","Haram"');
  });

  it("no response contains a code, rule number, trust rating or CoinMarketCap field", async () => {
    for (const [path, key] of [["/v1/rulings", FULL], ["/v1/rulings", PRELIM], ["/v1/assets/A-1", FULL], ["/v1/assets/A-1/on/2026-11-30", FULL],
      ["/v1/changes?since=2026-01-01", FULL], ["/v1/lookup?ticker=USDC", FULL], ["/v1/export.json", FULL], ["/v1/export.csv", FULL]] as const) {
      const text = await (await get(path, key)).text();
      expect(text, path).not.toMatch(LEAK);
      expect(text, path).not.toContain("3408");
    }
  });

  it("a withdrawal shows in the changes, with the earlier approval back in force", async () => {
    await db.prepare("INSERT INTO assets (id, name, ticker, class) VALUES ('A-5', 'Withdrawn Coin', 'WDC', 'UTIL')").run();
    await ruling("W-1", "A-5", "Halal", "H1", "2026-12-01T09:00:00Z", "2026-12-01T12:00:00Z");
    await ruling("W-2", "A-5", "Doubtful", "D2", "2026-12-12T09:00:00Z", "2026-12-12T12:00:00Z");
    await db.prepare("INSERT INTO events (asset_id, ruling_id, type, at, detail) VALUES ('A-5', 'W-2', 'Return', '2026-12-20T08:00:00Z', 'Withdrawn: check')").run();
    const later = (await (await get("/v1/changes?since=2026-12-15")).json()) as any;
    expect(later.changes.map((c: any) => [c.assetId, c.change, c.ruling?.status, c.changedAt])).toEqual([["A-5", "withdrawn", "Halal", "2026-12-20T08:00:00Z"]]);
    expect(later.until >= "2026-12-20T08:00:00Z").toBe(true);
  });
});
