'use server'

import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { transactions } from '@/lib/db/schema'
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

export async function getOverallBalance() {
  const userId = await getUserId()
  const [row] = await db
    .select({
      balance: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end), 0)`,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
  return Number(row?.balance ?? 0)
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

  await db.insert(transactions).values({
    userId,
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
