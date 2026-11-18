-- Additive migration for the schema in main, NOT the integracoes migration chain.
-- Run manually only after catalog preflight and rehearsal on a disposable/Neon test DB.
-- No backfill or UPDATE/DELETE of existing financial records. No production execution in build.
BEGIN;
SET LOCAL search_path = public;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- Existing identifiers must be absent. Fail rather than hide schema drift.
CREATE TABLE bank_accounts (
  id serial PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL,
  bank text NOT NULL DEFAULT 'manual',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT bank_accounts_user_name_unique UNIQUE ("userId",name)
);

-- Nullable accountId keeps old dashboard inserts and historical transactions valid.
ALTER TABLE transactions ADD COLUMN "accountId" integer;
ALTER TABLE transactions ADD COLUMN source text NOT NULL DEFAULT 'manual';
ALTER TABLE transactions ADD COLUMN "externalId" text;
ALTER TABLE transactions ADD CONSTRAINT transactions_account_id_fk
  FOREIGN KEY ("accountId") REFERENCES bank_accounts(id) ON DELETE RESTRICT NOT VALID;

CREATE TABLE telegram_link_codes (
  hash text PRIMARY KEY,
  "userId" text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  "accountId" integer NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE telegram_links (
  id text PRIMARY KEY,
  "telegramUserId" text NOT NULL UNIQUE,
  "chatId" text NOT NULL UNIQUE,
  "userId" text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  "accountId" integer NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE telegram_updates (
  "updateId" text PRIMARY KEY,
  "chatId" text NOT NULL,
  "messageId" text NOT NULL,
  "telegramUserId" text NOT NULL,
  "userId" text REFERENCES "user"(id) ON DELETE SET NULL,
  "bindingId" text,
  reply text,
  "receivedAt" timestamp NOT NULL DEFAULT now(),
  "deliveredAt" timestamp,
  CONSTRAINT telegram_updates_chat_message_unique UNIQUE ("chatId","messageId")
);
COMMIT;
