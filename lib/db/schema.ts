import {
  pgTable,
  text,
  timestamp,
  boolean,
  serial,
  numeric,
  date,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// --- Better Auth required tables -------------------------------------------
// Column names are camelCase to match Better Auth's defaults. Do not rename.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

// --- App tables ------------------------------------------------------------

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Institution slug, e.g. 'inter', 'santander', 'manual'.
    bank: text('bank').notNull(),
    // Snapshot balance as of `balanceAt`. Current balance = balance + net of
    // this account's transactions with occurredAt > balanceAt::date.
    balance: numeric('balance', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    balanceAt: timestamp('balanceAt'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('bank_accounts_user_name_uq').on(t.userId, t.name)],
)

export type BankAccount = typeof bankAccounts.$inferSelect

export const TRANSACTION_SOURCES = ['manual', 'whatsapp', 'bank', 'ofx'] as const
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number]

export const transactions = pgTable(
  'transactions',
  {
    id: serial('id').primaryKey(),
    userId: text('userId').notNull(),
    // Backfilled by 0002; NOT NULL since 0003.
    accountId: integer('accountId')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    type: text('type').$type<'income' | 'expense'>().notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    method: text('method').notNull().default('pix'),
    source: text('source').$type<TransactionSource>().notNull().default('manual'),
    // ID from the origin system (bank/OFX/WhatsApp) for idempotent imports.
    externalId: text('externalId'),
    occurredAt: date('occurredAt').notNull().defaultNow(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (t) => [
    index('transactions_account_idx').on(t.accountId),
    uniqueIndex('transactions_user_source_external_uq')
      .on(t.userId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
)

export type Transaction = typeof transactions.$inferSelect
