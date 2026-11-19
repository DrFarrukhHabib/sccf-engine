import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "./fixtures/catalog-v1.json";
import { importCatalog, loadCatalog, type Catalog } from "../src/catalog/load";
import { deriveOutcome } from "../src/rules/derive";

let catalog: Catalog;
beforeAll(async () => {
  await importCatalog(env.DB, fixture as any);
  catalog = await loadCatalog(env.DB, "1.0");
});

const base = { sendToScholar: false, useConditions: [], rewardRulings: [] };

describe("deriveOutcome", () => {
  it("FIAT: all no gives Halal H2 via FIAT-6", () => {
    expect(deriveOutcome(catalog, "FIAT", { "FIAT-1": "no", "FIAT-2": "no", "FIAT-3": "no", "FIAT-3B": "no", "FIAT-4": "no" }))
      .toEqual({ ...base, status: "Halal", code: "H2", decidingCheckId: "FIAT-6" });
  });

  it("FIAT-3 yes gives Haram R1", () => {
    expect(deriveOutcome(catalog, "FIAT", { "FIAT-1": "no", "FIAT-2": "no", "FIAT-3": "yes" }))
      .toEqual({ ...base, status: "Haram", code: "R1", decidingCheckId: "FIAT-3" });
  });

  it("FIAT-3B yes leaves the coin H2 and marks the reward not halal", () => {
    expect(deriveOutcome(catalog, "FIAT", { "FIAT-1": "no", "FIAT-2": "no", "FIAT-3": "no", "FIAT-3B": "yes", "FIAT-4": "no" }))
      .toEqual({ ...base, status: "Halal", code: "H2", decidingCheckId: "FIAT-6", rewardRulings: [{ checkId: "FIAT-3B", ruling: "not halal" }] });
  });

  it("FIAT-4 not found counts as no", () => {
    const o = deriveOutcome(catalog, "FIAT", { "FIAT-1": "no", "FIAT-2": "no", "FIAT-3": "no", "FIAT-3B": "no", "FIAT-4": "not_found" });
    expect([o.status, o.code, o.decidingCheckId]).toEqual(["Halal", "H2", "FIAT-6"]);
  });

  it("FIAT-1 not found gives Doubtful D1", () => {
    expect(deriveOutcome(catalog, "FIAT", { "FIAT-1": "not_found" }))
      .toEqual({ ...base, status: "Doubtful", code: "D1", decidingCheckId: "FIAT-1" });
  });

  it("unanswered checks count as not found", () => {
    expect(deriveOutcome(catalog, "FIAT", {})).toMatchObject({ status: "Doubtful", code: "D1", decidingCheckId: "FIAT-1" });
  });

  it("LST-1 yes gives Haram R1 (sfrxETH)", () => {
    expect(deriveOutcome(catalog, "LST", { "LST-1": "yes" }))
      .toEqual({ ...base, status: "Haram", code: "R1", decidingCheckId: "LST-1" });
  });

  it("RWA-2 not found goes on to RWA-3 Halal H1", () => {
    expect(deriveOutcome(catalog, "RWA", { "RWA-1": "no", "RWA-2": "not_found", "RWA-OUT": "no" }))
      .toEqual({ ...base, status: "Halal", code: "H1", decidingCheckId: "RWA-3" });
  });

  it("judgment rows answered yes go to the Scholar", () => {
    expect(deriveOutcome(catalog, "NATIVE", { "NATIVE-1": "yes" }, { "NATIVE-1": "R2" }))
      .toEqual({ ...base, status: "Haram", code: "R2", decidingCheckId: "NATIVE-1", sendToScholar: true });
    expect(deriveOutcome(catalog, "EXCH", { "EXCH-1": "yes" }, { "EXCH-1": "R2" }).sendToScholar).toBe(true);
    expect(deriveOutcome(catalog, "MEME", { "MEME-1": "no", "MEME-2": "yes" }))
      .toEqual({ ...base, status: "Doubtful", code: "D3", decidingCheckId: "MEME-2", sendToScholar: true });
  });

  it("a Haram outcome whose code depends on the business needs a code, or goes to the Scholar", () => {
    expect(deriveOutcome(catalog, "LST", { "LST-1": "no", "LST-2": "no", "LST-3": "no", "LST-4": "yes" }))
      .toEqual({ ...base, status: "Haram", code: null, decidingCheckId: "LST-4", sendToScholar: true });
  });

  it("STOCK-1 yes gives Haram R2", () => {
    expect(deriveOutcome(catalog, "STOCK", { "STOCK-1": "yes" }))
      .toEqual({ ...base, status: "Haram", code: "R2", decidingCheckId: "STOCK-1" });
  });

  it("all STOCK checks no gives Check the company (S1)", () => {
    expect(deriveOutcome(catalog, "STOCK", { "STOCK-1": "no", "STOCK-2": "no", "STOCK-3": "no", "STOCK-4A": "no", "STOCK-OUT": "no" }))
      .toEqual({ ...base, status: "Check the company", code: "S1", decidingCheckId: "STOCK-5" });
  });

  it("ZERO-2 yes routes to the wrapped-token table", () => {
    expect(deriveOutcome(catalog, "ZERO", { "ZERO-1": "yes", "ZERO-2": "yes" }))
      .toEqual({ ...base, status: null, code: null, decidingCheckId: "ZERO-2", route: "WRAP" });
  });

  it("ZERO-1 no (cannot identify) gives Doubtful D1", () => {
    expect(deriveOutcome(catalog, "ZERO", { "ZERO-1": "no" })).toMatchObject({ status: "Doubtful", code: "D1", decidingCheckId: "ZERO-1" });
  });

  it("use-condition rows answered yes are collected", () => {
    const o = deriveOutcome(catalog, "NATIVE", { "NATIVE-1": "no", "NATIVE-2": "no", "NATIVE-3": "no", "NATIVE-OUT": "no", "NATIVE-R2": "yes", "NATIVE-R3": "yes" });
    expect(o).toMatchObject({ status: "Halal", code: "H1", decidingCheckId: "NATIVE-4", useConditions: ["NATIVE-R2", "NATIVE-R3"] });
  });

  it("reward tables rule each reward and never the coin", () => {
    expect(deriveOutcome(catalog, "REWARD", { "REWARD-1": "yes", "REWARD-2": "no", "REWARD-3": "not_found" })).toEqual({
      ...base, status: null, code: null, decidingCheckId: null,
      rewardRulings: [{ checkId: "REWARD-1", ruling: "not halal" }, { checkId: "REWARD-3", ruling: "avoid" }],
    });
  });

  it("INS-3 sends an unmatched cover token to the Scholar", () => {
    expect(deriveOutcome(catalog, "INS", { "INS-1": "no", "INS-2": "no" }))
      .toEqual({ ...base, status: null, code: null, decidingCheckId: "INS-3", sendToScholar: true });
  });

  it("an unknown section throws", () => {
    expect(() => deriveOutcome(catalog, "NOPE", {})).toThrow(/NOPE/);
  });
});

