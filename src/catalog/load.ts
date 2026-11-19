export type SectionKey = string;

export interface Check {
  id: string;
  section: string;
  type: string;
  question: string;
  ifYes: string | null;
  ifNotFound: string | null;
  tile: string | null;
  publicLine: string | null;
  judgment: boolean;
  reReview: boolean;
}

export interface Catalog {
  version: string;
  sections: Record<SectionKey, Check[]>;
}

export interface CatalogFile {
  version: string;
  source?: string;
  checks: (Check & { evidence?: string | null })[];
}

/** Section key = the check-ID prefix (ZERO, FIAT, EXCH, STOCK ...). */
export const sectionKey = (id: string): SectionKey => id.split("-")[0];

const RETIRED = /^(Dropped|Replaced)/;

/** Writes one catalog version. Every row is stored, retired ones included, for the record. */
export async function importCatalog(db: D1Database, file: CatalogFile): Promise<void> {
  const stmts = [
    db
      .prepare("INSERT OR IGNORE INTO criteria_versions (version, approved_at, notes) VALUES (?, ?, ?)")
      .bind(file.version, new Date().toISOString(), file.source ?? null),
    ...file.checks.map((c, i) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO catalog_checks
           (id, version, position, section, type, question, if_yes, if_not_found, evidence, re_review, tile, public_line, judgment)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          c.id, file.version, i + 1, c.section, c.type, c.question, c.ifYes ?? null, c.ifNotFound ?? null,
          c.evidence ?? null, c.reReview ? 1 : 0, c.tile ?? null, c.publicLine ?? null, c.judgment ? 1 : 0,
        ),
    ),
  ];
  await db.batch(stmts);
}

interface Row {
  id: string; section: string; type: string; question: string; if_yes: string | null;
  if_not_found: string | null; tile: string | null; public_line: string | null;
  judgment: number; re_review: number;
}

/** Live checks of one version, grouped by section, in catalog order. Retired rows are left out. */
export async function loadCatalog(db: D1Database, version = "1.0"): Promise<Catalog> {
  const { results } = await db
    .prepare("SELECT * FROM catalog_checks WHERE version = ? ORDER BY position")
    .bind(version)
    .all<Row>();
  if (results.length === 0) throw new Error(`Catalog version ${version} is not loaded`);
  const sections: Record<SectionKey, Check[]> = {};
  for (const r of results) {
    if (RETIRED.test(r.type)) continue;
    (sections[sectionKey(r.id)] ??= []).push({
      id: r.id, section: r.section, type: r.type, question: r.question, ifYes: r.if_yes,
      ifNotFound: r.if_not_found, tile: r.tile, publicLine: r.public_line,
      judgment: r.judgment === 1, reReview: r.re_review === 1,
    });
  }
  return { version, sections };
}
