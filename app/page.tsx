import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import {
  getAccountBalances,
  getMonthTransactions,
  getMonthlyFlow,
  getTransaction,
} from '@/app/actions/transactions'
import { currentMonthKey, isValidMonthKey } from '@/lib/finance'
import { fromCents, sumCents } from '@/lib/money'
import { DashboardHeader } from '@/components/dashboard/header'
import { BalanceSummary } from '@/components/dashboard/balance-summary'
import { AccountBalances } from '@/components/dashboard/account-balances'
import { TransactionForm } from '@/components/dashboard/transaction-form'
import { CategoryBreakdown } from '@/components/dashboard/category-breakdown'
import { MonthlyFlow } from '@/components/dashboard/monthly-flow'
import { TransactionList } from '@/components/dashboard/transaction-list'
import { MonthNav } from '@/components/dashboard/month-nav'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; editar?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const { mes, editar } = await searchParams
  const month = isValidMonthKey(mes) ? mes : currentMonthKey()
  const editId = editar && /^\d+$/.test(editar) ? Number(editar) : null

  const [monthTransactions, balances, flow, editingRow] = await Promise.all([
    getMonthTransactions(month),
    getAccountBalances(),
    getMonthlyFlow(month),
    editId ? getTransaction(editId) : null,
  ])
  // getTransaction only returns the user's own rows; anything else is ignored.
  const editing = editingRow
    ? {
        id: editingRow.id,
        type: editingRow.type,
        amount: Number(editingRow.amount),
        description: editingRow.description,
        category: editingRow.category,
        method: editingRow.method,
        occurredAt: editingRow.occurredAt,
        accountId: editingRow.accountId,
      }
    : null
  const accountOptions = balances.accounts.map(({ id, name, isManual }) => ({
    id,
    name,
    isManual,
  }))

  const items = monthTransactions.map((t) => ({
    id: t.id,
    type: t.type,
    amount: Number(t.amount),
    description: t.description,
    category: t.category,
    method: t.method,
    occurredAt: t.occurredAt,
    accountName: t.accountName,
  }))

  // Sum in integer cents to avoid floating-point drift.
  const income = fromCents(
    sumCents(monthTransactions.filter((t) => t.type === 'income').map((t) => t.amount)),
  )
  const expense = fromCents(
    sumCents(monthTransactions.filter((t) => t.type === 'expense').map((t) => t.amount)),
  )

  return (
    <div className="min-h-dvh">
      <DashboardHeader name={session.user.name} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 pt-6 pb-16 md:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <BalanceSummary
            balance={balances.total}
            income={income}
            expense={expense}
          />
          <MonthNav month={month} />
        </div>

        <AccountBalances
          accounts={balances.accounts}
          unassigned={balances.unassigned}
        />

        <TransactionForm
          // Remount when the edited data changes (e.g. after saving) so the
          // uncontrolled inputs pick up new defaults.
          key={editing ? JSON.stringify(editing) : 'new'}
          accounts={accountOptions}
          editing={editing}
          doneHref={`/?mes=${month}`}
        />

        <div className="grid gap-10 md:grid-cols-2">
          <CategoryBreakdown items={items} total={expense} />
          <MonthlyFlow data={flow} activeMonth={month} />
        </div>

        <TransactionList
          items={items}
          month={month}
          editingId={editing?.id ?? null}
        />
      </main>
    </div>
  )
}
