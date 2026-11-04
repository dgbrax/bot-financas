'use server'

import { and, count, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { bankAccounts, transactions } from '@/lib/db/schema'
import { ACCOUNT_NAME_MAX, BANK_VALUES } from '@/lib/banks'
import { centsToDecimal, parseAmount, toCents } from '@/lib/money'
import { getUserId } from '@/lib/session'

export type AccountActionState = { error?: string; ok?: boolean }

const MAX_BALANCE_CENTS = 1_000_000_000_00

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}

function readName(formData: FormData): { name: string } | { error: string } {
  const name = String(formData.get('name') ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!name || name.length > ACCOUNT_NAME_MAX) {
    return { error: `Nome obrigatório (até ${ACCOUNT_NAME_MAX} caracteres).` }
  }
  return { name }
}

/** Signed balance typed by the user ("-1.234,56", "250") -> cents, or null. */
function readBalanceCents(raw: string): number | null {
  const s = raw.trim()
  const negative = s.startsWith('-')
  const amount = parseAmount(negative ? s.slice(1) : s)
  if (amount === null) return null
  const cents = toCents(amount)
  if (cents > MAX_BALANCE_CENTS) return null
  return negative ? -cents : cents
}

function revalidateAll() {
  revalidatePath('/')
  revalidatePath('/contas')
}

export async function createAccount(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const userId = await getUserId()
  const parsed = readName(formData)
  if ('error' in parsed) return parsed
  const bank = String(formData.get('bank') ?? '')
  if (!BANK_VALUES.includes(bank)) return { error: 'Escolha o banco.' }

  try {
    await db.insert(bankAccounts).values({ userId, name: parsed.name, bank })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: 'Você já tem uma conta com esse nome.' }
    }
    throw err
  }
  revalidateAll()
  return { ok: true }
}

/**
 * Rename an account and, optionally, set its current balance.
 *
 * Balance model: shown balance = snapshot `balance` + net of transactions
 * dated after `balanceAt::date`. Setting "saldo atual = X" stores a snapshot
 * as of today, minus any future-dated transactions, so the account shows
 * exactly X right after saving.
 */
export async function updateAccount(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const userId = await getUserId()
  const id = Number(formData.get('id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'Conta inválida.' }
  const parsed = readName(formData)
  if ('error' in parsed) return parsed

  const rawBalance = String(formData.get('balance') ?? '').trim()
  let balanceCents: number | null = null
  if (rawBalance) {
    balanceCents = readBalanceCents(rawBalance)
    if (balanceCents === null) {
      return { error: 'Saldo inválido (ex: 1.234,56 ou -50).' }
    }
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(bankAccounts)
        .set({ name: parsed.name })
        .where(and(eq(bankAccounts.id, id), eq(bankAccounts.userId, userId)))
        .returning({ id: bankAccounts.id })
      if (rows.length === 0) return false

      if (balanceCents !== null) {
        const [{ future }] = await tx
          .select({
            future: sql<string>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end), 0)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.accountId, id),
              eq(transactions.userId, userId),
              sql`${transactions.occurredAt} > current_date`,
            ),
          )
        await tx
          .update(bankAccounts)
          .set({
            balance: centsToDecimal(balanceCents - toCents(future)),
            balanceAt: sql`now()`,
          })
          .where(and(eq(bankAccounts.id, id), eq(bankAccounts.userId, userId)))
      }
      return true
    })
    if (!updated) return { error: 'Conta não encontrada.' }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: 'Você já tem uma conta com esse nome.' }
    }
    throw err
  }
  revalidateAll()
  return { ok: true }
}

export async function deleteAccount(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const userId = await getUserId()
  const id = Number(formData.get('id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'Conta inválida.' }

  const [[{ accounts }], [{ used }]] = await Promise.all([
    db
      .select({ accounts: count() })
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, userId)),
    db
      .select({ used: count() })
      .from(transactions)
      .where(
        and(eq(transactions.accountId, id), eq(transactions.userId, userId)),
      ),
  ])
  if (used > 0) {
    return {
      error: `Essa conta tem ${used} transaç${used === 1 ? 'ão' : 'ões'}. Mova ou exclua antes de remover a conta.`,
    }
  }
  if (accounts <= 1) return { error: 'Você precisa ter pelo menos uma conta.' }

  const deleted = await db
    .delete(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.userId, userId)))
    .returning({ id: bankAccounts.id })
  if (deleted.length === 0) return { error: 'Conta não encontrada.' }

  revalidateAll()
  return { ok: true }
}
