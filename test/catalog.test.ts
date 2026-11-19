import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "./fixtures/catalog-v1.json";
import { importCatalog, loadCatalog, type Catalog, type Check } from "../src/catalog/load";

let catalog: Catalog;

const isDecision = (c: Check) => /^(Status|Route)/.test(c.type);
const isTerminal = (c: Check) =>
  c.question.startsWith("Otherwise") || c.type.startsWith("Route") || c.ifNotFound === null;

beforeAll(async () => {
  await importCatalog(env.DB, fixture as any);
  catalog = await loadCatalog(env.DB, "1.0");
});

describe("catalog v1.0", () => {
  it("loads version 1.0 with every live check", () => {
    expect(catalog.version).toBe("1.0");
    const all = Object.values(catalog.sections).flat();
    expect(all).toHaveLength(116);
    expect(all.map((c) => c.id)).toContain("NATIVE-R3");
  });

  it("ends every status section in an Otherwise or route row", () => {
    for (const [key, checks] of Object.entries(catalog.sections)) {
      const decisions = checks.filter(isDecision);
      if (decisions.length === 0) continue;
      expect(isTerminal(decisions[decisions.length - 1]), key).toBe(true);
    }
  });

  it("puts a fraud check before the first Halal outcome", () => {
    for (const [key, checks] of Object.entries(catalog.sections)) {
      const firstHalal = checks.findIndex((c) => c.ifYes?.startsWith("Halal"));
      if (firstHalal === -1) continue;
      const fraud = checks.findIndex((c) => c.ifYes === "Doubtful, D5");
      expect(fraud, key).toBeGreaterThanOrEqual(0);
      expect(fraud, key).toBeLessThan(firstHalal);
    }
  });

  it("does not load dropped or replaced checks", () => {
    const ids = Object.values(catalog.sections).flat().map((c) => c.id);
    for (const gone of ["STOCK-4B", "STOCK-4C", "STOCK-4D", "DEBT-2", "SHARE-1", "SHARE-2"]) {
      expect(ids).not.toContain(gone);
    }
  });

  it("uses S1 only in tokenized stocks", () => {
    const s1 = Object.entries(catalog.sections).flatMap(([key, checks]) =>
      checks.filter((c) => c.ifYes?.includes("(S1)")).map(() => key),
    );
    expect(s1.length).toBeGreaterThan(0);
    expect(new Set(s1)).toEqual(new Set(["STOCK"]));
  });

  it("keeps check order within a section", () => {
    expect(catalog.sections.EXCH.map((c) => c.id).slice(4, 6)).toEqual(["EXCH-OUT", "EXCH-5"]);
  });
});

import { catalogToSql } from "../src/catalog/sql";

describe("catalogToSql", () => {
  it("builds SQL that loads the same catalog, apostrophes included", async () => {
    const sql = catalogToSql({ ...(fixture as any), version: "sql-test" });
    expect(sql).toContain("issuer''s reserve interest");
    for (const stmt of sql.split(";\n").filter((s) => s.trim())) await env.DB.prepare(stmt).run();
    const loaded = await loadCatalog(env.DB, "sql-test");
    expect(loaded.sections).toEqual(catalog.sections);
  });
});
