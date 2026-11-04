'use server'

import { and, desc, eq, gte, isNull, lt, ne, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { suggestMatchForManual } from '@/lib/pluggy/sync'
import { db } from '@/lib/db'
import { bankAccounts, transactions } from '@/lib/db/schema'
import { ensureDefaultAccounts } from '@/lib/accounts'
import { centsToDecimal, fromCents, parseAmount, toCents } from '@/lib/money'
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  isValidISODate,
  METHOD_VALUES,
  monthRange,
  shiftMonth,
} from '@/lib/finance'


const signedAmount = sql`case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end`

async function selectAccountBalances(userId: string) {
  return db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      bank: bankAccounts.bank,
      snapshot: bankAccounts.balance,
      balanceAt: bankAccounts.balanceAt,
      itemId: bankAccounts.itemId,
      accountType: bankAccounts.accountType,
      numberMask: bankAccounts.numberMask,
      net: sql<string>`coalesce(sum(${signedAmount}), 0)`,
    })
    .from(bankAccounts)
    // Snapshot + net of transactions dated after the snapshot day
    // (all transactions when there is no snapshot). For accounts imported
    // from a bank, the bank's balance already includes its own transactions,
    // so only manual entries are added on top. Rows the user confirmed as
    // duplicates never count.
    .leftJoin(
      transactions,
      and(
        eq(transactions.accountId, bankAccounts.id),
        eq(transactions.userId, bankAccounts.userId),
        isNull(transactions.duplicateOf),
        sql`(${bankAccounts.balanceAt} is null or ${transactions.occurredAt} > ${bankAccounts.balanceAt}::date)`,
        sql`(${bankAccounts.externalId} is null or ${transactions.source} <> 'bank')`,
      ),
    )
    .where(eq(bankAccounts.userId, userId))
    .groupBy(bankAccounts.id)
    .orderBy(bankAccounts.id)
}

export async function getAccountBalances() {
  const userId = await getUserId()
  let rows = await selectAccountBalances(userId)
  if (rows.length === 0) {
    // Fallback if the sign-up hook failed or the user predates the seed.
    await ensureDefaultAccounts(userId)
    rows = await selectAccountBalances(userId)
  }

  // Transactions not yet attached to an account (before the 0002 backfill).
  const [unassignedRow] = await db
    .select({
      count: sql<number>`count(*)::int`,
      net: sql<string>`coalesce(sum(${signedAmount}), 0)`,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.accountId)))

  const accounts = rows.map((r) => ({
    id: r.id,
    name: r.name,
    bank: r.bank,
    // Default account for manual entries (survives renaming "Carteira").
    isManual: r.bank === 'manual',
    itemId: r.itemId,
    accountType: r.accountType,
    numberMask: r.numberMask,
    balanceAt: r.balanceAt ? r.balanceAt.toISOString() : null,
    balanceCents: toCents(r.snapshot) + toCents(r.net),
  }))
  const unassignedCents =
    unassignedRow && unassignedRow.count > 0 ? toCents(unassignedRow.net) : null
  const totalCents =
    accounts.reduce((s, a) => s + a.balanceCents, 0) + (unassignedCents ?? 0)

  return {
    accounts: accounts.map(({ balanceCents, ...a }) => ({
      ...a,
      balance: fromCents(balanceCents),
    })),
    unassigned: unassignedCents === null ? null : fromCents(unassignedCents),
    total: fromCents(totalCents),
  }
}

export async function getMonthTransactions(monthKey: string) {
  const userId = await getUserId()
  const { start, end } = monthRange(monthKey)
  return db
    .select({
      id: transactions.id,
      type: transactions.type,
      amount: transactions.amount,
      description: transactions.description,
      category: transactions.category,
      method: transactions.method,
      occurredAt: transactions.occurredAt,
      accountName: bankAccounts.name,
      source: transactions.source,
      status: transactions.status,
      categoryStatus: transactions.categoryStatus,
      isTransfer: transactions.isTransfer,
      recurring: transactions.recurring,
      merchant: transactions.merchant,
      matchStatus: transactions.matchStatus,
      duplicateOf: transactions.duplicateOf,
      matchCandidate: sql<{ id: number; description: string; occurredAt: string } | null>`(
        select json_build_object('id', m."id", 'description', m."description", 'occurredAt', m."occurredAt")
        from "transactions" m
        where m."id" = ${transactions.matchCandidateId} and m."userId" = ${transactions.userId}
      )`,
    })
    .from(transactions)
    .leftJoin(bankAccounts, eq(bankAccounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end),
      ),
    )
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
}

