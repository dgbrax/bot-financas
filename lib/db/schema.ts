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
  type AnyPgColumn,
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

// --- Pluggy (Open Finance) ------------------------------------------------

/** One Pluggy Item = one connection of a user to one institution. */
export const pluggyItems = pgTable(
  'pluggy_items',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    pluggyItemId: text('pluggyItemId').notNull(),
    connectorId: integer('connectorId').notNull(),
    connectorName: text('connectorName').notNull(),
    connectorImageUrl: text('connectorImageUrl'),
    isSandbox: boolean('isSandbox').notNull().default(false),
    // Pluggy item status / executionStatus, verbatim (UPDATED, LOGIN_ERROR...).
    status: text('status').notNull(),
    executionStatus: text('executionStatus'),
    errorCode: text('errorCode'),
    errorMessage: text('errorMessage'),
    // When Pluggy last collected data from the institution.
    pluggyUpdatedAt: timestamp('pluggyUpdatedAt'),
    // When we last imported data from Pluggy.
    lastSyncedAt: timestamp('lastSyncedAt'),
    consentExpiresAt: timestamp('consentExpiresAt'),
    disconnectedAt: timestamp('disconnectedAt'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pluggy_items_pluggy_item_uq').on(t.pluggyItemId),
    index('pluggy_items_user_idx').on(t.userId),
  ],
)

export type PluggyItem = typeof pluggyItems.$inferSelect

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
    // Set for accounts imported from Pluggy; null for manual accounts.
    itemId: integer('itemId').references(() => pluggyItems.id, {
      onDelete: 'set null',
    }),
    externalId: text('externalId'),
    accountType: text('accountType').$type<'BANK' | 'CREDIT'>(),
    subtype: text('subtype'),
    // Last digits only, for display.
    numberMask: text('numberMask'),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bank_accounts_user_name_uq').on(t.userId, t.name),
    uniqueIndex('bank_accounts_user_external_uq')
      .on(t.userId, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
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
    // --- imported data / classification ---
    status: text('status').$type<'posted' | 'pending'>().notNull().default('posted'),
    merchant: text('merchant'),
    // Category as given by the bank/Pluggy, kept for auditing.
    bankCategory: text('bankCategory'),
    // confirmed: chosen or accepted by the user; suggested: automatic with a
    // strong signal; review: automatic guess the user should check.
    categoryStatus: text('categoryStatus')
      .$type<'confirmed' | 'suggested' | 'review'>()
      .notNull()
      .default('confirmed'),
    // Moves between the user's own accounts (card bill payment, own transfer,
    // investment application/redemption, withdrawal). Excluded from
    // income/expense totals.
    isTransfer: boolean('isTransfer').notNull().default(false),
    recurring: boolean('recurring').notNull().default(false),
    externalUpdatedAt: timestamp('externalUpdatedAt'),
    // --- reconciliation (never deletes manual rows) ---
    // On an imported row: manual row that looks like the same transaction.
    matchCandidateId: integer('matchCandidateId').references(
      (): AnyPgColumn => transactions.id,
      { onDelete: 'set null' },
    ),
    matchStatus: text('matchStatus').$type<'suggested' | 'confirmed' | 'dismissed'>(),
    // On a manual row: the imported row the user confirmed it duplicates.
    // Such rows are kept but excluded from totals and balances.
    duplicateOf: integer('duplicateOf').references(
      (): AnyPgColumn => transactions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (t) => [
    index('transactions_account_idx').on(t.accountId),
    index('transactions_match_candidate_idx').on(t.matchCandidateId),
    uniqueIndex('transactions_user_source_external_uq')
      .on(t.userId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
)

export type Transaction = typeof transactions.$inferSelect

/** One import run for one Pluggy item (connect, manual button or webhook). */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    itemId: integer('itemId')
      .notNull()
      .references(() => pluggyItems.id, { onDelete: 'cascade' }),
    trigger: text('trigger').$type<'connect' | 'manual' | 'webhook' | 'cron'>().notNull(),
    status: text('status')
      .$type<'running' | 'success' | 'waiting' | 'error'>()
      .notNull(),
    startedAt: timestamp('startedAt').notNull().defaultNow(),
    finishedAt: timestamp('finishedAt'),
    accountsSynced: integer('accountsSynced').notNull().default(0),
    txCreated: integer('txCreated').notNull().default(0),
    txUpdated: integer('txUpdated').notNull().default(0),
    txRemoved: integer('txRemoved').notNull().default(0),
    matchesSuggested: integer('matchesSuggested').notNull().default(0),
    errorMessage: text('errorMessage'),
  },
  (t) => [index('sync_runs_item_idx').on(t.itemId, t.startedAt)],
)

export type SyncRun = typeof syncRuns.$inferSelect

/**
 * Pluggy webhook deliveries, one row per eventId (idempotency). Stores no
 * financial data. userId is set once the item is resolved to a user.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: serial('id').primaryKey(),
    eventId: text('eventId').notNull(),
    event: text('event').notNull(),
    pluggyItemId: text('pluggyItemId'),
    userId: text('userId').references(() => user.id, { onDelete: 'cascade' }),
    status: text('status')
      .$type<'received' | 'processed' | 'ignored' | 'error'>()
      .notNull(),
    errorMessage: text('errorMessage'),
    receivedAt: timestamp('receivedAt').notNull().defaultNow(),
    processedAt: timestamp('processedAt'),
  },
  (t) => [uniqueIndex('webhook_events_event_uq').on(t.eventId)],
)
