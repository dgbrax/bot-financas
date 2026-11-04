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
- The existing database was created before drizzle-kit, so a few constraint names differ from the snapshots (e.g. `user_email_key` vs `user_email_unique`), and it has an index `transactions_user_date_idx` and CHECK constraints that `schema.ts` doesn't declare. Review generated SQL that touches those before applying it.

## Local development

```bash
cp .env.example .env.local   # then fill DATABASE_URL (Neon TEST branch) and BETTER_AUTH_SECRET
corepack pnpm install
corepack pnpm dev            # http://localhost:3000
corepack pnpm test           # unit tests (vitest)
corepack pnpm build          # production build, includes type checking
```
