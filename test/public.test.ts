import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "./fixtures/catalog-v1.json";
import { importCatalog, loadCatalog, type Catalog } from "../src/catalog/load";
import { deriveOutcome } from "../src/rules/derive";
import { buildPublic, type PublicAsset } from "../src/public/build";
import { assertPublicSafe } from "../src/public/guard";

let catalog: Catalog;
beforeAll(async () => {
  await importCatalog(env.DB, fixture as any);
  catalog = await loadCatalog(env.DB, "1.0");
});

const footerApproved =
  "Approved by a Shariah Scholar on 3 November 2026. Last reviewed 3 November 2026. This is a Shariah opinion, not investment advice. Powered by Najm Screener.";

const usdc: PublicAsset = {
  section: "FIAT", whatItIs: "a dollar stablecoin backed by reserves",
  approvedAt: "2026-11-03", lastReviewed: "2026-11-03",
};
const sfrxeth: PublicAsset = {
  section: "LST", whatItIs: "a liquid staking token for ETH",
  approvedAt: "2026-11-03", lastReviewed: "2026-11-03",
};

function usdcOutcome() {
  const coin = deriveOutcome(catalog, "FIAT", { "FIAT-1": "no", "FIAT-2": "no", "FIAT-3": "no", "FIAT-3B": "no", "FIAT-4": "no" });
  const rewards = deriveOutcome(catalog, "REWARD", { "REWARD-1": "no", "REWARD-2": "yes", "REWARD-3": "no" });
  return { ...coin, rewardRulings: rewards.rewardRulings };
}

describe("buildPublic", () => {
  it("builds the USDC sample card", () => {
    expect(buildPublic(catalog, usdcOutcome(), usdc)).toEqual({
      statusLabel: "Halal",
      usageLine: "Exchange it on the spot.",
      tiles: [
        { title: "Is it an asset?", result: "Pass", line: "Yes. It has value and can be owned and transferred." },
        { title: "What it is", result: "Pass", line: "What it is: a dollar stablecoin backed by reserves." },
        { title: "Core Shariah test", result: "Pass", line: "This stablecoin is permissible. Exchange it on the spot; any agreed rate with other stablecoins or currencies is allowed." },
        { title: "Rewards and use", result: "Concern", line: "Rewards offered by lending platforms for this coin are interest and not halal. The coin itself is not affected." },
      ],
      activity: {
        hold: "Yes", buySell: "Spot only; any agreed rate", payments: "Yes",
        rewards: "Interest-based rewards are not halal; promotional rewards from non-interest income are allowed",
        lend: "No (riba)", liquidity: "Yes, in pools that do not lend deposits; avoid lending-based pools",
      },
      footer: footerApproved,
    });
  });

  it("builds the sfrxETH sample card", () => {
    expect(buildPublic(catalog, deriveOutcome(catalog, "LST", { "LST-1": "yes" }), sfrxeth)).toEqual({
      statusLabel: "Haram",
      usageLine: "Do not hold, buy or trade it. If you hold it, exit.",
      tiles: [
        { title: "Is it an asset?", result: "Pass", line: "Yes. It has value and can be owned and transferred." },
        { title: "What it is", result: "Pass", line: "What it is: a liquid staking token for ETH." },
        { title: "Core Shariah test", result: "Fail", line: "Deposits are lent out at interest, which is riba." },
        { title: "Rewards and use", result: "Not applicable", line: "Not applicable: do not hold this token" },
      ],
      activity: { hold: "No", buySell: "No", payments: "No", rewards: "No", lend: "No", liquidity: "No" },
      footer: footerApproved,
    });
  });

  it("marks tiles after an early Doubtful decision as not assessed", () => {
    const card = buildPublic(catalog, deriveOutcome(catalog, "ZERO", { "ZERO-1": "no" }), { ...usdc, section: "ZERO" });
    expect(card.statusLabel).toBe("Doubtful");
    expect(card.tiles.map((t) => t.result)).toEqual(["Concern", "Not assessed", "Not assessed", "Not assessed"]);
    expect(card.tiles[1].line).toBe("Not assessed: the ruling is already decided");
    expect(card.usageLine).toBe("Insufficient information for a clear decision. Avoid holding or trading it until more is known.");
  });

  it("labels a pure-hype token as Haram: not an asset", () => {
    const card = buildPublic(catalog, deriveOutcome(catalog, "ZERO", { "ZERO-1": "yes", "ZERO-2": "no", "ZERO-3": "yes" }), { ...usdc, section: "ZERO" });
    expect(card.statusLabel).toBe("Haram: not an asset");
    expect(card.tiles[0]).toEqual({ title: "Is it an asset?", result: "Fail", line: "This token gives its holder no asset, right or use, so it is not an asset." });
    expect(card.tiles[3].result).toBe("Not applicable");
  });

  it("shows S1 as Check the company and never Halal", () => {
    const o = deriveOutcome(catalog, "STOCK", { "STOCK-1": "no", "STOCK-2": "no", "STOCK-3": "no", "STOCK-4A": "no", "STOCK-OUT": "no" });
    const card = buildPublic(catalog, o, { ...usdc, section: "STOCK", whatItIs: "a token holding shares of a listed company" });
    expect(card.statusLabel).toBe("Check the company");
    expect(card.usageLine).toBe("Check the company with a Shariah stock-screening service before you buy.");
    expect(JSON.stringify(card)).not.toMatch(/Halal/);
  });

  it("uses the preliminary footer before approval", () => {
    const card = buildPublic(catalog, usdcOutcome(), { ...usdc, approvedAt: null });
    expect(card.footer).toBe(
      "Preliminary: prepared with AI and not yet reviewed by a Shariah Scholar; it may contain errors. Last reviewed 3 November 2026. This is a Shariah opinion, not investment advice. Powered by Najm Screener.",
    );
  });

  it("refuses an outcome with no status", () => {
    expect(() => buildPublic(catalog, deriveOutcome(catalog, "ZERO", { "ZERO-1": "yes", "ZERO-2": "yes" }), usdc)).toThrow(/no status/);
  });

  it("refuses a card that would leak", () => {
    expect(() => buildPublic(catalog, usdcOutcome(), { ...usdc, whatItIs: "a coin with 33% reserves" })).toThrow(/33%/);
  });
});

describe("assertPublicSafe", () => {
  it.each(["H2", "R1", "33%", "Farrukh", "Claude", "charity", "v2", "Doubtful, D5", "SCCF v2 Rulebook"])("throws on %s", (bad) => {
    expect(() => assertPublicSafe(`This token ${bad} text`)).toThrow();
  });

  it("allows plain public lines", () => {
    expect(() => assertPublicSafe("This stablecoin is permissible. Exchange it on the spot.")).not.toThrow();
  });
});
