// Imports Pluggy items/accounts/transactions into the app database.
// Server-only. Every query is scoped by userId.

import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, notInArray, sql } from 'drizzle-orm'
import { classify } from '@/lib/bank/classify'
import { detectRecurring } from '@/lib/bank/recurring'
import { findMatch } from '@/lib/bank/reconcile'
import { db } from '@/lib/db'
import { bankAccounts, pluggyItems, syncRuns, transactions } from '@/lib/db/schema'
import { toCents } from '@/lib/money'
import { PluggyApiError, pluggy, sandboxOnly, type PluggyClient } from './client'
import {
  accountBalanceDecimal,
  accountDisplayName,
  IN_PROGRESS_STATUSES,
  NEEDS_USER_STATUSES,
  numberMask,
  syncDateFrom,
  toImportedRow,
} from './mapping'
import type { PluggyAccount, PluggyItem } from './types'

export class PluggyOwnershipError extends Error {
  constructor() {
    super('This Pluggy item does not belong to the current user')
    this.name = 'PluggyOwnershipError'
  }
}

export class SandboxOnlyError extends Error {
  constructor() {
    super('Only sandbox institutions are allowed (PLUGGY_SANDBOX_ONLY)')
    this.name = 'SandboxOnlyError'
  }
}

const BATCH = 200
const RUN_STALE_MS = 5 * 60 * 1000

function itemFields(item: PluggyItem) {
  return {
    connectorId: item.connector.id,
    connectorName: item.connector.name.slice(0, 80),
    connectorImageUrl: item.connector.imageUrl,
    isSandbox: item.connector.isSandbox,
    status: item.status,
    executionStatus: item.executionStatus,
    errorCode: item.error?.code ?? null,
    errorMessage: item.error?.message?.slice(0, 300) ?? null,
    pluggyUpdatedAt: item.lastUpdatedAt,
    consentExpiresAt: item.consentExpiresAt,
    updatedAt: new Date(),
  }
}

/**
 * Stores an item created by the Connect widget for `userId`. Pluggy is the
 * source of truth: the item must carry this user's clientUserId (set in the
 * connect token), so one user can't claim another user's item id.
 */
export async function registerItem(
  userId: string,
  pluggyItemId: string,
  client: PluggyClient = pluggy(),
) {
  const item = await client.getItem(pluggyItemId)
  if (item.clientUserId !== userId) throw new PluggyOwnershipError()
  if (sandboxOnly() && !item.connector.isSandbox) {
    // Real institution while sandbox-only: don't keep the connection.
    await client.deleteItem(item.id)
    throw new SandboxOnlyError()
  }

  const fields = itemFields(item)
  const [row] = await db
    .insert(pluggyItems)
    .values({ userId, pluggyItemId: item.id, ...fields })
    .onConflictDoUpdate({
      target: pluggyItems.pluggyItemId,
      set: { ...fields, disconnectedAt: null },
      // Never move an item between users.
      setWhere: eq(pluggyItems.userId, userId),
    })
    .returning({ id: pluggyItems.id })
  if (!row) throw new PluggyOwnershipError()
  return row.id
}

export type SyncResult = {
  runId: number | null
  status: 'success' | 'waiting' | 'error' | 'skipped'
  message?: string
  accounts: number
  created: number
  updated: number
  removed: number
  matches: number
}

