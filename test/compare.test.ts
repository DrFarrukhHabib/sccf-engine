import { describe, expect, it } from "vitest";
import { compare, type RulingWithChecks } from "../src/review/compare";
import type { Outcome } from "../src/rules/derive";

const outcome = (over: Partial<Outcome> = {}): Outcome => ({
  status: "Halal", code: "H2", decidingCheckId: "FIAT-6", sendToScholar: false, useConditions: [], rewardRulings: [], ...over,
});
const previous: RulingWithChecks = {
  status: "Halal", code: "H2", checksStructured: true,
  checks: [
    { checkId: "FIAT-1", answer: "no", sourceUrl: "https://circle.com/a" },
    { checkId: "FIAT-3", answer: "no", sourceUrl: "https://circle.com/b" },
  ],
  rewardRulings: [],
};

describe("compare", () => {
  it("identical answers give no changes", () => {
    expect(compare(previous, { answers: { "FIAT-1": "no", "FIAT-3": "no" }, outcome: outcome() }))
      .toEqual({ changes: [], outcomeChanged: false, needsScholar: false });
  });

  it("one changed answer appears as one change", () => {
    expect(compare(previous, { answers: { "FIAT-1": "no", "FIAT-3": "yes" }, sources: { "FIAT-3": "https://circle.com/c" }, outcome: outcome({ status: "Haram", code: "R1" }) }))
      .toEqual({ changes: [{ checkId: "FIAT-3", from: "no", to: "yes", source: "https://circle.com/c" }], outcomeChanged: true, needsScholar: true });
  });

  it("a check answered now but not before is a change", () => {
    const r = compare(previous, { answers: { "FIAT-1": "no", "FIAT-3": "no", "FIAT-4": "not_found" }, outcome: outcome() });
    expect(r.changes).toEqual([{ checkId: "FIAT-4", from: null, to: "not_found", source: null }]);
    expect(r.needsScholar).toBe(true);
  });

  it("a changed code with the same status counts as outcomeChanged", () => {
    expect(compare(previous, { answers: { "FIAT-1": "no", "FIAT-3": "no" }, outcome: outcome({ code: "H1" }) }))
      .toEqual({ changes: [], outcomeChanged: true, needsScholar: true });
  });

  it("a new reward ruling counts as a change", () => {
    expect(compare(previous, { answers: { "FIAT-1": "no", "FIAT-3": "no" }, outcome: outcome({ rewardRulings: [{ checkId: "REWARD-2", ruling: "not halal" }] }) }))
      .toEqual({ changes: [{ checkId: "REWARD-2", from: null, to: "not halal", source: null }], outcomeChanged: false, needsScholar: true });
  });

  it("a ruling imported without structured checks always goes to the Scholar", () => {
    expect(compare({ ...previous, checksStructured: false, checks: [] }, { answers: { "FIAT-1": "no" }, outcome: outcome() }))
      .toEqual({ changes: [], outcomeChanged: false, needsScholar: true });
  });
});
