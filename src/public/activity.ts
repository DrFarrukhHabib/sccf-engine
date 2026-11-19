import type { SectionKey } from "../catalog/load";

/** Check Catalog v1.0, "Activity matrix" tab. */
export interface ActivityRow {
  hold: string; buySell: string; payments: string; rewards: string; lend: string; liquidity: string;
}
interface MatrixRow extends ActivityRow { condition: string }

const POOLS = "Yes, in pools that do not lend deposits; avoid lending-based pools";
const row = (hold: string, buySell: string, payments: string, rewards: string, lend: string, liquidity: string, condition: string): MatrixRow =>
  ({ hold, buySell, payments, rewards, lend, liquidity, condition });

export const HARAM = row("No", "No", "No", "No", "No", "No", "Do not hold, buy or trade it. If you hold it, exit.");
export const D1 = row("Avoid", "Avoid", "Avoid", "Avoid", "No", "Avoid",
  "Insufficient information for a clear decision. Avoid holding or trading it until more is known.");
export const D2_D5 = row("Avoid", "Avoid", "Incidental only", "Avoid", "No", "Avoid",
  "Avoid holding or trading it. Use it only incidentally or out of need, for example when a DEX routes a swap through it.");

const PERMISSIBLE = "Use it only in permissible activities.";
const general = row("Yes", "Yes", "Yes", "Not applicable", "No (riba)", POOLS, PERMISSIBLE);
const stable = row("Yes", "Spot only; any agreed rate", "Yes",
  "Interest-based rewards are not halal; promotional rewards from non-interest income are allowed", "No (riba)", POOLS, "Exchange it on the spot.");

/** Halal (and S1) rows, keyed by the class table that decided the ruling. */
export const BY_CLASS: Record<SectionKey, MatrixRow> = {
  NATIVE: row("Yes", "Yes", "Yes", "Yes, if rewards come from validation and you keep ownership; no, if deposits are lent", "No (riba)", POOLS, PERMISSIBLE),
  FIAT: stable,
  CRYPTO: stable,
  GOLD: row("Yes", "Spot only; same metal in equal weight", "Spot only", "Not applicable",
    "No: lending or \"gold leasing\" for a fee is riba", POOLS, "Buy and sell it on the spot; exchange it for the same metal only in equal weight."),
  WRAP: row("As the underlying", "As the underlying", "As the underlying", "As the underlying; an added feature is ruled separately", "No (riba)", POOLS,
    "Takes the underlying asset's conditions."),
  LST: row("Yes", "Yes", "Yes", "Yes; if you choose services to secure, avoid prohibited ones", "No (riba)", POOLS, "Avoid securing prohibited services."),
  EXCH: row("Yes", "Yes", "Yes", "Vote fees allowed", "No (riba)", POOLS, "Do not use the platform's prohibited products."),
  RWA: general,
  LAUNCH: { ...general, condition: "Do not use the launchpad to buy or launch hype or prohibited tokens." },
  UTIL: general, GAME: general, FAN: general, SOCIAL: general, NFT: general,
  DEBT: row("Yes", "At face value only", "At face value only", "Not applicable", "No (riba)", "Not applicable", "Transfer it only at its face value."),
  STOCK: row("Only if the company passes a Shariah stock screen", "Only if the company passes a Shariah stock screen", "Not applicable",
    "Not applicable", "No (riba)", "Not applicable", "Check the company with a Shariah stock-screening service before you buy."),
  INDEX: row("Yes", "Yes", "Yes", "Strictest component's conditions", "No (riba)", POOLS, "Follows the strictest conditions of its components."),
};

export const strip = ({ condition: _c, ...a }: MatrixRow): ActivityRow => a;
export type { MatrixRow };
