# SCCF Engine

## Live

- Engine: https://sccf-engine.doctorfarrukhhabib.workers.dev (health check: `/health`)
- Cloudflare: Worker `sccf-engine`, D1 database `sccf`, R2 bucket `sccf-backups`, daily job at 03:17 UTC.
- Deploys: every merge to `main` deploys automatically (deploy command `npm run deploy:cf`).

Setup status (see `docs/switch-over.md`): database, catalog, backups and the CoinMarketCap key are done. Still to do: Cloudflare Access for the desk, the analyst key, the migration from the Review Desk, and the pilot.


The Shariah screening engine behind SCCF rulings: the rulings database, the Scholar's review desk, the AI analyst's write access and the read-only client API. Powered by Azka Advisors.

## For the Shariah Scholar

- **You never need to run anything yourself.** Claude makes every change on a branch and opens a pull request. You review it on GitHub and press "Merge". Merging to `main` deploys the change.
- **Tests run automatically** on every pull request (the "test" check). Do not merge a pull request whose check is red.
- **Secrets** (keys and passwords) are entered only by you, in Cloudflare (Workers > sccf-engine > Settings > Variables and secrets) or GitHub (Settings > Secrets). Never paste them into a chat.

## For developers

```sh
npm ci          # install
npm test        # run the tests (they run inside a local Workers runtime)
npm run typecheck
npm run dev     # local server
```

Database changes go in `migrations/` as numbered SQL files. Rulings, signatures and events are append-only.
