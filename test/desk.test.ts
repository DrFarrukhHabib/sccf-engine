import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { createDesk } from "../src/routes/desk";
import { approve, isPublic } from "../src/review/approve";
import { hashKey } from "../src/auth/keys";

const db = env.DB;
const ORIGIN = "https://engine.example";
const CFG = { teamDomain: "test.cloudflareaccess.com", aud: "test-aud", email: "scholar@example.com" };
let jwk: JsonWebKey;
let privateKey: CryptoKey;

const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function token(claims: Record<string, unknown> = {}, key = privateKey, kid = "k1") {
  const head = enc({ alg: "RS256", kid });
  const body = enc({ aud: [CFG.aud], iss: `https://${CFG.teamDomain}`, email: CFG.email, exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

let app: Hono<any>;
async function desk(path: string, init: RequestInit & { jwt?: string | null } = {}) {
  const jwt = init.jwt === undefined ? await token() : init.jwt;
  const headers: Record<string, string> = { Origin: ORIGIN, ...(init.headers as Record<string, string>) };
  if (jwt) headers["Cf-Access-Jwt-Assertion"] = jwt;
  return app.request(`${ORIGIN}${path}`, { ...init, headers }, env);
}
const form = (data: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(data), headers: { "Content-Type": "application/x-www-form-urlencoded" } });

async function ruling(id: string, over: { supersedes?: string; code?: string } = {}) {
  await db.prepare(`INSERT INTO rulings (id, asset_id, criteria_version, status, code, confidence, review_type, deciding_check, supersedes, created_at)
    VALUES (?, 'SCCF-0104', '1.0', 'Halal', ?, 'High', ?, 'FIAT-6', ?, '2026-11-19')`).bind(id, over.code ?? "H2", over.supersedes ? "Re-review" : "First", over.supersedes ?? null).run();
}
const answer = (id: string, check: string, a: string) =>
  db.prepare("INSERT INTO ruling_checks (ruling_id, check_id, answer) VALUES (?, ?, ?)").bind(id, check, a).run();

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  jwk = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid: "k1" } as JsonWebKey;
  app = new Hono().route("/desk", createDesk({ config: () => CFG, keys: async () => [jwk] }));
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO criteria_versions (version, approved_at) VALUES ('1.0', '2026-11-19')"),
    db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class) VALUES ('SCCF-0104', 'USD Coin', 'USDC', 'FIAT')"),
  ]);
});

describe("Cloudflare Access", () => {
  it("no Access token gives 403", async () => {
    expect((await desk("/desk/queue", { jwt: null })).status).toBe(403);
  });

  it("a forged, expired, wrong-audience or wrong-person token gives 403", async () => {
    const other = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
    )) as CryptoKeyPair;
    for (const jwt of [
      await token({}, other.privateKey),
      await token({ exp: Math.floor(Date.now() / 1000) - 10 }),
      await token({ aud: ["someone-else"] }),
      await token({ email: "intruder@example.com" }),
      "not.a.jwt",
    ]) expect((await desk("/desk/queue", { jwt })).status).toBe(403);
  });

  it("the Scholar's token gets in", async () => {
    expect((await desk("/desk/queue")).status).toBe(200);
  });

  it("a form post from another site is refused", async () => {
    await ruling("D-csrf");
    const res = await desk("/desk/rulings/D-csrf/approve", { ...form({}), headers: { ...form({}).headers, Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await isPublic(db, "D-csrf")).toBe(false);
  });
});

