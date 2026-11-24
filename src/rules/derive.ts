import type { Catalog, Check, SectionKey } from "../catalog/load";
import type { Answer, Code, Status } from "../db/types";

export type CheckId = string;
export type RewardRuling = "not halal" | "permissible" | "avoid";

export interface Outcome {
  status: Status | null;
  code: Code | null;
  decidingCheckId: CheckId | null;
  /** Another table decides: a section key, "CLASS" (the token's own class), "UNDERLYING" (the wrapped asset), or
   *  "UNDERLYING_AND_FEATURE" (the wrapped asset and the added feature's own table; the stricter result decides). */
  route?: SectionKey;
  sendToScholar: boolean;
  useConditions: CheckId[];
  rewardRulings: { checkId: CheckId; ruling: RewardRuling }[];
}

type Result =
  | { kind: "outcome"; status: Status | null; code: Code | null; scholar?: boolean; route?: SectionKey }
  | { kind: "go_on" };

const CODE = /\b(H[12]|D[1-5]|R[1-57]|S1)\b/g;

/** Reads an "If yes" / "If not found" cell into a result. Wording follows Check Catalog v1.0. */
function readOutcome(text: string): Result {
  // EXCH-1: "A share not found counts as yes; how it presents itself not found: Doubtful, D1".
  // One answer cannot say which limb is missing, so not found takes the D1 limb and goes to the Scholar.
  const twoLimbs = text.match(/counts as yes;.*not found: (.+)$/);
  if (twoLimbs) return { ...(readOutcome(twoLimbs[1]) as Extract<Result, { kind: "outcome" }>), scholar: true };
  const t = text.trim();
  if (/^(No\b|See |Coin not affected)/.test(t)) return { kind: "go_on" };
  if (t.startsWith("Use the wrapped-token table")) return { kind: "outcome", status: null, code: null, route: "WRAP" };
  if (t.startsWith("Use the crypto-backed table")) return { kind: "outcome", status: null, code: null, route: "CRYPTO" };
  if (/^(Use the table for its class|Ruled as its own project|Ruled by its new class)/.test(t))
    return { kind: "outcome", status: null, code: null, route: "CLASS" };
  if (t.startsWith("The underlying's ruling, plus the added feature"))
    return { kind: "outcome", status: null, code: null, route: "UNDERLYING_AND_FEATURE" };
  if (/^Same ruling and code as the underlying/.test(t)) return { kind: "outcome", status: null, code: null, route: "UNDERLYING" };
  if (t.startsWith("To the Shariah Scholar")) return { kind: "outcome", status: null, code: null, scholar: true };

  const status: Status | null = t.includes("(S1)")
    ? "Check the company"
    : /^Halal/.test(t) ? "Halal" : /^Doubtful/.test(t) ? "Doubtful" : /^Haram/.test(t) ? "Haram" : null;
  if (!status) throw new Error(`Unreadable catalog outcome: "${t}"`);
  // Only the code stated before any explanation counts; "(R2, R3 or R4)" or "strictest component's code" is not one code.
  const head = t.split(/[:(]/)[0];
  const codes = [...new Set(head.match(CODE) ?? [])];
  const s1 = status === "Check the company" ? "S1" : null;
  const code = (s1 ?? (codes.length === 1 && !/coded by|strictest|if every/.test(t) ? codes[0] : null)) as Code | null;
  return { kind: "outcome", status, code };
}

const rewardRuling = (text: string): RewardRuling =>
  /not halal|not permissible/i.test(text) ? "not halal" : /avoid|not confirmed/i.test(text) ? "avoid" : "permissible";

const isDecision = (c: Check) => /^(Status|Route)/.test(c.type);
const isReward = (c: Check) => c.type.startsWith("Reward") || /mark the reward/.test(c.ifYes ?? "");
const isUseCondition = (c: Check) => /use condition/.test(c.type);

/**
 * Walks one table: the first "yes" decides. A missing answer counts as not found.
 * `codes` supplies the code where the catalog says "coded by that business" or similar.
 */
export function deriveOutcome(
  catalog: Catalog,
  section: SectionKey,
  answers: Record<CheckId, Answer>,
  codes: Record<CheckId, Code> = {},
): Outcome {
  const checks = catalog.sections[section];
  if (!checks) throw new Error(`Unknown catalog section ${section}`);

  const out: Outcome = { status: null, code: null, decidingCheckId: null, sendToScholar: false, useConditions: [], rewardRulings: [] };

  const answerOf = (c: Check): Answer => (c.question.startsWith("Otherwise") ? "yes" : answers[c.id] ?? "not_found");

  // Use conditions and rewards apply wherever they sit in the table, even after the Otherwise row.
  for (const c of checks) {
    const answer = answerOf(c);
    if (isUseCondition(c)) {
      if (answer === "yes") out.useConditions.push(c.id);
    } else if (isReward(c)) {
      // A reward table's Otherwise row means "none of the rows above": skip it once an earlier row matched.
      if (c.question.startsWith("Otherwise") && out.rewardRulings.some((r) => r.ruling !== "avoid")) continue;
      if (answer === "yes") out.rewardRulings.push({ checkId: c.id, ruling: rewardRuling(c.ifYes ?? "") });
      else if (answer === "not_found" && c.ifNotFound && /avoid/i.test(c.ifNotFound)) out.rewardRulings.push({ checkId: c.id, ruling: "avoid" });
    }
  }

  for (const c of checks) {
    if (!isDecision(c) || isUseCondition(c) || isReward(c)) continue;
    const answer = answerOf(c);

    // ZERO-1 asks a positive question: "yes" goes on; "no" or not found is D1.
    const inverted = c.ifYes?.startsWith("Go on");
    let result: Result;
    if (inverted) result = answer === "yes" ? { kind: "go_on" } : readOutcome(c.ifNotFound ?? "Doubtful, D1");
    else if (answer === "yes") result = readOutcome(c.ifYes ?? "");
    else if (answer === "no") result = { kind: "go_on" };
    else result = c.ifNotFound ? readOutcome(c.ifNotFound) : { kind: "go_on" };

    if (result.kind === "go_on") continue;

    out.decidingCheckId = c.id;
    out.status = result.status;
    out.code = result.code ?? codes[c.id] ?? null;
    if (result.route) out.route = result.route;
    const unresolvedCode = out.status !== null && out.code === null;
    out.sendToScholar = !!result.scholar || unresolvedCode || (c.judgment && answer === "yes");
    return out;
  }

  // Reward and rule lists end without a coin ruling. A decision table with no matching row goes to the Scholar.
  if (checks.some(isDecision)) out.sendToScholar = true;
  return out;
}
