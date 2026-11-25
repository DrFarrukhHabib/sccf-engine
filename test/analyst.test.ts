import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "./fixtures/catalog-v1.json";
import { app } from "../src/index";
import { importCatalog } from "../src/catalog/load";
import { isPublic } from "../src/review/approve";
import { fetchInfo, fetchListings } from "../src/market/cmc";

const db = env.DB;
const auth = { Authorization: "Bearer test-analyst-key", "Content-Type": "application/json" };
const call = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...auth, ...(init.headers ?? {}) } }, env);
const rawPost = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
/** Sample drafts get a cited source for every answer, as the quality floor requires. */
const sourced = (b: any) => {
  const answers = { ...(b.answers ?? {}) };
  for (const r of b.rewards ?? []) Object.assign(answers, r.answers);
  if (b.feature) Object.assign(answers, b.feature.answers);
  const evidence = { ...(b.evidence ?? {}) };
  for (const id of Object.keys(answers))
    if (!evidence[id]) evidence[id] = { evidence: `Checked for ${id}`, sourceUrl: `https://example.org/${id}`, accessedAt: "2026-11-25" };
  return { ...b, evidence };
};
const post = (path: string, body: any) => rawPost(path, path === "/analyst/drafts" ? sourced(body) : body);

const ZERO_OK = { "ZERO-1": "yes", "ZERO-2": "no", "ZERO-3": "no", "ZERO-4": "no" } as const;
const ZERO_WRAP = { "ZERO-1": "yes", "ZERO-2": "yes", "ZERO-3": "no", "ZERO-4": "no" } as const;

const usdcDraft = {
  assetId: "SCCF-0104", section: "FIAT", confidence: "High",
  answers: { ...ZERO_OK, "FIAT-1": "no", "FIAT-2": "no", "FIAT-3": "no", "FIAT-3B": "no", "FIAT-4": "no" },
  evidence: { "FIAT-1": { evidence: "Circle keeps reserve income", sourceUrl: "https://www.circle.com/transparency", accessedAt: "2026-11-25" } },
  rewards: [{ section: "REWARD", answers: { "REWARD-1": "no", "REWARD-2": "yes", "REWARD-3": "no" } }],
  publicFields: { what: "a dollar stablecoin backed by reserves", why: "It pays its holders nothing.", how: "Exchange it on the spot.", know: "No concerns found." },
};

beforeAll(async () => {
  await importCatalog(db, fixture as any);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO assets (id, cmc_id, name, ticker, class) VALUES ('SCCF-0104', '3408', 'USD Coin', 'USDC', 'FIAT')"),
    db.prepare("INSERT OR IGNORE INTO assets (id, cmc_id, name, ticker, class) VALUES ('SCCF-0200', '74', 'Dogecoin', 'DOGE', 'MEME')"),
    db.prepare("INSERT OR IGNORE INTO assets (id, cmc_id, name, ticker, class) VALUES ('SCCF-0201', '1027', 'Ethereum', 'ETH', 'NATIVE')"),
    db.prepare("INSERT OR IGNORE INTO assets (id, cmc_id, name, ticker, class) VALUES ('SCCF-0202', '7083', 'Uniswap', 'UNI', 'EXCH')"),
    db.prepare("INSERT OR IGNORE INTO assets (id, cmc_id, name, ticker, class) VALUES ('SCCF-0203', '5426', 'Solana', 'SOL', 'NATIVE')"),
  ]);
});

