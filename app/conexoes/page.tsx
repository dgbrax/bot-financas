import type { Metadata } from 'next'
import { desc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { pluggyItems } from '@/lib/db/schema'
import { sandboxOnly } from '@/lib/pluggy/client'
import { recentRuns } from '@/lib/pluggy/sync'
import { credentialStatus } from '@/lib/pluggy/credentials'
import { CredentialsForm, CredentialsSummary } from '@/components/connections/credentials-form'
import { getAccountBalances } from '@/app/actions/transactions'
import { DashboardHeader } from '@/components/dashboard/header'
import { ConnectButton } from '@/components/connections/connect-button'
import { ConnectionCard } from '@/components/connections/connection-card'
import { SyncHistory } from '@/components/connections/sync-history'

export const metadata: Metadata = { title: 'Conexões · Bot Finanças' }

export default async function ConnectionsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const userId = session.user.id

  const [items, { accounts }, runs] = await Promise.all([
    db
      .select()
      .from(pluggyItems)
      .where(eq(pluggyItems.userId, userId))
      .orderBy(desc(pluggyItems.createdAt)),
    getAccountBalances(),
    recentRuns(userId),
  ])
  // Env credentials win; otherwise the user's own (stored encrypted).
  const credentials = await credentialStatus(userId)
  const configured = credentials.source !== 'none'
  const active = items.filter((i) => !i.disconnectedAt)
  const disconnected = items.filter((i) => i.disconnectedAt)

  const toCard = (i: (typeof items)[number]) => ({
    id: i.id,
    connectorName: i.connectorName,
    connectorImageUrl: i.connectorImageUrl,
    isSandbox: i.isSandbox,
    status: i.status,
    executionStatus: i.executionStatus,
    errorMessage: i.errorMessage,
    lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
    pluggyUpdatedAt: i.pluggyUpdatedAt?.toISOString() ?? null,
    disconnected: !!i.disconnectedAt,
    accounts: accounts
      .filter((a) => a.itemId === i.id)
      .map((a) => ({ id: a.id, name: a.name, balance: a.balance, accountType: a.accountType, numberMask: a.numberMask })),
  })

  return (
    <div className="min-h-dvh">
      <DashboardHeader name={session.user.name} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 pt-6 pb-16 md:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Conexões bancárias</h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Conecte seus bancos pelo Pluggy (Open Finance). As transações são importadas,
              reconhecidas e categorizadas automaticamente. Somente leitura: nenhum pagamento
              é feito por aqui.
            </p>
          </div>
          {configured && <ConnectButton />}
        </div>

        {!configured && <CredentialsForm />}
        {credentials.source === 'user' && (
          <CredentialsSummary clientIdMasked={credentials.clientIdMasked} updatedAt={credentials.updatedAt} />
        )}
        {configured && sandboxOnly() && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Modo de teste: apenas instituições Sandbox do Pluggy aparecem (ex.: Pluggy Bank,
            usuário <span className="font-mono">user-ok</span>, senha{' '}
            <span className="font-mono">password-ok</span>, código <span className="font-mono">123456</span>).
          </p>
        )}

        {active.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum banco conectado ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-4" aria-label="Bancos conectados">
            {active.map((i) => (
              <ConnectionCard key={i.id} item={toCard(i)} />
            ))}
          </ul>
        )}

        {disconnected.length > 0 && (
          <section aria-labelledby="disconnected" className="flex flex-col gap-3">
            <h2 id="disconnected" className="text-sm font-medium">Desconectados</h2>
            <ul className="flex flex-col gap-3">
              {disconnected.map((i) => (
                <ConnectionCard key={i.id} item={toCard(i)} />
              ))}
            </ul>
          </section>
        )}

        <SyncHistory
          runs={runs.map((r) => ({
            id: r.id,
            connectorName: items.find((i) => i.id === r.itemId)?.connectorName ?? '—',
            trigger: r.trigger,
            status: r.status,
            startedAt: r.startedAt.toISOString(),
            created: r.txCreated,
            updated: r.txUpdated,
            removed: r.txRemoved,
            matches: r.matchesSuggested,
            errorMessage: r.errorMessage,
          }))}
        />
      </main>
    </div>
  )
}