/** Pulls the latest data Pluggy has for one item into the database. */
export async function syncItem(
  userId: string,
  itemRowId: number,
  trigger: 'connect' | 'manual' | 'webhook' | 'cron',
  client: PluggyClient = pluggy(),
): Promise<SyncResult> {
  const empty = { accounts: 0, created: 0, updated: 0, removed: 0, matches: 0 }
  const [row] = await db
    .select()
    .from(pluggyItems)
    .where(and(eq(pluggyItems.id, itemRowId), eq(pluggyItems.userId, userId)))
  if (!row) throw new PluggyOwnershipError()
  if (row.disconnectedAt) {
    return { runId: null, status: 'error', message: 'Conexão desconectada.', ...empty }
  }

  // One run at a time per item (webhook + button can race).
  const [running] = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.itemId, row.id),
        eq(syncRuns.status, 'running'),
        gte(syncRuns.startedAt, new Date(Date.now() - RUN_STALE_MS)),
      ),
    )
  if (running) {
    return { runId: running.id, status: 'skipped', message: 'Sincronização já em andamento.', ...empty }
  }

  const [run] = await db
    .insert(syncRuns)
    .values({ userId, itemId: row.id, trigger, status: 'running' })
    .returning({ id: syncRuns.id })

  const finish = async (status: 'success' | 'waiting' | 'error', counts = empty, message?: string) => {
    await db
      .update(syncRuns)
      .set({
        status,
        finishedAt: new Date(),
        accountsSynced: counts.accounts,
        txCreated: counts.created,
        txUpdated: counts.updated,
        txRemoved: counts.removed,
        matchesSuggested: counts.matches,
        errorMessage: message?.slice(0, 300) ?? null,
      })
      .where(eq(syncRuns.id, run.id))
    return { runId: run.id, status, message, ...counts }
  }

  try {
    const item = await client.getItem(row.pluggyItemId)
    await db.update(pluggyItems).set(itemFields(item)).where(eq(pluggyItems.id, row.id))

    if (IN_PROGRESS_STATUSES.has(item.status)) {
      return finish('waiting', empty, 'O banco ainda está enviando os dados.')
    }
    if (NEEDS_USER_STATUSES.has(item.status) && !item.lastUpdatedAt) {
      return finish('waiting', empty, 'A conexão precisa de uma ação sua (reconectar).')
    }

    if (!row.lastSyncedAt) {
      const dup = await findDuplicateConnection(userId, row, client)
      if (dup) {
        // Same accounts already connected: keep the existing connection and
        // drop this one, otherwise every transaction would be imported twice.
        await client.deleteItem(row.pluggyItemId)
        await db
          .update(pluggyItems)
          .set({ status: 'DISCONNECTED', disconnectedAt: new Date(), errorMessage: 'Conexão duplicada', updatedAt: new Date() })
          .where(eq(pluggyItems.id, row.id))
        return finish('error', empty, `Essas contas já estão conectadas (${dup}). Use "Atualizar credenciais" na conexão existente.`)
      }
    }
    const counts = await importItemData(userId, row, client)
    await db.update(pluggyItems).set({ lastSyncedAt: new Date() }).where(eq(pluggyItems.id, row.id))

    if (NEEDS_USER_STATUSES.has(item.status) || item.status === 'OUTDATED') {
      return finish('error', counts, item.error?.message ?? `Status do banco: ${item.status}`)
    }
    return finish('success', counts)
  } catch (err) {
    const message =
      err instanceof PluggyApiError
        ? `Erro na API Pluggy (${err.status}${err.code ? ` ${err.code}` : ''})`
        : err instanceof Error
          ? err.name
          : 'Erro desconhecido'
    console.error('pluggy sync failed', { itemRowId: row.id, error: message })
    return finish('error', empty, message)
  }
}

/**
 * A new item whose numbered accounts all already belong to another active
 * connection of the same user and institution is a duplicate connection
 * (Pluggy's avoidDuplicates is not enforced everywhere, e.g. Sandbox).
 */
async function findDuplicateConnection(
  userId: string,
  item: { id: number; pluggyItemId: string; connectorId: number },
  client: PluggyClient,
): Promise<string | null> {
  const accounts = await client.listAccounts(item.pluggyItemId)
  const keys = accounts
    // Accounts without subtype or number can't be compared: then it's not
    // treated as a duplicate (import rather than risk dropping data).
    .map((a) => (a.subtype && numberMask(a.number) ? `${a.type}|${a.subtype}|${numberMask(a.number)}` : null))
    .filter((k): k is string => k !== null)
  if (keys.length === 0 || keys.length !== accounts.length) return null
  const existing = await db
    .select({
      key: sql<string>`${bankAccounts.accountType} || '|' || ${bankAccounts.subtype} || '|' || ${bankAccounts.numberMask}`,
      connector: pluggyItems.connectorName,
    })
    .from(bankAccounts)
    .innerJoin(pluggyItems, eq(pluggyItems.id, bankAccounts.itemId))
    .where(
      and(
        eq(bankAccounts.userId, userId),
        eq(pluggyItems.userId, userId),
        eq(pluggyItems.connectorId, item.connectorId),
        isNull(pluggyItems.disconnectedAt),
        ne(pluggyItems.id, item.id),
      ),
    )
  const known = new Map(existing.map((e) => [e.key, e.connector]))
  return keys.every((k) => known.has(k)) ? (known.get(keys[0]) ?? 'outra conexão') : null
}