describe("analyst door", () => {
  it("a wrong or missing key gives 401", async () => {
    expect((await app.request("/analyst/queue", { headers: { Authorization: "Bearer wrong" } }, env)).status).toBe(401);
    expect((await app.request("/analyst/queue", {}, env)).status).toBe(401);
  });

  it("stores a draft that is not public, with its checks and public card", async () => {
    const res = await post("/analyst/drafts", usdcDraft);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ status: "Halal", code: "H2", decidingCheckId: "FIAT-6", sendToScholar: false });
    expect(await isPublic(db, body.rulingId)).toBe(false);
    const checks = await db.prepare("SELECT check_id, answer, source_url FROM ruling_checks WHERE ruling_id = ? ORDER BY check_id").bind(body.rulingId).all();
    expect(checks.results).toContainEqual({ check_id: "FIAT-1", answer: "no", source_url: "https://www.circle.com/transparency" });
    expect(checks.results).toContainEqual({ check_id: "REWARD-2", answer: "yes", source_url: "https://example.org/REWARD-2" });
    const pub = await db.prepare("SELECT card_json FROM public_fields WHERE ruling_id = ?").bind(body.rulingId).first<{ card_json: string }>();
    expect(JSON.parse(pub!.card_json).tiles[3].result).toBe("Concern");
  });

  it("quality floor: refuses a draft whose 'yes' answer cites no source", async () => {
    const b = sourced(usdcDraft);
    delete b.evidence["ZERO-1"];
    const res = await rawPost("/analyst/drafts", b);
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toMatch(/ZERO-1/);
  });

  it("quality floor: refuses a draft resting on fewer than two web sources, or a web source without an access date", async () => {
    const one = { ...usdcDraft, evidence: { "ZERO-1": { evidence: "Site", sourceUrl: "https://www.circle.com/usdc", accessedAt: "2026-11-25" },
      "REWARD-2": { evidence: "Same site", sourceUrl: "https://www.circle.com/usdc", accessedAt: "2026-11-25" } } };
    const r1 = await rawPost("/analyst/drafts", one);
    expect(r1.status).toBe(422);
    expect(((await r1.json()) as any).error).toMatch(/two/);
    const b = sourced(usdcDraft);
    b.evidence["ZERO-1"] = { evidence: "Site", sourceUrl: "https://www.circle.com/usdc" };
    const r2 = await rawPost("/analyst/drafts", b);
    expect(r2.status).toBe(422);
    expect(((await r2.json()) as any).error).toMatch(/access date/);
  });

  it("quality floor: the Scholar's answered question counts as the source for a 'yes'", async () => {
    await db.prepare("INSERT OR IGNORE INTO questions (id, asset_id, question, answer, answered_at) VALUES ('Q-src', 'SCCF-0104', 'Reward?', 'Not halal', '2026-11-24')").run();
    const ok = sourced(usdcDraft);
    ok.evidence["REWARD-2"] = { evidence: "The Scholar's answer", sourceUrl: "scholar-answer:Q-src" };
    expect((await rawPost("/analyst/drafts", ok)).status).toBe(201);
    const bad = sourced(usdcDraft);
    bad.evidence["REWARD-2"] = { evidence: "No such answer", sourceUrl: "scholar-answer:Q-nope" };
    expect((await rawPost("/analyst/drafts", bad)).status).toBe(422);
  });

  it("standard record: a draft must give what it is, why, and how to use it", async () => {
    const res = await post("/analyst/drafts", { ...usdcDraft, publicFields: { what: "a dollar stablecoin backed by reserves" } });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toMatch(/why/);
  });

  it("records the token's networks and contract addresses, once each", async () => {
    await db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class) VALUES ('SCCF-0211', 'Net Coin', 'NET', 'FIAT')").run();
    const networks = [{ network: "Ethereum", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }, { network: "Solana", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }];
    expect((await post("/analyst/drafts", { ...usdcDraft, assetId: "SCCF-0211", networks })).status).toBe(201);
    expect((await post("/analyst/drafts", { ...usdcDraft, assetId: "SCCF-0211", networks })).status).toBe(201);
    const rows = await db.prepare("SELECT network, address FROM network_addresses WHERE asset_id = 'SCCF-0211' ORDER BY network").all();
    expect(rows.results).toEqual(networks);
    expect((await post("/analyst/drafts", { ...usdcDraft, assetId: "SCCF-0211", networks: [{ network: "", address: "x" }] })).status).toBe(422);
  });

  it("refuses a draft whose public text leaks", async () => {
    const res = await post("/analyst/drafts", { ...usdcDraft, publicFields: { ...usdcDraft.publicFields, why: "It is H2 under SCCF v2." } });
    expect(res.status).toBe(422);
  });

  it("refuses a draft that routes to another table", async () => {
    const res = await post("/analyst/drafts", { ...usdcDraft, answers: { ...ZERO_OK, "FIAT-1": "no", "FIAT-2": "yes" } });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toMatch(/CRYPTO/);
  });

  it("no analyst route can create a signature", async () => {
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM signatures").first<{ n: number }>())!.n;
    const draft = (await (await post("/analyst/drafts", usdcDraft)).json()) as any;
    await post("/analyst/events", { assetId: "SCCF-0104", rulingId: draft.rulingId, type: "Trigger", detail: "Reserve report published" });
    expect((await post("/analyst/events", { assetId: "SCCF-0104", rulingId: draft.rulingId, type: "Approval" })).status).toBe(422);
    expect((await post("/analyst/signatures", { rulingId: draft.rulingId })).status).toBe(404);
    expect((await post(`/analyst/drafts/${draft.rulingId}/approve`, {})).status).toBe(404);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM signatures").first<{ n: number }>())!.n).toBe(before);
  });

  it("stores a question for the Scholar", async () => {
    const res = await post("/analyst/questions", { assetId: "SCCF-0200", question: "Is DOGE still mainly speculative?", options: ["Yes", "No"] });
    expect(res.status).toBe(201);
    const q = await db.prepare("SELECT question, options_json FROM questions WHERE asset_id = 'SCCF-0200'").first();
    expect(q).toEqual({ question: "Is DOGE still mainly speculative?", options_json: '["Yes","No"]' });
  });

  it("refuses a draft without the ZERO answers", async () => {
    const { "ZERO-3": _drop, ...partial } = usdcDraft.answers;
    const res = await post("/analyst/drafts", { ...usdcDraft, answers: partial });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toMatch(/ZERO-3/);
  });

  it("a pure-hype token stops at ZERO-3: Haram R7, whatever its class table says", async () => {
    const res = await post("/analyst/drafts", { ...usdcDraft, answers: { ...usdcDraft.answers, "ZERO-3": "yes" } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect([body.status, body.code, body.decidingCheckId]).toEqual(["Haram", "R7", "ZERO-3"]);
  });

  it("an unidentified token stops at ZERO-1: Doubtful D1", async () => {
    const res = await post("/analyst/drafts", { ...usdcDraft, answers: { ...usdcDraft.answers, "ZERO-1": "not_found" } });
    const body = (await res.json()) as any;
    expect([body.status, body.code, body.decidingCheckId]).toEqual(["Doubtful", "D1", "ZERO-1"]);
  });

  it("a bridged copy must be submitted through WRAP", async () => {
    const res = await post("/analyst/drafts", { ...usdcDraft, answers: { ...usdcDraft.answers, "ZERO-2": "yes" } });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toMatch(/WRAP/);
  });

  it("serves the live catalog so the analyst can read each section's checks", async () => {
    const all = (await (await call("/analyst/catalog")).json()) as any;
    expect(all.version).toBe("1.0");
    const liveFiat = (fixture as any).checks
      .filter((c: any) => c.id.startsWith("FIAT-") && !/^(Dropped|Replaced)/.test(c.type ?? ""))
      .map((c: any) => c.id);
    expect(all.sections.FIAT.map((c: any) => c.id)).toEqual(liveFiat);
    expect(all.sections.FIAT.map((c: any) => c.id)).toContain("FIAT-6");
    expect(Object.keys(all.sections.FIAT[0]).sort()).toEqual(["id", "ifNotFound", "ifYes", "judgment", "question", "type"]);
    const some = (await (await call("/analyst/catalog?section=ZERO,FIAT")).json()) as any;
    expect(Object.keys(some.sections).sort()).toEqual(["FIAT", "ZERO"]);
    expect((await app.request("/analyst/catalog", {}, env)).status).toBe(401);
  });

  it("the analyst reads answered questions and marks them applied", async () => {
    await db.prepare("INSERT OR IGNORE INTO questions (id, asset_id, question, answer, answered_at) VALUES ('Q-A', 'SCCF-0104', 'Class?', 'UTIL', '2026-11-24')").run();
    await db.prepare("INSERT OR IGNORE INTO questions (id, asset_id, question) VALUES ('Q-B', 'SCCF-0104', 'Open one')").run();
    const before = (await (await call("/analyst/answers")).json()) as any[];
    expect(before.map((q) => q.id)).toContain("Q-A");
    expect(before.map((q) => q.id)).not.toContain("Q-B");
    expect((await post("/analyst/questions/Q-A/applied", {})).status).toBe(200);
    const after = (await (await call("/analyst/answers")).json()) as any[];
    expect(after.map((q) => q.id)).not.toContain("Q-A");
  });

  it("each answer carries the token's latest ruling, so a redraft can name what it replaces", async () => {
    await db.prepare("INSERT OR IGNORE INTO questions (id, asset_id, question, answer, answered_at) VALUES ('Q-L', 'SCCF-0104', 'Again?', 'Yes', '2026-11-25')").run();
    const latest = await db.prepare("SELECT id FROM rulings WHERE asset_id = 'SCCF-0104' ORDER BY created_at DESC, rowid DESC LIMIT 1").first<{ id: string }>();
    const ans = ((await (await call("/analyst/answers")).json()) as any[]).find((q) => q.id === "Q-L");
    expect(ans.latestRulingId).toBe(latest!.id);
  });

  it("a redraft that names nothing is linked to the token's open draft, and stays a First review while nothing is approved", async () => {
    await db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class) VALUES ('SCCF-0210', 'Redraft Coin', 'RDC', 'FIAT')").run();
    const first = (await (await post("/analyst/drafts", { ...usdcDraft, assetId: "SCCF-0210" })).json()) as any;
    const second = (await (await post("/analyst/drafts", { ...usdcDraft, assetId: "SCCF-0210" })).json()) as any;
    const row = await db.prepare("SELECT supersedes, review_type FROM rulings WHERE id = ?").bind(second.rulingId).first();
    expect(row).toEqual({ supersedes: first.rulingId, review_type: "First" });
  });

  it("lists open requests", async () => {
    await db.prepare("INSERT OR IGNORE INTO requests (id, type, at) VALUES ('req-1', 'next-batch', '2026-11-19')").run();
    await db.prepare("INSERT OR IGNORE INTO requests (id, type, at, status) VALUES ('req-2', 'run', '2026-11-18', 'done')").run();
    const body = (await (await call("/analyst/requests")).json()) as any[];
    expect(body.map((r) => r.id)).toEqual(["req-1"]);
  });

  it("with no market ranks yet, the queue falls back to register order", async () => {
    const body = (await (await call("/analyst/queue")).json()) as any;
    expect(body.firstReviews.map((a: any) => a.id)).toEqual(["SCCF-0200", "SCCF-0201", "SCCF-0202", "SCCF-0203"]);
  });

  it("the queue puts the highest market cap first, matching by CoinMarketCap id (a ticker clash with another id does not count)", async () => {
    await post("/analyst/snapshot", {
      listings: [
        { id: 1027, symbol: "ETH", name: "Ethereum", cmc_rank: 2 },
        { id: 99999, symbol: "UNI", name: "Unrelated Uni", cmc_rank: 3 },
        { id: 5426, symbol: "SOL", name: "Solana", cmc_rank: 5 },
        { id: 74, symbol: "DOGE", name: "Dogecoin", cmc_rank: 9 },
      ],
    });
    const body = (await (await call("/analyst/queue")).json()) as any;
    expect(body.firstReviews.map((a: any) => a.id)).toEqual(["SCCF-0201", "SCCF-0203", "SCCF-0200", "SCCF-0202"]);
  });

  it("after a snapshot, unlisted assets are queued in rank order", async () => {
    const res = await post("/analyst/snapshot", {
      listings: [
        { id: 1, symbol: "BTC", name: "Bitcoin", cmc_rank: 1 },
        { id: 1027, symbol: "ETH", name: "Ethereum", cmc_rank: 2 },
        { id: 52, symbol: "XRP", name: "XRP", cmc_rank: 4 },
        { id: 825, symbol: "USDT", name: "Tether", cmc_rank: 3 },
      ],
    });
    expect(res.status).toBe(201);
    const body = (await (await call("/analyst/queue")).json()) as any;
    expect(body.unlisted.map((a: any) => a.symbol)).toEqual(["BTC", "USDT", "XRP"]);
  });

  it("lists re-reviews due within 30 days", async () => {
    await db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class, next_review) VALUES ('SCCF-0300', 'Due Soon', 'DUE', 'UTIL', date('now', '+10 days'))").run();
    await db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class, next_review) VALUES ('SCCF-0301', 'Later', 'LATE', 'UTIL', date('now', '+90 days'))").run();
    const body = (await (await call("/analyst/queue")).json()) as any;
    expect(body.reReviews.map((a: any) => a.id)).toEqual(["SCCF-0300"]);
  });
  it("registers a new asset from the market list with the next SCCF id", async () => {
    const res = await post("/analyst/assets", { cmcId: "52", name: "XRP", ticker: "XRP", class: "NATIVE", coingeckoId: "ripple" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.id).toMatch(/^SCCF-\d{4}$/);
    const max = await db.prepare("SELECT MAX(id) AS m FROM assets WHERE id != ?").bind(body.id).first<{ m: string }>();
    expect(Number(body.id.slice(5))).toBe(Number(max!.m.slice(5)) + 1);
    expect((await post("/analyst/assets", { cmcId: "52", name: "XRP", ticker: "XRP", class: "NATIVE" })).status).toBe(409);
    expect((await post("/analyst/assets", { name: "No class", ticker: "NC" })).status).toBe(422);
    expect((await post("/analyst/assets", { name: "Bad", ticker: "BAD", class: "NOPE" })).status).toBe(422);
  });

  it("with a frozen wave, the queue follows the wave's ranks, lists its unregistered tokens, and puts top-100 newcomers in the fast lane", async () => {
    await db.batch([
      db.prepare("INSERT INTO waves (id, frozen_at, size, snapshot_at) VALUES (1, '2026-11-24T10:00:00Z', 3, '2026-11-24T03:17:00Z')"),
      db.prepare("INSERT INTO wave_items (wave, rank, cmc_id, symbol, name) VALUES (1, 2, '1027', 'ETH', 'Ethereum')"),
      db.prepare("INSERT INTO wave_items (wave, rank, cmc_id, symbol, name) VALUES (1, 5, '777', 'NTK', 'Newtoken')"),
      db.prepare("INSERT INTO wave_items (wave, rank, cmc_id, symbol, name) VALUES (1, 9, '74', 'DOGE', 'Dogecoin')"),
    ]);
    const nights = [1, 2, 3, 4, 5, 6, 7].map((d) => `2099-01-0${d}T03:17:00Z`);
    await db.batch(nights.flatMap((at, i) => [
      db.prepare("INSERT INTO market_snapshots (taken_at, cmc_id, symbol, name, rank) VALUES (?, '1027', 'ETH', 'Ethereum', 2)").bind(at),
      db.prepare("INSERT INTO market_snapshots (taken_at, cmc_id, symbol, name, rank) VALUES (?, '888', 'HOT', 'Hot Coin', 50)").bind(at),
      db.prepare("INSERT INTO market_snapshots (taken_at, cmc_id, symbol, name, rank) VALUES (?, '999', 'LATE', 'Late Coin', 150)").bind(at),
      ...(i === 6 ? [db.prepare("INSERT INTO market_snapshots (taken_at, cmc_id, symbol, name, rank) VALUES (?, '4242', 'BLIP', 'Blip', 40)").bind(at)] : []),
    ]));
    const q = (await (await call("/analyst/queue")).json()) as any;
    expect(q.firstReviews.slice(0, 2).map((a: any) => a.id)).toEqual(["SCCF-0201", "SCCF-0200"]);
    expect(q.unlisted.map((a: any) => a.symbol)).toEqual(["NTK"]);
    expect(q.fastLane.map((a: any) => a.symbol)).toEqual(["HOT"]);
  });

  it("the Scholar's token requests come first in the queue and can be marked done", async () => {
    await db.prepare("INSERT INTO requests (id, type, text, at) VALUES ('tok-1', 'scholar-token', 'USD1 (USD1): from the WLFI answer', '2026-11-24')").run();
    const q = (await (await call("/analyst/queue")).json()) as any;
    expect(q.requests.map((r: any) => r.id)).toEqual(["tok-1"]);
    expect((await post("/analyst/requests/tok-1/done", { result: "Registered as SCCF-0166 and drafted" })).status).toBe(200);
    expect(((await (await call("/analyst/queue")).json()) as any).requests).toEqual([]);
    expect((await post("/analyst/requests/nope/done", {})).status).toBe(422);
  });
});

