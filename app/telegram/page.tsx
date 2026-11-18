import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { pool } from '@/lib/db'
import { TelegramStore } from '@/lib/telegram/store'
import { getAccountBalances } from '@/app/actions/transactions'
import { DashboardHeader } from '@/components/dashboard/header'
import { TelegramLinkForm } from '@/components/telegram/link-form'

export const metadata: Metadata = { title: 'Telegram · Bot Finanças', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function TelegramPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const { accounts } = await getAccountBalances()
  const link = await new TelegramStore(pool).status(session.user.id)
  return <div className="min-h-dvh">
    <DashboardHeader name={session.user.name} />
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 pt-6 pb-16 md:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Telegram</h1>
      <p className="max-w-xl text-sm text-muted-foreground">Vincule sua conta ao @botfinancas_dgbrax_bot para registrar receitas e despesas, consultar saldo e últimas transações em uma conversa privada. O bot não faz pagamentos nem movimentações bancárias.</p>
      {link && <p>Telegram vinculado (ID {link.telegramUserId}). Conta ativa: {link.accountName}.</p>}
      <TelegramLinkForm accounts={accounts} linked={!!link} />
      <p className="text-sm text-muted-foreground">Comandos: /saldo, /ultimas, /contas, /conta ID, /ajuda e /desvincular. Exemplos: “Gastei 35 reais no almoço” e “Recebi 150 reais”.</p>
    </main>
  </div>
}
