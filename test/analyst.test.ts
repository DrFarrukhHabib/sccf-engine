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
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });

const usdcDraft = {
  assetId: "SCCF-0104", section: "FIAT", confidence: "High",
  answers: { "FIAT-1": "no", "FIAT-2": "no", "FIAT-3": "no", "FIAT-3B": "no", "FIAT-4": "no" },
  evidence: { "FIAT-1": { evidence: "Circle keeps reserve income", sourceUrl: "https://www.circle.com/transparency" } },
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
    expect(checks.results).toContainEqual({ check_id: "REWARD-2", answer: "yes", source_url: null });
    const pub = await db.prepare("SELECT card_json FROM public_fields WHERE ruling_id = ?").bind(body.rulingId).first<{ card_json: string }>();
    expect(JSON.parse(pub!.card_json).tiles[3].result).toBe("Concern");
  });

  it("refuses a draft whose public text leaks", async () => {
    const res = await post("/analyst/drafts", { ...usdcDraft, publicFields: { ...usdcDraft.publicFields, why: "It is H2 under SCCF v2." } });
    expect(res.status).toBe(422);
  });

  it("refuses a draft that routes to another table", async () => {
    const res = await post("/analyst/drafts", { ...usdcDraft, answers: { "FIAT-1": "no", "FIAT-2": "yes" } });
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

  it("lists open requests", async () => {
    await db.prepare("INSERT OR IGNORE INTO requests (id, type, at) VALUES ('req-1', 'next-batch', '2026-11-19')").run();
    await db.prepare("INSERT OR IGNORE INTO requests (id, type, at, status) VALUES ('req-2', 'run', '2026-11-18', 'done')").run();
    const body = (await (await call("/analyst/requests")).json()) as any[];
    expect(body.map((r) => r.id)).toEqual(["req-1"]);
  });

  it("the queue respects the playbook's class order, then register order", async () => {
    const body = (await (await call("/analyst/queue")).json()) as any;
    expect(body.firstReviews.map((a: any) => a.id)).toEqual(["SCCF-0201", "SCCF-0203", "SCCF-0202", "SCCF-0200"]);
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
    answers: { "WRAP-1": "no", "WRAP-2": "no", "WRAP-3": "no", "WRAP-4": "no", "WRAP-OUT": "no" },
    publicFields: { what: "a version of bitcoin on Ethereum, backed one-for-one" },
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
