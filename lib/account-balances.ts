import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { bankAccounts, transactions } from '@/lib/db/schema'

const signedAmount = sql`case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end`

export async function selectAccountBalances(userId: string, executor: Pick<typeof db, 'select'> = db) {
  return executor
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
