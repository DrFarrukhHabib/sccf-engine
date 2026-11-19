# SCCF Engine — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SCCF engine: one Cloudflare app that holds the rulings database, the Scholar's review desk, the analyst's write access and a read-only client API, built from Check Catalog v1.0.

**Architecture:** A single Cloudflare Worker (TypeScript, Hono router) with a D1 (SQLite) database. Server-rendered HTML pages for the review desk, behind Cloudflare Access so only the Scholar can sign in. Three doors into one database: the desk (Scholar: approve, return, answer), the analyst door (private key: drafts and evidence, never signatures), and the public API v1 (client keys: read approved data). The ruling logic is a pure function over the catalog, so it is tested without a database.

**Tech stack:** TypeScript, Cloudflare Workers, D1, R2 (backups), Hono, Vitest with `@cloudflare/vitest-pool-workers`, Wrangler, GitHub Actions (tests on every pull request).

**Spec:** SCCF Shariah Screening Engine: Design (https://claude.ai/artifact/D6N6846H5e81wknupmajjN) and SCCF Check Catalog v1.0 (https://claude.ai/artifact/4bWskWaVaZ4KvCKNNjhNst). Read both before any task.

## Global constraints

- Repository: private GitHub repo `sccf-engine` owned by the Scholar. All work on branches with pull requests; the Scholar merges. Never push to `main`.
- Secrets (analyst key, CoinMarketCap key, backup credentials) only in Cloudflare and GitHub secret settings, entered by the Scholar. Never in code or chat.
- Hosting starts on Cloudflare's free plan (personal use). No paid feature without the Scholar's approval.
- Statuses: Halal, Doubtful, Haram, plus the outcome "Check the company" (S1) for tokenized stocks only. Codes H1–H2, D1–D5, R1–R5, R7, S1.
- Public outputs never contain: codes or rule numbers, exact figures, the Scholar's name (say "a Shariah Scholar"), tool or product names (say "AI"), v1/v2 or old material, any mention of charity, the trust rating, or CoinMarketCap data (prices, market caps, volumes, rankings).
- "Powered by Azka Advisors" in API responses and exports.
- Rulings, signatures and events are append-only: never updated or deleted, only superseded.
- A ruling is public only once signed by the Scholar, or by standing approval (unchanged re-review, or a first review matching the earlier list, per the 15 November 2026 decision). Preliminary rulings reach only clients flagged to receive them, labelled Preliminary with the AI-error disclaimer.
- The SCCF Asset ID (SCCF-####) is the key. CoinMarketCap and CoinGecko IDs are cross-references.
- Dates are stored as UTC ISO strings; displayed as "D Month YYYY".

## Review focus

1. **Public text leaking internal data** (a code such as "H2", a percentage, the Scholar's name): every public string passes one guard function, tested with known leaks.
2. **An unsigned ruling reaching the public API**: the API query joins on signatures; tested with a draft ruling that must not appear.
3. **History being overwritten**: D1 triggers refuse UPDATE/DELETE on rulings, signatures and events; tested.
4. **"Not found" handled wrongly**: D1 by default, but "No" for fraud checks and for RWA-2; tested per check type.
5. **A re-review auto-confirmed when something did change** (a new reward, a code change, a new D1): the comparison is field-by-field and conservative; tested with a single changed answer.

---

### Task 1: Repository, scaffold and CI

**Files:** Create `package.json`, `wrangler.toml`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `.github/workflows/test.yml`, `README.md` (plain-language run and deploy steps for the Scholar).

**Interfaces:** Produces `app` (Hono instance) exported from `src/index.ts`; a `GET /health` route returning `{ok: true}`.

- [ ] Scholar: create the GitHub repo `sccf-engine` (private) and a Cloudflare account; give Claude access to the repo.
- [ ] Write the failing test `health.test.ts`: `GET /health` returns 200 and `{ok:true}`.
- [ ] Run `npx vitest run`; expect FAIL (route missing).
- [ ] Implement the route; run tests; expect PASS.
- [ ] CI runs `npm ci`, the type check and `vitest run` on every pull request.
- [ ] Commit: `chore: scaffold sccf-engine`.

### Task 2: Database schema and append-only rules

**Files:** Create `migrations/0001_init.sql`, `src/db/types.ts`. Test: `test/schema.test.ts`.

**Interfaces:** Produces tables `assets`, `network_addresses`, `criteria_versions`, `catalog_checks`, `rulings`, `ruling_checks`, `public_fields`, `trust_ratings`, `signatures`, `events`, `questions`, `requests`, `rule_proposals`, `api_clients`, matching the design's data model. `rulings.status` is one of Halal, Doubtful, Haram, Check the company. `api_clients` stores only a hash of each key. `assets` carries `cmc_id` and `coingecko_id`.

- [ ] Tests: inserting a ruling works; `UPDATE rulings` and `DELETE FROM signatures` raise an error; a ruling without `asset_id` or `criteria_version` is refused.
- [ ] Run; expect FAIL.
- [ ] Write the migration with triggers that block UPDATE and DELETE on `rulings`, `signatures` and `events`.
- [ ] Run; expect PASS. Commit.

### Task 3: Catalog import

**Files:** Create `scripts/import-catalog.ts`, `src/catalog/load.ts`. Test: `test/catalog.test.ts`, fixture `test/fixtures/catalog-v1.csv` (exported from the Check Catalog "Checks" tab).

**Interfaces:** Produces `loadCatalog(db): Catalog` where `Catalog = { version: "1.0", sections: Record<SectionKey, Check[]> }` and `Check = { id, section, type, question, ifYes, ifNotFound, tile, publicLine, judgment: boolean, reReview: boolean }`. Rows marked "Dropped" or "Replaced" are not loaded.

- [ ] Tests: v1.0 loads; every section ends in an "Otherwise" or route; every section with status checks has an OUT check before its first Halal outcome; STOCK-4B/4C/4D, DEBT-2, SHARE-1/2 are absent; S1 appears only in the tokenized-stocks section.
- [ ] Run; FAIL. Implement; PASS. Commit.

### Task 4: Ruling logic

**Files:** Create `src/rules/derive.ts`. Test: `test/derive.test.ts`.

**Interfaces:** Consumes `Catalog`. Produces `deriveOutcome(catalog, section, answers: Record<CheckId, "yes"|"no"|"not_found">): Outcome` where `Outcome = { status, code, decidingCheckId, route?: SectionKey, sendToScholar: boolean, useConditions: CheckId[], rewardRulings: {checkId, ruling}[] }`.

- [ ] Tests, each with exact expected outputs:
  - FIAT: all "no" gives Halal H2 via FIAT-6; FIAT-3 "yes" gives Haram R1; FIAT-3B "yes" leaves the coin H2 and adds a "reward not halal" ruling.
  - FIAT-4 "not_found" counts as "no"; FIAT-1 "not_found" gives Doubtful D1.
  - LST-1 "yes" gives Haram R1 (sfrxETH case).
  - RWA-2 "not_found" goes on to RWA-3 Halal H1.
  - A judgment row answered "yes" sets `sendToScholar: true` (NATIVE-1, EXCH-1, MEME-2).
  - STOCK-1 "yes" gives Haram R2; all STOCK checks "no" gives Check the company (S1).
  - ZERO-2 "yes" returns `route: "WRAP"`.
- [ ] Run; FAIL. Implement the first-"yes" walk with the not-found rules; PASS. Commit.

### Task 5: Public layer and the leak guard

**Files:** Create `src/public/build.ts`, `src/public/guard.ts`. Test: `test/public.test.ts`.

**Interfaces:** Consumes `Outcome`, catalog lines, the activity matrix. Produces `buildPublic(outcome, asset): PublicCard` with `{statusLabel, usageLine, tiles: Tile[4], activity: ActivityRow, footer}` and `assertPublicSafe(text: string): void`.

- [ ] Tests: the USDC and sfrxETH sample cards from Task 5 of phase 1 match exactly; tile 1 is titled "Is it an asset?"; tiles after the deciding check read "Not assessed: the ruling is already decided" (tile 4 reads "Not applicable: do not hold this token" for Haram); S1 shows "Check the company" and never "Halal"; `assertPublicSafe` throws on "H2", "R1", "33%", "Farrukh", "Claude", "charity", "v2".
- [ ] Run; FAIL. Implement; PASS. Commit.

### Task 6: Signatures, approval and standing approval

**Files:** Create `src/review/approve.ts`. Test: `test/approve.test.ts`.

**Interfaces:** Produces `approve(db, rulingId, by)`, `returnWithNote(db, rulingId, note)`, `standingConfirm(db, rulingId)` (each writes a signature or an event, never edits a ruling) and `isPublic(ruling): boolean`.

- [ ] Tests: a draft is not public; after `approve` it is; `returnWithNote` without a note is refused; `standingConfirm` refuses when the status differs from the earlier status, when there is an open question, when confidence is Low, or when the result is D1.
- [ ] Run; FAIL. Implement; PASS. Commit.

### Task 7: Re-review comparison

**Files:** Create `src/review/compare.ts`. Test: `test/compare.test.ts`.

**Interfaces:** Produces `compare(previous: RulingWithChecks, answers): { changes: {checkId, from, to, source}[], outcomeChanged: boolean }`, used by Task 6's `standingConfirm`.

- [ ] Tests: identical answers give no changes; one changed answer appears as one change; a changed code with the same status counts as `outcomeChanged`; a new reward ruling counts as a change; a ruling imported without structured checks always goes to the Scholar.
- [ ] Run; FAIL. Implement; PASS. Commit.

### Task 8: Analyst door

**Files:** Create `src/routes/analyst.ts`, `src/market/cmc.ts`. Test: `test/analyst.test.ts`.

**Interfaces:** Routes behind header `Authorization: Bearer <ANALYST_KEY>`: `GET /analyst/queue` (next batch in the playbook's class order, plus re-reviews due within 30 days); `POST /analyst/drafts` (answers, evidence, sources, public fields; the engine runs `deriveOutcome` and stores a draft ruling); `POST /analyst/questions`; `POST /analyst/events`; `GET /analyst/requests`; `POST /analyst/snapshot` (stores a CoinMarketCap rank snapshot, used to pick the next unscreened assets by rank). `src/market/cmc.ts` exposes `fetchListings(key, limit)` and `fetchInfo(key, ids)` for identity and contract addresses; CoinMarketCap data is stored internally only.

- [ ] Tests: a wrong key gives 401; a draft is stored as not public; no analyst route can create a signature; the queue respects the class order; after a snapshot, unscreened assets are queued in rank order.
- [ ] Run; FAIL. Implement; PASS. Commit.

### Task 9: Review desk

**Files:** Create `src/routes/desk.ts`, `src/views/*.tsx` (queue, ruling detail with comparison, questions, rule proposals, library, client keys, card page with print styles for PDF). Test: `test/desk.test.ts`.

**Interfaces:** All `/desk/*` routes require the Cloudflare Access header; approve and return call Task 6; the card page renders Task 5's `PublicCard` plus internal fields.

- [ ] Scholar: turn on Cloudflare Access for `/desk/*` with his account only; confirm the free allowance (open item from the design).
- [ ] Tests: no Access header gives 403; the queue lists drafts and returned items; a comparison shows only the changed checks; creating a client key shows the key once and stores only its hash.
- [ ] Run; FAIL. Implement; PASS. Commit.

### Task 10: Public API v1

**Files:** Create `src/routes/api.ts`. Test: `test/api.test.ts`.

**Interfaces:** Header `X-API-Key`. `GET /v1/rulings` (filters: status, class), `GET /v1/assets/:id`, `GET /v1/assets/:id/on/:date`, `GET /v1/changes?since=`, `GET /v1/export.json` and `.csv` (with version, date and SHA-256 content fingerprint). Every response carries `poweredBy: "Azka Advisors"`.

- [ ] Tests: an unsigned ruling never appears; preliminary rulings appear only for a client flagged `preliminary: true`, with the disclaimer; "status on a date" returns the ruling live on that date; no response contains a code, rule number, trust rating or CoinMarketCap field; S1 tokens are excluded from `status=Halal`.
- [ ] Run; FAIL. Implement; PASS. Commit.

### Task 11: Data migration

**Files:** Create `scripts/migrate-from-desk.ts`. Test: `test/migrate.test.ts` with a fixture of five assets.

**Interfaces:** Reads an export of the current Review Desk database and the Review History sheet; writes assets, rulings (status, code, class, public fields, card links), signatures with their original approval dates, and events. Rulings are marked "checks not yet structured".

- [ ] Tests: approval dates carry over as signatures; the BIO, RUNE, JitoSOL and sfrxETH reclassifications from 19 November 2026 are applied; no history row is lost.
- [ ] Run; FAIL. Implement; PASS.
- [ ] Run against the real export; the counts match the Review Desk (85+ approved). Commit.

### Task 12: Scheduled jobs and backups

**Files:** Create `src/jobs/daily.ts`. Test: `test/jobs.test.ts`.

**Interfaces:** A daily cron: list re-reviews due within 30 days (tokenized stocks also when new company results appear), check CoinMarketCap for new listings and queue them as unscreened, sync approved rulings to the Asset Register sheet until Najm reads the API, and write a full JSON export to an R2 bucket in the Scholar's account.

- [ ] Tests: the due list includes a ruling whose next review is in 29 days; a new listing is queued once, not twice; the export round-trips into an empty database.
- [ ] Scholar: create the R2 bucket; enter the Google Sheets and CoinMarketCap credentials as secrets.
- [ ] Run; FAIL. Implement; PASS.
- [ ] Test one restore from the export before switch-over. Commit.

### Task 13: Pilot batch and switch-over

- [ ] Update `claude/sccf-worker-playbook.md` so the analyst uses the engine's analyst door instead of the dashboard database and sheets.
- [ ] Run one batch of 15 new tokens end to end: queue, research, draft, desk review, approval, API.
- [ ] Measure the Claude usage per token and report it to the Scholar.
- [ ] **Gate:** the batch matches what the current desk would produce, and the Scholar approves the switch.

---

## After phase 2

Phase 3: Najm reads `/v1` instead of the sheet. Phase 4: licensing (client keys, API documentation, methodology page including the tokenized-share note, Cloudflare and CoinMarketCap plan checks before the first commercial client).