export async function getMonthlyFlow(monthKey: string, months = 6) {
  const userId = await getUserId()
  const firstMonth = shiftMonth(monthKey, -(months - 1))
  const { start } = monthRange(firstMonth)
  const { end } = monthRange(monthKey)

  const rows = await db
    .select({
      month: sql<string>`to_char(${transactions.occurredAt}, 'YYYY-MM')`,
      type: transactions.type,
      total: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end),
        eq(transactions.isTransfer, false),
        isNull(transactions.duplicateOf),
      ),
    )
    .groupBy(sql`1`, transactions.type)

  return Array.from({ length: months }, (_, i) => {
    const key = shiftMonth(firstMonth, i)
    const income = rows.find((r) => r.month === key && r.type === 'income')
    const expense = rows.find((r) => r.month === key && r.type === 'expense')
    return {
      month: key,
      income: Number(income?.total ?? 0),
      expense: Number(expense?.total ?? 0),
    }
  })
}

export type ActionState = { error?: string; ok?: boolean }

type TransactionInput = {
  accountId: number
  type: 'income' | 'expense'
  amount: string
  description: string
  category: string
  method: string
  occurredAt: string
}

/** Validates the transaction form. Also checks the account belongs to the user. */
async function readTransactionForm(
  userId: string,
  formData: FormData,
): Promise<{ data: TransactionInput } | { error: string }> {
  const type = String(formData.get('type') ?? '')
  const amount = parseAmount(String(formData.get('amount') ?? ''))
  const description = String(formData.get('description') ?? '').trim()
  const category = String(formData.get('category') ?? '')
  const method = String(formData.get('method') ?? 'pix')
  const occurredAt = String(formData.get('occurredAt') ?? '')
  const accountId = Number(formData.get('accountId'))

  if (type !== 'income' && type !== 'expense') {
    return { error: 'Tipo inválido.' }
  }
  if (amount === null || amount <= 0 || amount > 1_000_000_000) {
    return { error: 'Informe um valor válido (ex: 12,50).' }
  }
  if (!description || description.length > 120) {
    return { error: 'Descrição obrigatória (até 120 caracteres).' }
  }
  const allowed: readonly string[] =
    type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  if (!allowed.includes(category)) {
    return { error: 'Escolha uma categoria.' }
  }
  if (!METHOD_VALUES.includes(method)) {
    return { error: 'Forma de pagamento inválida.' }
  }
  if (!isValidISODate(occurredAt)) {
    return { error: 'Data inválida.' }
  }
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return { error: 'Escolha uma conta.' }
  }
  const [account] = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, accountId), eq(bankAccounts.userId, userId)))
  if (!account) {
    return { error: 'Conta inválida.' }
  }

  return {
    data: {
      accountId,
      type,
      amount: centsToDecimal(toCents(amount)),
      description,
      category,
      method,
      occurredAt,
    },
  }
}

