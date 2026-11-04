-- Seed default accounts for existing users and backfill transactions.accountId.
-- Idempotent: safe to run more than once. Requires 0001_bank_accounts.
-- Keep the account list in sync with DEFAULT_ACCOUNTS in lib/accounts.ts.

-- 1) Create Inter / Santander / Carteira for every user that lacks them.
INSERT INTO "bank_accounts" ("userId", "name", "bank")
SELECT u."id", v."name", v."bank"
FROM "user" u
CROSS JOIN (VALUES
  ('Inter', 'inter'),
  ('Santander', 'santander'),
  ('Carteira', 'manual')
) AS v("name", "bank")
ON CONFLICT ("userId", "name") DO NOTHING;
--> statement-breakpoint

-- 2) Attach transactions without an account to the user's Carteira.
--    Only touches rows where accountId IS NULL, so re-runs are no-ops.
UPDATE "transactions" t
SET "accountId" = ba."id"
FROM "bank_accounts" ba
WHERE ba."userId" = t."userId"
  AND ba."name" = 'Carteira'
  AND t."accountId" IS NULL;
