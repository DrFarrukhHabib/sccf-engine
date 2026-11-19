import type { Catalog, Check, SectionKey } from "../catalog/load";
import type { Outcome } from "../rules/derive";
import { BY_CLASS, D1, D2_D5, HARAM, strip, type ActivityRow, type MatrixRow } from "./activity";
import { assertPublicSafe } from "./guard";

export type TileResult = "Pass" | "Concern" | "Fail" | "Not assessed" | "Not applicable";
export interface Tile { title: string; result: TileResult; line: string }

export interface PublicCard {
  statusLabel: string;
  usageLine: string;
  tiles: [Tile, Tile, Tile, Tile];
  activity: ActivityRow;
  footer: string;
}

export interface PublicAsset {
  /** The class table that decided the ruling (FIAT, LST, STOCK ...). */
  section: SectionKey;
  /** Tile 2 wording: the class in plain words. */
  whatItIs: string;
  /** ISO date of the Scholar's approval; null while preliminary. */
  approvedAt: string | null;
  lastReviewed: string;
}

const TITLES = ["Is it an asset?", "What it is", "Core Shariah test", "Rewards and use"] as const;
const NOT_ASSESSED = "Not assessed: the ruling is already decided";
const NOT_APPLICABLE = "Not applicable: do not hold this token";
const PASS_LINES = ["Yes. It has value and can be owned and transferred.", "", "No concern was found in its design or business.", "No special conditions on rewards or use."];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** Card footer: approval (or preliminary) line, review date, disclaimer, attribution. */
export const footerFor = (approvedAt: string | null, lastReviewed: string): string =>
  [
    approvedAt
      ? `Approved by a Shariah Scholar on ${longDate(approvedAt)}.`
      : "Preliminary: prepared with AI and not yet reviewed by a Shariah Scholar; it may contain errors.",
    `Last reviewed ${longDate(lastReviewed)}.`,
    "This is a Shariah opinion, not investment advice.",
    "Powered by Azka Advisors.",
  ].join(" ");

const tileNo = (c: Check | undefined) => (c?.tile ? Number(c.tile[0]) : 0);

function findCheck(catalog: Catalog, id: string): Check {
  for (const checks of Object.values(catalog.sections)) {
    const c = checks.find((x) => x.id === id);
    if (c) return c;
  }
  throw new Error(`Unknown check ${id}`);
}

function matrixRow(outcome: Outcome, section: SectionKey): MatrixRow {
  if (outcome.status === "Haram") return HARAM;
  if (outcome.status === "Doubtful") return outcome.code === "D1" ? D1 : D2_D5;
  const r = BY_CLASS[section];
  if (!r) throw new Error(`No activity row for class ${section}`);
  return r;
}

/** The public card for one ruling, built only from catalog lines and the activity matrix. */
export function buildPublic(catalog: Catalog, outcome: Outcome, asset: PublicAsset): PublicCard {
  if (!outcome.status || !outcome.decidingCheckId) throw new Error("Outcome has no status; it cannot be shown publicly");
  const deciding = findCheck(catalog, outcome.decidingCheckId);
  const decidedAt = tileNo(deciding);
  const blocking = outcome.status === "Haram" || outcome.status === "Doubtful";
  const matrix = matrixRow(outcome, asset.section);

  const statusLabel = outcome.code === "R7" ? "Haram: not an asset" : outcome.status;
  const decidedResult: TileResult = outcome.status === "Haram" ? "Fail" : outcome.status === "Doubtful" ? "Concern" : "Pass";

  const tiles = TITLES.map((title, i): Tile => {
    const n = i + 1;
    if (n === decidedAt) return { title, result: decidedResult, line: deciding.publicLine ?? "" };
    if (blocking && n > decidedAt) {
      return n === 4 && outcome.status === "Haram"
        ? { title, result: "Not applicable", line: NOT_APPLICABLE }
        : { title, result: "Not assessed", line: NOT_ASSESSED };
    }
    if (n === 2) return { title, result: "Pass", line: `What it is: ${asset.whatItIs}.` };
    if (n === 4) {
      const flagged = [
        ...outcome.rewardRulings.filter((r) => r.ruling !== "permissible").map((r) => r.checkId),
        ...outcome.useConditions,
      ];
      if (flagged.length === 0) return { title, result: "Pass", line: PASS_LINES[3] };
      return { title, result: "Concern", line: flagged.map((id) => findCheck(catalog, id).publicLine).filter(Boolean).join(" ") };
    }
    return { title, result: "Pass", line: PASS_LINES[i] };
  }) as PublicCard["tiles"];

  const footer = footerFor(asset.approvedAt, asset.lastReviewed);

  const card: PublicCard = { statusLabel, usageLine: matrix.condition, tiles, activity: strip(matrix), footer };
  if (outcome.status === "Haram") card.activity = strip(HARAM);
  assertPublicSafe(JSON.stringify(card));
  return card;
}
