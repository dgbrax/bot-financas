'use server'

import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { bankAccounts, transactions } from '@/lib/db/schema'
import { ensureDefaultAccounts, MANUAL_ACCOUNT_NAME } from '@/lib/accounts'
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  METHOD_VALUES,
  monthRange,
  shiftMonth,
} from '@/lib/finance'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

const signedAmount = sql`case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end`

async function selectAccountBalances(userId: string) {
  return db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      bank: bankAccounts.bank,
      snapshot: bankAccounts.balance,
      balanceAt: bankAccounts.balanceAt,
      net: sql<string>`coalesce(sum(${signedAmount}), 0)`,
    })
    .from(bankAccounts)
    // Snapshot + net of transactions dated after the snapshot day
    // (all transactions when there is no snapshot).
    .leftJoin(
      transactions,
      and(
        eq(transactions.accountId, bankAccounts.id),
        eq(transactions.userId, bankAccounts.userId),
        sql`(${bankAccounts.balanceAt} is null or ${transactions.occurredAt} > ${bankAccounts.balanceAt}::date)`,
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
    isManual: r.name === MANUAL_ACCOUNT_NAME,
    balanceAt: r.balanceAt ? r.balanceAt.toISOString() : null,
    balance: Number(r.snapshot) + Number(r.net),
  }))
  const unassigned =
    unassignedRow && unassignedRow.count > 0 ? Number(unassignedRow.net) : null
  const total =
    accounts.reduce((s, a) => s + a.balance, 0) + (unassigned ?? 0)

  return { accounts, unassigned, total }
}

export async function getMonthTransactions(monthKey: string) {
  const userId = await getUserId()
  const { start, end } = monthRange(monthKey)
  return db
    .select()
    .from(transactions)
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

export async function addTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await getUserId()

  const type = String(formData.get('type') ?? '')
  const rawAmount = String(formData.get('amount') ?? '')
    .replace(/\./g, '')
    .replace(',', '.')
  const amount = Number(rawAmount)
  const description = String(formData.get('description') ?? '').trim()
  const category = String(formData.get('category') ?? '')
  const method = String(formData.get('method') ?? 'pix')
  const occurredAt = String(formData.get('occurredAt') ?? '')
  const accountId = Number(formData.get('accountId'))

  if (type !== 'income' && type !== 'expense') {
    return { error: 'Tipo inválido.' }
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    return { error: 'Informe um valor válido.' }
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
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

  await db.insert(transactions).values({
    userId,
    accountId,
    source: 'manual',
    type,
    amount: amount.toFixed(2),
    description,
    category,
    method,
    occurredAt,
  })

  revalidatePath('/')
  return { ok: true }
}

export async function deleteTransaction(id: number) {
  const userId = await getUserId()
  await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
  revalidatePath('/')
}
