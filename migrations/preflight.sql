-- Manual catalog inspection only. No financial records or secrets are selected.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT table_name,column_name,data_type,is_nullable
FROM information_schema.columns WHERE table_schema='public'
AND table_name IN ('user','transactions','bank_accounts','telegram_links','telegram_link_codes','telegram_updates')
ORDER BY table_name,ordinal_position;
SELECT tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('transactions','bank_accounts','telegram_updates');
COMMIT;
