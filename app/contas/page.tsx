import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getAccountBalances } from '@/app/actions/transactions'
import { DashboardHeader } from '@/components/dashboard/header'
import { AccountsManager } from '@/components/accounts/accounts-manager'

export const metadata: Metadata = { title: 'Contas · Bot Finanças' }

export default async function AccountsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const { accounts, total } = await getAccountBalances()

  return (
    <div className="min-h-dvh">
      <DashboardHeader name={session.user.name} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 pt-6 pb-16 md:px-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Contas</h1>
          <p className="text-sm text-muted-foreground">
            Cadastre suas contas e informe o saldo atual de cada uma. Lançamentos
            com data posterior ao saldo informado são somados a ele.
          </p>
        </div>
        <AccountsManager accounts={accounts} total={total} />
      </main>
    </div>
  )
}
