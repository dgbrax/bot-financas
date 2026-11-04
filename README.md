# bot-financas

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_BtxQu6ezANIrGvnwf6jF11uF4wg5)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.

## Database migrations

Migrations are generated with drizzle-kit and **applied manually** in the Neon SQL editor (test branch first). `drizzle-kit migrate`/`push` are not used.

```bash
DATABASE_URL=... pnpm db:generate   # writes SQL to ./drizzle (does not touch the DB)
```

- `drizzle/0000_baseline.sql` describes the schema that already existed before migrations were introduced. **Do not run it on an existing database**; it is only the starting point for drizzle-kit's snapshots. Use it only to create a fresh database.
- Apply later files in order, each inside a transaction:
  - `0001_bank_accounts.sql`: `bank_accounts` table; `accountId`, `source`, `externalId` on `transactions`.
  - `0002_seed_default_accounts.sql`: default accounts (Inter, Santander, Carteira) for existing users and backfill of `transactions.accountId`. Idempotent.
  - `0003_account_id_not_null.sql`: `transactions.accountId` becomes NOT NULL. Before running, check `SELECT count(*) FROM transactions WHERE "accountId" IS NULL` returns 0.
  - `0004_pluggy_integration.sql`: Pluggy tables (`pluggy_items`, `sync_runs`, `webhook_events`) and import/classification/reconciliation columns on `bank_accounts` and `transactions`. Additive only.
  - `0005_pluggy_credentials.sql`: per-user Pluggy credentials (encrypted secret). Must be applied before deploying code that has no `PLUGGY_*` env vars.
- The existing database was created before drizzle-kit, so a few constraint names differ from the snapshots (e.g. `user_email_key` vs `user_email_unique`), and it has an index `transactions_user_date_idx` and CHECK constraints that `schema.ts` doesn't declare. Review generated SQL that touches those before applying it.

## Local development

```bash
cp .env.example .env.local   # then fill DATABASE_URL (Neon TEST branch) and BETTER_AUTH_SECRET
corepack pnpm install
corepack pnpm dev            # http://localhost:3000
corepack pnpm test           # unit tests (vitest)
corepack pnpm build          # production build, includes type checking
```

## Bank integration (Pluggy)

- Connect banks at `/conexoes` with the Pluggy Connect widget. Credentials go to Pluggy; the app only stores the Item id, accounts and transactions.
- Credentials: `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` on the server take precedence. Without them, each user can enter their own on `/conexoes`; they are validated with Pluggy and the secret is stored encrypted (AES-256-GCM, key from `CREDENTIALS_ENCRYPTION_KEY` or derived from `BETTER_AUTH_SECRET`) in `pluggy_credentials` (migration `0005`).
- Sandbox-only by default (`PLUGGY_SANDBOX_ONLY`): the widget lists only test institutions and the server refuses real ones. Sandbox login: `user-ok` / `password-ok`, MFA `123456`.
- Sync runs when a bank is connected, with the **Sincronizar** button, from the daily cron (`/api/cron/sync`) and, once registered, from Pluggy webhooks (`/api/webhooks/pluggy`, authenticated by the `x-webhook-secret` header). Webhooks require a public HTTPS URL and are **not registered** yet.
- `corepack pnpm test:integration` runs the import flow against the Pluggy Sandbox and the database in `DATABASE_URL` (use a TEST branch).

## Deployment (Vercel Hobby, private testing)

Target: Vercel Hobby + Neon **TEST** branch + Pluggy **Sandbox**. Nothing here is Vercel-only except `vercel.json` (cron schedule) and the optional `@vercel/analytics` tag.

Environment variables (Project → Settings → Environment Variables):

| Variable | Value | Environments |
|---|---|---|
| `DATABASE_URL` | Neon TEST branch, **pooled** endpoint (`-pooler`), `sslmode=verify-full` | Production, Preview |
| `APP_DATABASE_URL` | Same TEST URL. Takes precedence over `DATABASE_URL`; needed when the Neon integration manages `DATABASE_URL` and points it at a branch without the migrations | Preview (branch `integracoes`) |
| `BETTER_AUTH_SECRET` | new random value (`openssl rand -base64 32`), not the local one | Production, Preview |
| `BETTER_AUTH_URL` | `https://<project>.vercel.app` — Production only; leave unset on Preview (the app falls back to the deployment URL) | Production |
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` | Pluggy application credentials (Sandbox/demo) | Production, Preview |
| `PLUGGY_SANDBOX_ONLY` | `true` | Production, Preview |
| `CRON_SECRET` | random, ≥16 chars (`openssl rand -hex 32`) | Production |
| `PLUGGY_WEBHOOK_SECRET` | random; only needed once a webhook is registered | Production |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` — makes Vercel use `pnpm@12.3.4` from `packageManager` | Production, Preview |

Daily sync: `vercel.json` schedules `GET /api/cron/sync` at `0 9 * * *` (06:00 in Brasília). On Hobby, cron runs at most once a day and may start at any minute within that hour; delivery is best-effort (a run can be missed or repeated). The job is idempotent: it only syncs connections not synced in the last 20 h, and each connection syncs one run at a time. The route allows up to 300 s (Hobby maximum) and stops starting new connections after 240 s; the rest go first on the next run.

Moving to a VPS later: run `next build && next start` behind a reverse proxy with the same env vars, and replace Vercel Cron with a crontab entry:

```
0 9 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/sync
```