async function upsertAccount(
  userId: string,
  itemRowId: number,
  connectorName: string,
  a: PluggyAccount,
): Promise<number> {
  const fields = {
    itemId: itemRowId,
    accountType: a.type,
    subtype: a.subtype,
    numberMask: numberMask(a.number),
    balance: accountBalanceDecimal(a),
    balanceAt: sql`now()`,
  }
  const [existing] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.userId, userId), eq(bankAccounts.externalId, a.id)))
  if (existing) {
    await db.update(bankAccounts).set(fields).where(eq(bankAccounts.id, existing.id))
    return existing.id
  }
  // New account: the name must be unique per user.
  for (let n = 1; n <= 20; n++) {
    const [created] = await db
      .insert(bankAccounts)
      .values({
        userId,
        externalId: a.id,
        name: accountDisplayName(connectorName, a, n === 1 ? '' : ` ${n}`),
        bank: connectorName.slice(0, 40),
        ...fields,
      })
      .onConflictDoNothing()
      .returning({ id: bankAccounts.id })
    if (created) return created.id
    // Lost a race on externalId? Then it exists now.
    const [raced] = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.userId, userId), eq(bankAccounts.externalId, a.id)))
    if (raced) return raced.id
  }
  throw new Error('Could not create a unique account name')
}

async function importItemData(
  userId: string,
  item: { id: number; pluggyItemId: string; connectorName: string; lastSyncedAt: Date | null },
  client: PluggyClient,
) {
  const counts = { accounts: 0, created: 0, updated: 0, removed: 0, matches: 0 }
  const accounts = await client.listAccounts(item.pluggyItemId)
  const dateFrom = syncDateFrom(item.lastSyncedAt)
  const createdIds: number[] = []

  for (const a of accounts) {
    const accountId = await upsertAccount(userId, item.id, item.connectorName, a)
    counts.accounts++
    const txs = await client.listTransactions(a.id, { dateFrom })
    const rows = txs.map((tx) => toImportedRow(tx, classify({ tx, accountType: a.type })))

    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      const keep = (col: string) =>
        sql.raw(`case when "transactions"."categoryStatus" = 'confirmed' then "transactions"."${col}" else excluded."${col}" end`)
      const result = await db
        .insert(transactions)
        .values(chunk.map((r) => ({ ...r, userId, accountId, source: 'bank' as const })))
        .onConflictDoUpdate({
          target: [transactions.userId, transactions.source, transactions.externalId],
          targetWhere: isNotNull(transactions.externalId),
          set: {
            accountId: sql`excluded."accountId"`,
            type: sql`excluded."type"`,
            amount: sql`excluded."amount"`,
            description: sql`excluded."description"`,
            method: sql`excluded."method"`,
            occurredAt: sql`excluded."occurredAt"`,
            status: sql`excluded."status"`,
            merchant: sql`excluded."merchant"`,
            bankCategory: sql`excluded."bankCategory"`,
            externalUpdatedAt: sql`excluded."externalUpdatedAt"`,
            // The user's own choices win over automatic classification.
            category: keep('category'),
            isTransfer: keep('isTransfer'),
            categoryStatus: keep('categoryStatus'),
          },
          // Skip rows that didn't change (repeated syncs/webhooks are no-ops).
          setWhere: sql`"transactions"."externalUpdatedAt" is distinct from excluded."externalUpdatedAt"
            or "transactions"."status" <> excluded."status"
            or "transactions"."amount" <> excluded."amount"
            or "transactions"."occurredAt" <> excluded."occurredAt"
            or "transactions"."description" <> excluded."description"`,
        })
        .returning({ id: transactions.id, inserted: sql<boolean>`(xmax = 0)` })
      for (const r of result) {
        if (r.inserted) {
          counts.created++
          createdIds.push(r.id)
        } else counts.updated++
      }
    }

    // Pending rows the bank no longer reports (settled under a new id or
    // cancelled). Only imported pending rows inside the synced window.
    const seen = rows.map((r) => r.externalId)
    const removed = await db
      .delete(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.accountId, accountId),
          eq(transactions.source, 'bank'),
          eq(transactions.status, 'pending'),
          dateFrom ? gte(transactions.occurredAt, dateFrom) : undefined,
          seen.length ? notInArray(transactions.externalId, seen) : undefined,
        ),
      )
      .returning({ id: transactions.id })
    counts.removed += removed.length
  }

  counts.matches = await suggestMatches(userId, createdIds)
  await refreshRecurring(userId)
  return counts
}