describe("CoinMarketCap client", () => {
  it("fetchListings sends the key and returns id, symbol, name and rank", async () => {
    let seen: Request | undefined;
    const fake = async (req: Request) => {
      seen = req;
      return Response.json({ data: [{ id: 1, symbol: "BTC", name: "Bitcoin", cmc_rank: 1, quote: {} }] });
    };
    expect(await fetchListings("k-123", 200, fake)).toEqual([{ id: 1, symbol: "BTC", name: "Bitcoin", cmc_rank: 1 }]);
    expect(seen!.headers.get("X-CMC_PRO_API_KEY")).toBe("k-123");
    expect(new URL(seen!.url).searchParams.get("limit")).toBe("200");
  });

  it("fetchInfo returns identity and contract addresses", async () => {
    const fake = async () => Response.json({ data: { "3408": { id: 3408, name: "USDC", symbol: "USDC", slug: "usd-coin",
      urls: { website: ["https://www.circle.com"] },
      contract_address: [{ contract_address: "0xa0b8", platform: { name: "Ethereum" } }] } } });
    expect(await fetchInfo("k", [3408], fake)).toEqual({
      "3408": { id: 3408, name: "USDC", symbol: "USDC", slug: "usd-coin", website: "https://www.circle.com", contracts: [{ chain: "Ethereum", address: "0xa0b8" }] },
    });
  });

  it("a CoinMarketCap error is thrown, not stored", async () => {
    const fake = async () => new Response("nope", { status: 401 });
    await expect(fetchListings("bad", 10, fake)).rejects.toThrow(/401/);
  });
});

