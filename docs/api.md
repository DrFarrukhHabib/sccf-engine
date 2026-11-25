# Najm Screener API v1 — Developer Guide

Najm Screener publishes Shariah rulings on crypto tokens. Each ruling is researched by the AI Analyst and approved by a Shariah Scholar under the SCCF methodology. This guide is everything a developer needs to connect an app to the Najm Screener API (the Screener API for short).

- **Base URL:** `https://sccf-engine.doctorfarrukhhabib.workers.dev/v1`
- **Format:** JSON (UTF-8), plus one CSV export. All times are UTC.
- **Attribution:** every response carries `"poweredBy": "Najm Screener"`. Your app must show "Powered by Najm Screener" wherever it shows a ruling.

## 1. Access

Each client gets its own API key from the Scholar's Desk. Send it on every request:

```
X-API-Key: sccf_…
```

- **Keep the key on your server.** Never put it in a mobile app, a web page or a public repository. Fetch rulings server-side, store them, and serve your users from your copy.
- A key is either **standard** (approved rulings only) or **preliminary** (also sees AI drafts not yet approved, always marked as such). Most clients need standard.
- Keys can be revoked from the desk at any time; a revoked key gets `401`.

## 2. The ruling record (version 1)

Every endpoint returns rulings in this one shape, the same for every client. Show the texts as given: you may choose which fields to display, but do not reword them, because they are the Scholar's approved opinion.

```json
{
  "recordVersion": "1",
  "rulingId": "3f0c9a6e-…",
  "assetId": "SCCF-0104",
  "name": "USD Coin",
  "ticker": "USDC",
  "coingeckoId": "usd-coin",
  "networks": [{ "network": "Ethereum", "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }],
  "class": "FIAT",
  "status": "Halal",
  "usageLine": "You may hold, buy, sell and use this token. Use it only in permissible activities.",
  "summary": {
    "whatItIs": "a dollar stablecoin backed by cash and short-term reserves",
    "why": "It is a payment token whose holders receive no interest.",
    "howToUse": "Exchange it only on the spot, at any agreed rate.",
    "thingsToKnow": "Rewards offered by some platforms for holding it are not halal."
  },
  "tiles": [
    { "title": "Is it an asset?", "result": "Pass", "line": "Yes. It has value and can be owned and transferred." },
    { "title": "What it is", "result": "Pass", "line": "What it is: a dollar stablecoin backed by cash and short-term reserves." },
    { "title": "Core Shariah test", "result": "Pass", "line": "…" },
    { "title": "Rewards and use", "result": "Concern", "line": "…" }
  ],
  "activity": { "hold": "Yes", "buySell": "Yes", "payments": "Yes", "rewards": "…", "lend": "No", "liquidity": "…" },
  "approvedAt": "2026-11-13",
  "lastReviewed": "2026-11-13",
  "nextReview": "2027-05-13",
  "updatedAt": "2026-11-13T09:46:20.120Z",
  "preliminary": false,
  "footer": "Approved by a Shariah Scholar on 13 November 2026. Last reviewed 13 November 2026. This is a Shariah opinion, not investment advice. Powered by Najm Screener.",
  "criteria": "SCCF 1.0"
}
```

