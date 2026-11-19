import type { Answer, Code, Status } from "../db/types";
import type { CheckId, Outcome, RewardRuling } from "../rules/derive";

export interface RulingWithChecks {
  status: Status;
  code: Code;
  /** False for rulings migrated from the Review Desk without per-check answers. */
  checksStructured: boolean;
  checks: { checkId: CheckId; answer: Answer; sourceUrl?: string | null }[];
  rewardRulings: { checkId: CheckId; ruling: RewardRuling }[];
}

export interface CurrentReview {
  answers: Record<CheckId, Answer>;
  sources?: Record<CheckId, string>;
  outcome: Outcome;
}

export interface Change { checkId: CheckId; from: string | null; to: string | null; source: string | null }

export interface Comparison {
  changes: Change[];
  /** Status or code differ from the earlier ruling. */
  outcomeChanged: boolean;
  /** Anything changed, or there is nothing structured to compare: the re-review goes to the Scholar. */
  needsScholar: boolean;
}

export function compare(previous: RulingWithChecks, current: CurrentReview): Comparison {
  const changes: Change[] = [];
  const outcomeChanged = previous.status !== current.outcome.status || previous.code !== current.outcome.code;

  if (previous.checksStructured) {
    const before = new Map(previous.checks.map((c) => [c.checkId, c.answer]));
    const ids = new Set([...before.keys(), ...Object.keys(current.answers)]);
    for (const id of ids) {
      const from = before.get(id) ?? null;
      const to = current.answers[id] ?? null;
      if (from !== to) changes.push({ checkId: id, from, to, source: current.sources?.[id] ?? null });
    }
    const rBefore = new Map(previous.rewardRulings.map((r) => [r.checkId, r.ruling]));
    const rNow = new Map(current.outcome.rewardRulings.map((r) => [r.checkId, r.ruling]));
    for (const id of new Set([...rBefore.keys(), ...rNow.keys()])) {
      const from = rBefore.get(id) ?? null;
      const to = rNow.get(id) ?? null;
      if (from !== to) changes.push({ checkId: id, from, to, source: current.sources?.[id] ?? null });
    }
  }

  return { changes, outcomeChanged, needsScholar: !previous.checksStructured || outcomeChanged || changes.length > 0 };
}