/** Creates a transaction, or updates one when the form carries an `id`. */
export async function saveTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await getUserId()

  // Imported rows: amount/date/account come from the bank; only the category
  // can be corrected, and doing so confirms it.
  const rawEditId = formData.get('id')
  if (rawEditId) {
    const [existing] = await db
      .select({ id: transactions.id, source: transactions.source, type: transactions.type })
      .from(transactions)
      .where(and(eq(transactions.id, Number(rawEditId)), eq(transactions.userId, userId)))
    if (!existing) return { error: 'Transação não encontrada.' }
    if (existing.source !== 'manual') {
      const category = String(formData.get('category') ?? '')
      const allowed: readonly string[] =
        existing.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
      if (!allowed.includes(category)) return { error: 'Escolha uma categoria.' }
      await db
        .update(transactions)
        .set({ category, categoryStatus: 'confirmed' })
        .where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)))
      revalidatePath('/')
      const returnTo = String(formData.get('returnTo') ?? '')
      redirect(/^\/\?mes=\d{4}-(0[1-9]|1[0-2])$/.test(returnTo) ? returnTo : '/')
    }
  }

  const parsed = await readTransactionForm(userId, formData)
  if ('error' in parsed) return parsed

  const rawId = formData.get('id')
  if (rawId) {
    const id = Number(rawId)
    if (!Number.isInteger(id) || id <= 0) return { error: 'Transação inválida.' }
    const updated = await db
      .update(transactions)
      .set(parsed.data)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
      .returning({ id: transactions.id })
    if (updated.length === 0) return { error: 'Transação não encontrada.' }
    revalidatePath('/')
    // Leave edit mode. Only same-app dashboard URLs are allowed (no open redirect).
    const returnTo = String(formData.get('returnTo') ?? '')
    redirect(/^\/\?mes=\d{4}-(0[1-9]|1[0-2])$/.test(returnTo) ? returnTo : '/')
  } else {
    const [created] = await db
      .insert(transactions)
      .values({ userId, source: 'manual', ...parsed.data })
      .returning({ id: transactions.id })
    // If the bank already imported this transaction, suggest the match.
    await suggestMatchForManual(userId, created.id).catch(() => false)
  }

  revalidatePath('/')
  return { ok: true }
}

export async function getTransaction(id: number) {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
  return row ?? null
}

export async function deleteTransaction(id: number) {
  const userId = await getUserId()
  // Imported rows would come back on the next sync; they are kept.
  await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.userId, userId),
        ne(transactions.source, 'bank'),
      ),
    )
  revalidatePath('/')
}

/** Accept the automatic category as correct. */
export async function acceptCategory(id: number) {
  const userId = await getUserId()
  await db
    .update(transactions)
    .set({ categoryStatus: 'confirmed' })
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
  revalidatePath('/')
}

/**
 * The user confirms an imported row and its suggested manual row are the
 * same transaction. The manual row is kept (not deleted or changed) but
 * marked as a duplicate, which excludes it from totals and balances.
 */
export async function confirmMatch(importedId: number) {
  const userId = await getUserId()
  const [imp] = await db
    .select({ id: transactions.id, candidate: transactions.matchCandidateId, status: transactions.matchStatus })
    .from(transactions)
    .where(and(eq(transactions.id, importedId), eq(transactions.userId, userId), eq(transactions.source, 'bank')))
  if (!imp?.candidate || imp.status !== 'suggested') return
  await db.transaction(async (tx) => {
    const marked = await tx
      .update(transactions)
      .set({ duplicateOf: imp.id })
      .where(
        and(
          eq(transactions.id, imp.candidate!),
          eq(transactions.userId, userId),
          ne(transactions.source, 'bank'),
          isNull(transactions.duplicateOf),
        ),
      )
      .returning({ id: transactions.id })
    if (marked.length === 0) return
    await tx
      .update(transactions)
      .set({ matchStatus: 'confirmed' })
      .where(and(eq(transactions.id, imp.id), eq(transactions.userId, userId)))
  })
  revalidatePath('/')
}

/** Not the same transaction: stop suggesting it. */
export async function dismissMatch(importedId: number) {
  const userId = await getUserId()
  await db
    .update(transactions)
    .set({ matchStatus: 'dismissed' })
    .where(
      and(
        eq(transactions.id, importedId),
        eq(transactions.userId, userId),
        eq(transactions.source, 'bank'),
        eq(transactions.matchStatus, 'suggested'),
      ),
    )
  revalidatePath('/')
}

/** Undo a confirmed match: the manual row counts again. */
export async function undoMatch(manualId: number) {
  const userId = await getUserId()
  const [man] = await db
    .select({ id: transactions.id, dup: transactions.duplicateOf })
    .from(transactions)
    .where(and(eq(transactions.id, manualId), eq(transactions.userId, userId)))
  if (!man?.dup) return
  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ duplicateOf: null })
      .where(and(eq(transactions.id, man.id), eq(transactions.userId, userId)))
    await tx
      .update(transactions)
      .set({ matchStatus: 'suggested' })
      .where(and(eq(transactions.id, man.dup!), eq(transactions.userId, userId)))
  })
  revalidatePath('/')
}