| Field | Meaning |
| --- | --- |
| `recordVersion` | `"1"`. Changes only with a new API version. |
| `rulingId` | The ruling's permanent id. A new review gives a new id. |
| `assetId` | The engine's id for the token (`SCCF-####`). Stable; use it as your key. |
| `name`, `ticker` | Display name and ticker. Tickers are not unique across all tokens. |
| `coingeckoId` | CoinGecko id, when known. |
| `networks` | Chains and contract addresses (`address` is `native` for a chain's own coin). May be empty for older records. |
| `class` | The SCCF category that ruled it (e.g. `FIAT` stablecoin, `NATIVE` chain coin, `EXCH` exchange or governance token, `UTIL` utility, `MEME`). |
| `status` | One of `Halal`, `Doubtful`, `Haram`, `Haram: not an asset`, `Check the company` (tokenized shares: screen the company). |
| `usageLine` | One-line instruction for the user. Show it with the status. |
| `summary` | The plain-language explanation: `whatItIs`, `why`, `howToUse` (always present on new records), `thingsToKnow` (may be null). Older records imported from the earlier system may have nulls. |
| `tiles` | The four-step reasoning card. `result` is `Pass`, `Concern`, `Fail`, `Not assessed` or `Not applicable`. |
| `activity` | What the user may do: `hold`, `buySell`, `payments`, `rewards`, `lend`, `liquidity`. Values are short phrases such as `Yes`, `No`, `Avoid`, `Incidental only`, or a condition. |
| `approvedAt` | Date of the Scholar's approval; `null` while preliminary. |
| `lastReviewed` | Date the research was done. |
| `nextReview` | Scheduled re-review date (six months after approval). |
| `updatedAt` | Moment this record took effect (approval time, or draft time if preliminary). |
| `preliminary` | `true` only for unapproved drafts (preliminary keys only). Such records also carry `disclaimer`, which you must show. |
| `lastApproved` | On a preliminary record: the status and date of the ruling still in force. |
| `footer` | Required wording; show it under the ruling. |
| `criteria` | Methodology version. |

The record never contains internal codes, rule numbers, research notes, trust ratings or market data.

## 3. Endpoints

All are `GET`. Errors return `{ "error": "…", "poweredBy": "Najm Screener" }`.

### `/rulings`
All current rulings. Optional filters: `status` (one of the status values above, with `Haram` also matching `Haram: not an asset`) and `class`.
```
GET /v1/rulings?status=Halal
→ { "poweredBy": "Najm Screener", "count": 212, "rulings": [ …records… ] }
```

### `/assets/{assetId}`
One token's current ruling. `404` if it has none published.
```
GET /v1/assets/SCCF-0104
→ { "poweredBy": "Najm Screener", "ruling": { …record… } }
```

### `/assets/{assetId}/on/{YYYY-MM-DD}`
The ruling that was in force on a date (approved rulings only). For audits and disputes.

### `/lookup`
Find a token the way your app knows it. Give exactly one of:
- `coingeckoId=usd-coin`
- `cmcId=3408` (CoinMarketCap id)
- `ticker=USDC` (may return several tokens)
- `network=Ethereum&address=0xA0b8…` (both required; not case-sensitive)
```
GET /v1/lookup?network=Ethereum&address=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
→ { "poweredBy": "Najm Screener", "count": 1, "rulings": [ …record… ] }
```
`count: 0` means the engine has no published ruling for that token yet.

### `/changes?since={moment}`
What changed since a moment (a date `2026-12-01` or a UTC timestamp `2026-12-01T00:00:00Z`): every token whose published ruling was **approved** (new or re-reviewed) or **withdrawn** by the Scholar.
```
GET /v1/changes?since=2026-12-01T00:00:00Z
→ {
    "poweredBy": "Najm Screener",
    "since": "2026-12-01T00:00:00Z",
    "until": "2026-12-02T03:00:12.441Z",
    "count": 2,
    "changes": [
      { "assetId": "SCCF-0210", "change": "approved", "changedAt": "2026-12-01T10:02:31.000Z", "ruling": { …record… } },
      { "assetId": "SCCF-0088", "change": "withdrawn", "changedAt": "2026-12-01T16:40:00.000Z", "ruling": { …previous record… } }
    ]
  }
```
- `ruling` is the record now in force: after a withdrawal it is the earlier approved ruling, or `null` if the token now has none (show "Not yet rated").
- Keep `until` and send it as `since` next time.

### `/export.json` and `/export.csv`
Every current approved ruling in one file, with `generatedAt` and a SHA-256 `fingerprint` of the `rulings` array (CSV: headers `X-SCCF-Date`, `X-SCCF-Fingerprint`). Use the fingerprint to confirm you hold an exact copy.

## 4. How to stay in sync (recommended)

1. **First load:** `GET /v1/export.json`. Store every record by `assetId`. Save `generatedAt` as your bookmark.
2. **Once a day:** `GET /v1/changes?since=<bookmark>`. For each change, replace your stored record for that `assetId` with `ruling` (or mark the token "Not yet rated" when `ruling` is `null`). Save `until` as the new bookmark.
3. **When a user asks about a token you don't hold:** `GET /v1/lookup?…` once, then cache the answer until your next daily sync.

Once a day is enough: rulings change only when the Scholar approves or withdraws one. Please do not poll more often.

## 5. Limits

- **1,000 requests per key per day (UTC).** A daily sync uses two or three. Over the limit you get `429` until 00:00 UTC.
- The Scholar can see each key's last use and daily requests.

## 6. Status codes

| Code | Meaning |
| --- | --- |
| `200` | OK |
| `400` | A parameter is missing or malformed; the error says which. |
| `401` | Missing, wrong or revoked key. |
| `404` | No published ruling for that token (or date). |
| `429` | Daily limit reached. |

## 7. Versioning

Fields in version 1 will not be removed, renamed or change meaning. New fields may be added, so ignore fields you do not know. A breaking change would come as `/v2`, with notice, while `/v1` keeps working.

## 8. Display rules (summary)

- Show `status` with `usageLine`; show `footer`; show "Powered by Najm Screener".
- For preliminary records, always show `disclaimer`.
- Do not reword `usageLine`, `summary`, `tiles` or `footer`. You may choose which to show (for example the status and usage line in a list, the full summary on a detail screen).
- The rulings are Shariah opinions, not investment advice.
