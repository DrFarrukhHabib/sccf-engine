// CoinMarketCap Pro API. Used internally only (identity, contracts, rank); never served to clients.
const BASE = "https://pro-api.coinmarketcap.com";
type Fetch = (req: Request) => Promise<Response>;

export interface Listing { id: number; symbol: string; name: string; cmc_rank: number }
export interface Info { id: number; name: string; symbol: string; slug: string; website: string | null; contracts: { chain: string; address: string }[] }

async function get(key: string, path: string, f: Fetch): Promise<any> {
  const res = await f(new Request(`${BASE}${path}`, { headers: { "X-CMC_PRO_API_KEY": key, Accept: "application/json" } }));
  if (!res.ok) throw new Error(`CoinMarketCap ${path.split("?")[0]} failed: ${res.status}`);
  return res.json();
}

export async function fetchListings(key: string, limit: number, f: Fetch = (r) => fetch(r)): Promise<Listing[]> {
  const body = await get(key, `/v1/cryptocurrency/listings/latest?limit=${limit}`, f);
  return (body.data as any[]).map(({ id, symbol, name, cmc_rank }) => ({ id, symbol, name, cmc_rank }));
}

export async function fetchInfo(key: string, ids: number[], f: Fetch = (r) => fetch(r)): Promise<Record<string, Info>> {
  const body = await get(key, `/v2/cryptocurrency/info?id=${ids.join(",")}`, f);
  const out: Record<string, Info> = {};
  for (const [k, v] of Object.entries<any>(body.data)) {
    out[k] = {
      id: v.id, name: v.name, symbol: v.symbol, slug: v.slug, website: v.urls?.website?.[0] ?? null,
      contracts: (v.contract_address ?? []).map((c: any) => ({ chain: c.platform?.name, address: c.contract_address })),
    };
  }
  return out;
}
