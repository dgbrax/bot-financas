import { db } from '@/lib/db'
import { bankAccounts } from '@/lib/db/schema'

// Accounts every user starts with. Keep in sync with
// drizzle/0002_seed_default_accounts.sql (backfill for existing users).
export const DEFAULT_ACCOUNTS = [
  { name: 'Inter', bank: 'inter' },
  { name: 'Santander', bank: 'santander' },
  { name: 'Carteira', bank: 'manual' },
] as const

// Account that manual entries and backfilled transactions belong to.
export const MANUAL_ACCOUNT_NAME = 'Carteira'

/** Idempotent: relies on the (userId, name) unique index. */
export async function ensureDefaultAccounts(userId: string) {
  await db
    .insert(bankAccounts)
    .values(DEFAULT_ACCOUNTS.map((a) => ({ userId, ...a })))
    .onConflictDoNothing({ target: [bankAccounts.userId, bankAccounts.name] })
}
