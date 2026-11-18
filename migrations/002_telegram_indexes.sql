-- Must run OUTSIDE a transaction; stop on error and inspect pg_index.indisvalid.
-- Creating the partial index does not rewrite historical financial records.
SET search_path = public;
SET lock_timeout = '2s';
SET statement_timeout = '5min';
CREATE UNIQUE INDEX CONCURRENTLY transactions_user_source_external_unique
  ON transactions ("userId",source,"externalId") WHERE "externalId" IS NOT NULL;
ALTER TABLE transactions VALIDATE CONSTRAINT transactions_account_id_fk;
