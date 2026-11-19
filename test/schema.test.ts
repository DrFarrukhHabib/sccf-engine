import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:test";

const db = () => env.DB;

async function seed() {
  await db().prepare("INSERT OR IGNORE INTO criteria_versions (version, approved_at) VALUES ('1.0', '2026-11-19')").run();
  await db().prepare("INSERT OR IGNORE INTO assets (id, name, ticker, class) VALUES ('SCCF-0104', 'USDC (Circle)', 'USDC', 'FIAT')").run();
}

let n = 0;
async function insertRuling(id = `R${++n}`) {
  return db()
    .prepare(
      "INSERT INTO rulings (id, asset_id, criteria_version, status, code, created_at) VALUES (?, 'SCCF-0104', '1.0', 'Halal', 'H2', '2026-11-19T00:00:00Z')",
    )
    .bind(id)
    .run();
}

describe("schema", () => {
  beforeEach(seed);

  it("stores a ruling", async () => {
    await insertRuling("STORE");
    const row = await db().prepare("SELECT status, code FROM rulings WHERE id = 'STORE'").first();
    expect(row).toEqual({ status: "Halal", code: "H2" });
  });

  it("refuses to update a ruling", async () => {
    await insertRuling("UPD");
    await expect(db().prepare("UPDATE rulings SET status = 'Haram' WHERE id = 'UPD'").run()).rejects.toThrow(/append-only/);
  });

  it("refuses to delete a signature", async () => {
    await insertRuling("SIG");
    await db()
      .prepare("INSERT INTO signatures (ruling_id, role, by_whom, at) VALUES ('SIG', 'approved', 'Shariah Scholar', '2026-11-19T00:00:00Z')")
      .run();
    await expect(db().prepare("DELETE FROM signatures").run()).rejects.toThrow(/append-only/);
  });

  it("refuses to update or delete an event", async () => {
    await db().prepare("INSERT INTO events (asset_id, type, at) VALUES ('SCCF-0104', 'First', '2026-11-19T00:00:00Z')").run();
    await expect(db().prepare("UPDATE events SET type = 'x'").run()).rejects.toThrow(/append-only/);
    await expect(db().prepare("DELETE FROM events").run()).rejects.toThrow(/append-only/);
  });

  it("refuses a ruling without an asset or criteria version", async () => {
    await expect(
      db().prepare("INSERT INTO rulings (id, criteria_version, status, code, created_at) VALUES ('R2', '1.0', 'Halal', 'H1', 'x')").run(),
    ).rejects.toThrow();
    await expect(
      db().prepare("INSERT INTO rulings (id, asset_id, status, code, created_at) VALUES ('R3', 'SCCF-0104', 'Halal', 'H1', 'x')").run(),
    ).rejects.toThrow();
  });

  it("refuses an unknown status", async () => {
    await expect(
      db().prepare("INSERT INTO rulings (id, asset_id, criteria_version, status, code, created_at) VALUES ('R4', 'SCCF-0104', '1.0', 'Maybe', 'H1', 'x')").run(),
    ).rejects.toThrow();
  });
});