describe("wrapped tokens take the underlying's ruling", () => {
  beforeAll(async () => {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class) VALUES ('SCCF-0013', 'Bitcoin', 'BTC', 'NATIVE')"),
      db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class) VALUES ('SCCF-0113', 'Wrapped Bitcoin', 'WBTC', 'WRAP')"),
      db.prepare("INSERT OR IGNORE INTO rulings (id, asset_id, criteria_version, status, code, created_at) VALUES ('BTC-1', 'SCCF-0013', '1.0', 'Halal', 'H1', '2026-10-30')"),
      db.prepare("INSERT INTO signatures (ruling_id, role, by_whom, at) VALUES ('BTC-1', 'approved', 'Dr. Farrukh Habib', '2026-10-30T00:00:00Z')"),
    ]);
  });
  const wbtc = {
    assetId: "SCCF-0113", section: "WRAP", confidence: "Medium", underlyingAssetId: "SCCF-0013",
    answers: { ...ZERO_WRAP, "WRAP-1": "no", "WRAP-2": "no", "WRAP-3": "no", "WRAP-4": "no", "WRAP-OUT": "no" },
    publicFields: { what: "a version of bitcoin on Ethereum, backed one-for-one", why: "It takes the ruling of bitcoin itself.", how: "Hold and use it as you would bitcoin." },
  };

  it("WRAP-5 stores the underlying's approved status and code", async () => {
    const res = await post("/analyst/drafts", wbtc);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ status: "Halal", code: "H1", decidingCheckId: "WRAP-5" });
    const card = JSON.parse((await db.prepare("SELECT card_json FROM public_fields WHERE ruling_id = ?").bind(body.rulingId).first<{ card_json: string }>())!.card_json);
    expect(card.tiles.every((t: any) => t.line.length > 0)).toBe(true);
  });

  it("WRAP-4 takes the stricter of the underlying and the added feature", async () => {
    const res = await post("/analyst/drafts", { ...wbtc, answers: { ...wbtc.answers, "WRAP-4": "yes" }, feature: { section: "LST", answers: { "LST-1": "yes" } } });
    expect(res.status).toBe(201);
    expect((await res.json()) as any).toMatchObject({ status: "Haram", code: "R1", decidingCheckId: "WRAP-4" });
  });

  it("refuses a wrapped token whose underlying has no approved ruling", async () => {
    const res = await post("/analyst/drafts", { ...wbtc, underlyingAssetId: "SCCF-0104" });
    expect(res.status).toBe(422);
  });
});

it("refuses a re-review that supersedes another asset's ruling", async () => {
  const res = await post("/analyst/drafts", { ...usdcDraft, supersedes: "BTC-1" });
  expect(res.status).toBe(422);
  expect(((await res.json()) as any).error).toMatch(/supersedes/);
});