describe("desk pages", () => {
  it("the queue lists drafts and returned items, not approved ones", async () => {
    await ruling("D-draft");
    await ruling("D-done");
    await approve(db, "D-done", "Shariah Scholar");
    await ruling("D-back");
    await desk("/desk/rulings/D-back/return", form({ note: "Check the reward terms" }));
    const html = await (await desk("/desk/queue")).text();
    expect(html).toContain("D-draft");
    expect(html).toContain("D-back");
    expect(html).toContain("Check the reward terms");
    expect(html).not.toContain("D-done");
  });

  it("approve from the desk makes the ruling public", async () => {
    await ruling("D-approve");
    const res = await desk("/desk/rulings/D-approve/approve", form({}));
    expect(res.status).toBe(303);
    expect(await isPublic(db, "D-approve")).toBe(true);
  });

  it("return without a note is refused", async () => {
    await ruling("D-nonote");
    expect((await desk("/desk/rulings/D-nonote/return", form({ note: " " }))).status).toBe(422);
  });

  it("a re-review shows only the changed checks", async () => {
    await ruling("D-prev");
    await answer("D-prev", "FIAT-1", "no");
    await answer("D-prev", "FIAT-4", "no");
    await approve(db, "D-prev", "Shariah Scholar");
    await ruling("D-new", { supersedes: "D-prev" });
    await answer("D-new", "FIAT-1", "no");
    await answer("D-new", "FIAT-4", "not_found");
    const html = await (await desk("/desk/rulings/D-new")).text();
    const changes = html.slice(html.indexOf('id="changes"'), html.indexOf("</table>", html.indexOf('id="changes"')));
    expect(changes).toContain("FIAT-4");
    expect(changes).not.toContain("FIAT-1");
  });

  it("creating a client key shows it once and stores only its hash", async () => {
    const html = await (await desk("/desk/keys", form({ name: "Najm", preliminary: "on" }))).text();
    const key = html.match(/sccf_[A-Za-z0-9_-]{43}/)?.[0];
    expect(key).toBeDefined();
    const row = await db.prepare("SELECT key_hash, preliminary FROM api_clients WHERE name = 'Najm'").first<{ key_hash: string; preliminary: number }>();
    expect(row).toEqual({ key_hash: await hashKey(key!), preliminary: 1 });
    expect(JSON.stringify(await db.prepare("SELECT * FROM api_clients").all())).not.toContain(key!);
    expect(await (await desk("/desk/keys")).text()).not.toContain(key!);
  });

  it("the card page renders the public card and internal fields, with print styles", async () => {
    await ruling("D-card");
    await db.prepare("INSERT INTO public_fields (ruling_id, what, card_json) VALUES ('D-card', 'a dollar stablecoin', ?)").bind(JSON.stringify({
      statusLabel: "Halal", usageLine: "Exchange it on the spot.",
      tiles: [{ title: "Is it an asset?", result: "Pass", line: "Yes." }, { title: "What it is", result: "Pass", line: "What it is: a dollar stablecoin." },
        { title: "Core Shariah test", result: "Pass", line: "Permissible." }, { title: "Rewards and use", result: "Pass", line: "No special conditions on rewards or use." }],
      activity: { hold: "Yes", buySell: "Spot only", payments: "Yes", rewards: "-", lend: "No (riba)", liquidity: "Yes" },
      footer: "Preliminary: prepared with AI. Powered by Azka Advisors.",
    })).run();
    const html = await (await desk("/desk/rulings/D-card/card")).text();
    expect(html).toContain("Is it an asset?");
    expect(html).toContain("Powered by Azka Advisors.");
    expect(html).toContain("@media print");
    expect(html).toContain("H2");
  });

  it("the questions page has an answer box for open questions, and an answer is saved", async () => {
    await db.prepare("INSERT OR IGNORE INTO questions (id, asset_id, question, context, options_json) VALUES ('Q-1', 'SCCF-0104', 'Which class?', 'Some context', '[\"EXCH\",\"UTIL\"]')").run();
    const page = await (await desk("/desk/questions")).text();
    expect(page).toContain('action="/desk/questions/Q-1/answer"');
    expect(page).toContain("<textarea");
    expect(page).toContain("Some context");
    expect(page).toContain("EXCH");
    const res = await desk("/desk/questions/Q-1/answer", form({ answer: "UTIL" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/desk/questions");
    const row = await db.prepare("SELECT answer FROM questions WHERE id = 'Q-1'").first<{ answer: string }>();
    expect(row?.answer).toBe("UTIL");
    expect(await (await desk("/desk/questions")).text()).not.toContain('action="/desk/questions/Q-1/answer"');
  });

  const draft = (id: string, asset: string, status: string, code: string, confidence = "High") =>
    db.prepare(`INSERT INTO rulings (id, asset_id, criteria_version, status, code, confidence, review_type, deciding_check, created_at)
      VALUES (?, ?, '1.0', ?, ?, ?, 'First', 'EXCH-1', '2026-11-24')`).bind(id, asset, status, code, confidence).run();

  it("the queue is a To do list: questions first, then changed drafts, then matching ones", async () => {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class, old_status, old_code) VALUES ('SCCF-0901', 'Match Coin', 'MAT', 'UTIL', 'Halal', 'H1')"),
      db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class, old_status, old_code) VALUES ('SCCF-0902', 'Change Coin', 'CHG', 'EXCH', 'Halal', 'H1')"),
      db.prepare("INSERT OR IGNORE INTO questions (id, asset_id, question) VALUES ('Q-todo', 'SCCF-0902', 'Which table?')"),
    ]);
    await draft("D-match", "SCCF-0901", "Halal", "H1");
    await draft("D-change", "SCCF-0902", "Haram", "R1");
    const html = await (await desk("/desk/queue")).text();
    const at = (t: string) => html.indexOf(t);
    expect(at("Which table?")).toBeGreaterThan(-1);
    expect(at("Which table?")).toBeLessThan(at("D-change"));
    expect(at("D-change")).toBeLessThan(at("D-match"));
    expect(html).toContain("Halal → Haram");
    expect(html).toContain("Same as before");
  });

  it("Approve all matching approves only High-confidence matches with no open question", async () => {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class, old_status, old_code) VALUES ('SCCF-0903', 'Asked Coin', 'ASK', 'UTIL', 'Halal', 'H1')"),
      db.prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class, old_status, old_code) VALUES ('SCCF-0904', 'Unsure Coin', 'UNS', 'UTIL', 'Halal', 'H1')"),
      db.prepare("INSERT OR IGNORE INTO questions (id, asset_id, question) VALUES ('Q-ask', 'SCCF-0903', 'Open point')"),
    ]);
    await draft("D-asked", "SCCF-0903", "Halal", "H1");
    await draft("D-unsure", "SCCF-0904", "Halal", "H1", "Medium");
    const res = await desk("/desk/approve-matching", form({}));
    expect(res.status).toBe(303);
    expect(await isPublic(db, "D-match")).toBe(true);
    for (const id of ["D-change", "D-asked", "D-unsure"]) expect(await isPublic(db, id)).toBe(false);
  });

  it("a draft page compares with the old system, shows its open question with an answer box, and links back", async () => {
    const html = await (await desk("/desk/rulings/D-change")).text();
    expect(html).toContain("Old system");
    expect(html).toContain('href="/desk/queue"');
    expect(html).toContain('action="/desk/questions/Q-todo/answer"');
    const res = await desk("/desk/questions/Q-todo/answer", form({ answer: "EXCH", back: "/desk/rulings/D-change" }));
    expect(res.headers.get("Location")).toBe("/desk/rulings/D-change");
    const off = await desk("/desk/questions/Q-ask/answer", form({ answer: "x", back: "https://evil.example/" }));
    expect(off.headers.get("Location")).toBe("/desk/questions");
  });

  it("every page has the menu, including Approved", async () => {
    for (const p of ["/desk/queue", "/desk/questions", "/desk/library", "/desk/rules", "/desk/keys"]) {
      expect(await (await desk(p)).text()).toContain('href="/desk/library"');
    }
  });

  it("a rule proposal can be approved or rejected from the desk, once", async () => {
    await db.prepare("INSERT OR IGNORE INTO rule_proposals (id, title, proposed) VALUES ('rp-1', 'Test rule', 'New wording')").run();
    expect(await (await desk("/desk/rules")).text()).toContain('action="/desk/rules/rp-1/decide"');
    const res = await desk("/desk/rules/rp-1/decide", form({ decision: "approved", note: "Agreed" }));
    expect(res.status).toBe(303);
    const row = await db.prepare("SELECT decision, note FROM rule_proposals WHERE id = 'rp-1'").first<{ decision: string; note: string }>();
    expect(row).toEqual({ decision: "approved", note: "Agreed" });
    expect((await desk("/desk/rules/rp-1/decide", form({ decision: "rejected" }))).status).toBe(303);
    expect((await db.prepare("SELECT decision FROM rule_proposals WHERE id = 'rp-1'").first<{ decision: string }>())?.decision).toBe("approved");
    expect((await desk("/desk/rules/rp-1/decide", form({ decision: "maybe" }))).status).toBe(422);
  });

  it("each offered option is a clickable button that fills the answer box, plus an Other choice", async () => {
    await db.prepare("INSERT OR IGNORE INTO questions (id, asset_id, question, options_json) VALUES ('Q-chips', 'SCCF-0104', 'Pick one', '[\"Halal H2 (row 5)\",\"Haram R2\"]')").run();
    const page = await (await desk("/desk/questions")).text();
    expect(page).toContain('data-fill="Halal H2 (row 5)"');
    expect(page).toContain('data-fill="Haram R2"');
    expect(page).toContain('data-other');
    expect(page).toMatch(/<script>[^<]*data-fill/);
  });

  it("lists questions, rule proposals and the library", async () => {
    for (const p of ["/desk/questions", "/desk/rules", "/desk/library"]) expect((await desk(p)).status).toBe(200);
  });
});