/** Suggest manual duplicates for newly imported rows. Never changes manual rows. */
export async function suggestMatches(userId: string, importedIds: number[]) {
  if (importedIds.length === 0) return 0
  const imported = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), inArray(transactions.id, importedIds), isNull(transactions.matchStatus)))
  if (imported.length === 0) return 0

  const dates = imported.map((t) => t.occurredAt).sort()
  const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
  const manual = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        ne(transactions.source, 'bank'),
        isNull(transactions.duplicateOf),
        gte(transactions.occurredAt, shift(dates[0], -3)),
        sql`${transactions.occurredAt} <= ${shift(dates[dates.length - 1], 3)}`,
      ),
    )
  if (manual.length === 0) return 0

  const takenRows = await db
    .select({ id: transactions.matchCandidateId })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNotNull(transactions.matchCandidateId),
        inArray(transactions.matchStatus, ['suggested', 'confirmed']),
      ),
    )
  const taken = new Set(takenRows.map((r) => r.id as number))
  const subject = (t: typeof manual[number]) => ({
    id: t.id, type: t.type, amountCents: toCents(t.amount), date: t.occurredAt, description: t.description, accountId: t.accountId,
  })

  let n = 0
  for (const t of imported) {
    if (t.isTransfer) continue
    const m = findMatch(subject(t), manual.map(subject), taken)
    if (!m) continue
    taken.add(m.candidateId)
    await db
      .update(transactions)
      .set({ matchCandidateId: m.candidateId, matchStatus: 'suggested' })
      .where(and(eq(transactions.id, t.id), eq(transactions.userId, userId)))
    n++
  }
  return n
}

/** Recompute the recurring flag over the last ~13 months of imported rows. */
export async function refreshRecurring(userId: string) {
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10)
  const rows = await db
    .select({
      id: transactions.id, type: transactions.type, amount: transactions.amount,
      occurredAt: transactions.occurredAt, description: transactions.description, recurring: transactions.recurring,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.source, 'bank'), gte(transactions.occurredAt, since)))
  const flagged = detectRecurring(
    rows.map((r) => ({ id: r.id, type: r.type, amountCents: toCents(r.amount), date: r.occurredAt, description: r.description })),
  )
  const toTrue = rows.filter((r) => flagged.has(r.id) && !r.recurring).map((r) => r.id)
  const toFalse = rows.filter((r) => !flagged.has(r.id) && r.recurring).map((r) => r.id)
  if (toTrue.length) await db.update(transactions).set({ recurring: true }).where(and(eq(transactions.userId, userId), inArray(transactions.id, toTrue)))
  if (toFalse.length) await db.update(transactions).set({ recurring: false }).where(and(eq(transactions.userId, userId), inArray(transactions.id, toFalse)))
}

/** Removes imported rows the bank deleted (transactions/deleted webhook). */
export async function removeImported(userId: string, externalIds: string[]) {
  if (externalIds.length === 0) return 0
  const removed = await db
    .delete(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.source, 'bank'), inArray(transactions.externalId, externalIds)))
    .returning({ id: transactions.id })
  return removed.length
}

/** Latest runs for the connections page. */
export async function recentRuns(userId: string, limit = 15) {
  return db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.userId, userId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(limit)
}

/**
 * Reverse direction: a manual entry was created after the bank import.
 * Suggests it on the best matching imported row (suggestion only).
 */
export async function suggestMatchForManual(userId: string, manualId: number) {
  const [manual] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, manualId), eq(transactions.userId, userId), ne(transactions.source, 'bank')))
  if (!manual) return false
  const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
  const imported = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.source, 'bank'),
        isNull(transactions.matchStatus),
        eq(transactions.isTransfer, false),
        eq(transactions.amount, manual.amount),
        gte(transactions.occurredAt, shift(manual.occurredAt, -3)),
        sql`${transactions.occurredAt} <= ${shift(manual.occurredAt, 3)}`,
      ),
    )
  if (imported.length === 0) return false
  const subject = (t: typeof manual) => ({
    id: t.id, type: t.type, amountCents: toCents(t.amount), date: t.occurredAt, description: t.description, accountId: t.accountId,
  })
  const m = findMatch(subject(manual), imported.map(subject))
  if (!m) return false
  await db
    .update(transactions)
    .set({ matchCandidateId: manual.id, matchStatus: 'suggested' })
    .where(and(eq(transactions.id, m.candidateId), eq(transactions.userId, userId), isNull(transactions.matchStatus)))
  return true
}