describe("catalog coverage", () => {
  it("can read the outcome of every decision row in v1.0, answered yes and not found", () => {
    for (const [key, checks] of Object.entries(catalog.sections)) {
      for (const c of checks) {
        for (const a of ["yes", "not_found"] as const) {
          const answers = Object.fromEntries(checks.map((x) => [x.id, x.id === c.id ? a : "no"])) as Record<string, "yes" | "no" | "not_found">;
          expect(() => deriveOutcome(catalog, key, answers), `${c.id} ${a}`).not.toThrow();
        }
      }
    }
  });
});

it("WRAP-4 yes routes to the underlying and the added feature's table", () => {
  expect(deriveOutcome(catalog, "WRAP", { "WRAP-1": "no", "WRAP-2": "no", "WRAP-3": "no", "WRAP-4": "yes" }))
    .toEqual({ ...base, status: null, code: null, decidingCheckId: "WRAP-4", route: "UNDERLYING_AND_FEATURE" });
});

it("EXCH-1 not found gives Doubtful D1 and goes to the Scholar", () => {
  expect(deriveOutcome(catalog, "EXCH", { "EXCH-1": "not_found" }))
    .toEqual({ ...base, status: "Doubtful", code: "D1", decidingCheckId: "EXCH-1", sendToScholar: true });
});
