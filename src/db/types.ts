export type Status = "Halal" | "Doubtful" | "Haram" | "Check the company";
export type Code = "H1" | "H2" | "D1" | "D2" | "D3" | "D4" | "D5" | "R1" | "R2" | "R3" | "R4" | "R5" | "R7" | "S1";
export type Answer = "yes" | "no" | "not_found";

export interface AssetRow {
  id: string;
  cmc_id: string | null;
  coingecko_id: string | null;
  name: string;
  ticker: string;
  class: string;
  issuer: string | null;
  earlier_status: Status | null;
  next_review: string | null;
}

export interface RulingRow {
  id: string;
  asset_id: string;
  criteria_version: string;
  status: Status;
  code: Code;
  plain_name: string | null;
  class: string | null;
  confidence: "High" | "Medium" | "Low" | null;
  review_type: "First" | "Re-review" | null;
  deciding_check: string | null;
  checks_structured: number;
  send_to_scholar: number;
  card_url: string | null;
  prepared_at: string | null;
  next_review: string | null;
  supersedes: string | null;
  created_at: string;
}

export interface SignatureRow {
  id: number;
  ruling_id: string;
  role: "prepared" | "approved" | "co-signed" | "standing";
  by_whom: string;
  at: string;
  note: string | null;
}
