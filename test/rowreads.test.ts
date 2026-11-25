import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "./fixtures/catalog-v1.json";
import { importCatalog } from "../src/catalog/load";
import { WAVE_PROGRESS_SQL } from "../src/waves";

/**
 * Cloudflare's free plan allows 5 million row reads a day. The Top 500 progress bar runs on every load of the
 * To do page, so its query must read a few thousand rows, not hundreds of thousands (25 Nov 2026: 317k per load).
 */
const db = env.DB;
const ITEMS = 300, ASSETS = 200;
const now = new Date().toISOString();

beforeAll(async () => {
  await importCatalog(db, fixture as any);
  const st: D1PreparedStatement[] = [db.prepare("INSERT INTO waves (id, frozen_at, size, snapshot_at) VALUES (1, ?, ?, ?)").bind(now, ITEMS, now)];
  for (let i = 1; i <= ITEMS; i++)
    st.push(db.prepare("INSERT INTO wave_items (wave, rank, cmc_id, symbol, name) VALUES (1, ?, ?, ?, ?)").bind(i, `c${i}`, `T${i}`, `Token ${i}`));
  for (let i = 1; i <= ASSETS; i++) {
    // Even-numbered tokens are registered with their CoinMarketCap id; odd ones by ticker only (lower case on purpose).
    st.push(db.prepare("INSERT INTO assets (id, name, ticker, class, cmc_id) VALUES (?, ?, ?, 'UTIL', ?)")
      .bind(`S-${i}`, `Token ${i}`, i % 2 ? `t${i}` : `T${i}`, i % 2 ? null : `c${i}`));
    if (i <= 150) st.push(db.prepare(`INSERT INTO rulings (id, asset_id, criteria_version, status, code, confidence, deciding_check, prepared_at, created_at)
      VALUES (?, ?, '1.0', 'Halal', 'H1', 'High', 'UTIL-3', ?, ?)`).bind(`R-${i}`, `S-${i}`, now, now));
    if (i <= 100) st.push(db.prepare("INSERT INTO signatures (ruling_id, role, by_whom, at) VALUES (?, 'approved', 'Shariah Scholar', ?)").bind(`R-${i}`, now));
  }
  // Tokens 1-10 were approved and then withdrawn, so they count as drafted, not approved.
  for (let i = 1; i <= 10; i++)
    st.push(db.prepare("INSERT INTO events (asset_id, ruling_id, type, at, detail) VALUES (?, ?, 'Return', ?, 'Withdrawn: test')").bind(`S-${i}`, `R-${i}`, now));
  await db.batch(st);
});

describe("database reads stay within the free plan", () => {
  it("the Top 500 progress counts are right", async () => {
    const r = await db.prepare(WAVE_PROGRESS_SQL).bind(1).first<{ approved: number; drafted: number; total: number }>();
    expect(r).toEqual({ approved: 90, drafted: 60, total: ITEMS });
  });

  it("the Top 500 progress query reads a few thousand rows, not hundreds of thousands", async () => {
    const res = await db.prepare(WAVE_PROGRESS_SQL).bind(1).all();
    expect(res.meta.rows_read).toBeLessThan(20_000);
  });
});

