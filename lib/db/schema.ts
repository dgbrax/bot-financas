import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  timestamp,
  boolean,
  serial,
  numeric,
  date,
  integer,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

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

export const bankAccounts = pgTable('bank_accounts', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  bank: text('bank').notNull().default('manual'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, t => [uniqueIndex('bank_accounts_user_name_unique').on(t.userId, t.name)])

export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  accountId: integer('accountId').references(() => bankAccounts.id, { onDelete: 'restrict' }),
  source: text('source').notNull().default('manual'),
  externalId: text('externalId'),
  type: text('type').$type<'income' | 'expense'>().notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  method: text('method').notNull().default('pix'),
  occurredAt: date('occurredAt').notNull().defaultNow(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, t => [uniqueIndex('transactions_user_source_external_unique')
  .on(t.userId, t.source, t.externalId).where(sql`${t.externalId} is not null`)])

export type Transaction = typeof transactions.$inferSelect

// Telegram identities use numeric Telegram IDs as text, never usernames.
export const telegramLinks = pgTable('telegram_links', {
  id: text('id').primaryKey(),
  telegramUserId: text('telegramUserId').notNull().unique(),
  chatId: text('chatId').notNull().unique(),
  userId: text('userId').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  accountId: integer('accountId').notNull().references(() => bankAccounts.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const telegramLinkCodes = pgTable('telegram_link_codes', {
  hash: text('hash').primaryKey(),
  userId: text('userId').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  accountId: integer('accountId').notNull().references(() => bankAccounts.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Durable deduplication + short-lived reply outbox. Reply is erased after delivery.
export const telegramUpdates = pgTable('telegram_updates', {
  updateId: text('updateId').primaryKey(),
  chatId: text('chatId').notNull(),
  messageId: text('messageId').notNull(),
  telegramUserId: text('telegramUserId').notNull(),
  userId: text('userId').references(() => user.id, { onDelete: 'set null' }),
  bindingId: text('bindingId'),
  reply: text('reply'),
  receivedAt: timestamp('receivedAt').notNull().defaultNow(),
  deliveredAt: timestamp('deliveredAt'),
}, t => [uniqueIndex('telegram_updates_chat_message_uq').on(t.chatId, t.messageId)])
