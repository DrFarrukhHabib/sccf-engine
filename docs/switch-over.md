# Switch-over runbook

Steps marked **Scholar** need your accounts. Secrets go only into Cloudflare's or GitHub's secret settings; never paste them into chat or code.

## 1. Accounts (Scholar)

1. Create a private GitHub repository `sccf-engine` and tell Claude its name. Claude pushes the `feat/engine` branch and opens a pull request; you merge it.
2. Create a Cloudflare account (free plan) and install Wrangler access for Claude's session, or run the commands below yourself.

## 2. Cloudflare resources

```bash
npx wrangler d1 create sccf            # copy the database_id into wrangler.toml
npx wrangler r2 bucket create sccf-backups
npx wrangler d1 migrations apply sccf --remote
npm run import-catalog -- test/fixtures/catalog-v1.json > catalog.sql
npx wrangler d1 execute sccf --remote --file catalog.sql
```

## 3. Secrets (Scholar)

```bash
npx wrangler secret put ANALYST_KEY        # a long random string; also stored in the analyst task's secrets
npx wrangler secret put CMC_API_KEY        # your paid CoinMarketCap key
npx wrangler secret put ACCESS_TEAM_DOMAIN # e.g. azka.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD         # the Access application's audience tag
npx wrangler secret put DESK_EMAIL         # your email, the only one allowed into /desk
npx wrangler secret put GOOGLE_SA_JSON     # optional: service account for the Asset Register sync
npx wrangler secret put REGISTER_SHEET_ID  # optional: the Asset Register spreadsheet id
```

## 4. Cloudflare Access (Scholar)

Zero Trust → Access → Applications → add a self-hosted application for `<engine host>/desk/*`, with a policy that allows only your email. Copy its audience tag into `ACCESS_AUD`. Confirm the free plan's allowance covers one user (open item from the design). Until Access is set, the desk answers 403 to everyone.

## 5. Deploy and migrate

```bash
npm run deploy
# Export the Review Desk (tokens collection) and the Review History sheet into desk-export.json
npm run migrate-from-desk -- desk-export.json > migrate.sql   # prints counts; approved must be 85 or more
npx wrangler d1 execute sccf --remote --file migrate.sql
```

## 6. Restore test

Wait for (or trigger) the daily job, download the newest file in `sccf-backups/exports/`, restore it into a scratch D1 database with `restoreExport`, and compare row counts.

## 7. Pilot and gate

1. Point the analyst scheduled task at `docs/analyst-playbook.md` and the engine URL.
2. Run one batch of 15 new tokens end to end: queue → research → draft → desk review → approval → `/v1`.
3. Record Claude usage per token and compare each ruling with what the current desk would produce.
4. **Gate:** you approve the switch. Then the project's `claude/sccf-worker-playbook.md` is replaced with the engine version, and the dashboard becomes read-only.
