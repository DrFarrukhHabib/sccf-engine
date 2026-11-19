import type { CatalogFile } from "./load";

export const q = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`;

/** One SQL script that loads a catalog version, for `wrangler d1 execute --file`. */
export function catalogToSql(file: CatalogFile, approvedAt = new Date().toISOString()): string {
  const lines = [
    `INSERT OR IGNORE INTO criteria_versions (version, approved_at, notes) VALUES (${q(file.version)}, ${q(approvedAt)}, ${q(file.source)})`,
    ...file.checks.map(
      (c, i) =>
        `INSERT OR REPLACE INTO catalog_checks (id, version, position, section, type, question, if_yes, if_not_found, evidence, re_review, tile, public_line, judgment) VALUES (${[
          c.id, file.version, i + 1, c.section, c.type, c.question, c.ifYes, c.ifNotFound,
          c.evidence, c.reReview ? 1 : 0, c.tile, c.publicLine, c.judgment ? 1 : 0,
        ].map(q).join(", ")})`,
    ),
  ];
  return lines.join(";\n") + ";\n";
}
