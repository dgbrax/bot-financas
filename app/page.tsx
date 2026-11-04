import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import {
  getAccountBalances,
  getMonthTransactions,
  getMonthlyFlow,
} from '@/app/actions/transactions'
import { currentMonthKey, isValidMonthKey } from '@/lib/finance'
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
  searchParams: Promise<{ mes?: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const { mes } = await searchParams
  const month = isValidMonthKey(mes) ? mes : currentMonthKey()

  const [monthTransactions, balances, flow] = await Promise.all([
    getMonthTransactions(month),
    getAccountBalances(),
    getMonthlyFlow(month),
  ])
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
  }))

  const income = items
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0)
  const expense = items
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0)

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

        <TransactionForm accounts={accountOptions} />

        <div className="grid gap-10 md:grid-cols-2">
          <CategoryBreakdown items={items} total={expense} />
          <MonthlyFlow data={flow} activeMonth={month} />
        </div>

        <TransactionList items={items} />
      </main>
    </div>
  )
}
