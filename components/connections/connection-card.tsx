'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef } from 'react'
import { RotateCw, Unplug } from 'lucide-react'
import {
  disconnectConnection,
  syncConnection,
  syncConnectionForm,
  type SyncState,
} from '@/app/actions/pluggy'
import { formatBRL } from '@/lib/finance'
import { itemStatusLabel } from '@/lib/pluggy/mapping'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ConnectButton } from './connect-button'

export type ConnectionCardItem = {
  id: number
  connectorName: string
  connectorImageUrl: string | null
  isSandbox: boolean
  status: string
  executionStatus: string | null
  errorMessage: string | null
  lastSyncedAt: string | null
  pluggyUpdatedAt: string | null
  disconnected: boolean
  accounts: Array<{ id: number; name: string; balance: number; accountType: string | null; numberMask: string | null }>
}

const POLL_MS = 5000
const POLL_MAX = 36 // ~3 minutes

function formatWhen(iso: string | null) {
  if (!iso) return 'nunca'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function tone(status: string) {
  if (status === 'UPDATED') return 'bg-income/10 text-income'
  if (status === 'UPDATING') return 'bg-muted text-foreground'
  if (status === 'DISCONNECTED') return 'bg-muted text-muted-foreground'
  return 'bg-expense/10 text-expense'
}

export function ConnectionCard({ item }: { item: ConnectionCardItem }) {
  const router = useRouter()
  const [syncState, syncAction, syncing] = useActionState<SyncState, FormData>(syncConnectionForm, {})
  const [discState, discAction, disconnecting] = useActionState<SyncState, FormData>(disconnectConnection, {})
  const polls = useRef(0)

  // While the bank is still collecting data, check again periodically.
  const inProgress = !item.disconnected && item.status === 'UPDATING'
  useEffect(() => {
    if (!inProgress || polls.current >= POLL_MAX) return
    const t = setTimeout(async () => {
      polls.current++
      await syncConnection(item.id)
      router.refresh()
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [inProgress, item.id, item.status, item.lastSyncedAt, router])

  const needsUser = ['LOGIN_ERROR', 'WAITING_USER_INPUT', 'OUTDATED'].includes(item.status)
  const feedback = discState.error ?? syncState.error
  const info = discState.message ?? syncState.message

  return (
    <li
      aria-label={`Conexão ${item.connectorName}`}
      className={cn('flex flex-col gap-4 rounded-xl border p-4', item.disconnected && 'opacity-70')}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {item.connectorImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.connectorImageUrl} alt="" className="size-9 rounded-md border object-contain" />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-md bg-muted text-xs font-semibold">
              {item.connectorName.slice(0, 2)}
            </span>
          )}
          <div className="flex flex-col">
            <span className="font-medium">
              {item.connectorName}
              {item.isSandbox && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">Sandbox</span>}
            </span>
            <span className="text-xs text-muted-foreground">
              Última sincronização: {formatWhen(item.lastSyncedAt)}
              {item.pluggyUpdatedAt && ` · dados do banco de ${formatWhen(item.pluggyUpdatedAt)}`}
            </span>
          </div>
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', tone(item.status))} data-status={item.status}>
          {itemStatusLabel(item.status, item.executionStatus)}
        </span>
      </div>

      {item.errorMessage && !item.disconnected && item.status !== 'UPDATED' && (
        <p className="text-sm text-expense">Banco: {item.errorMessage}</p>
      )}

      {item.accounts.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label={`Contas de ${item.connectorName}`}>
          {item.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
              <span className="min-w-0 truncate text-sm">
                {a.name}
                {a.numberMask && <span className="text-muted-foreground"> ···{a.numberMask}</span>}
                {a.accountType === 'CREDIT' && <span className="text-xs text-muted-foreground"> (fatura)</span>}
              </span>
              <span className={cn('shrink-0 font-mono text-sm font-semibold whitespace-nowrap', a.balance < 0 && 'text-expense')}>
                {formatBRL(a.balance)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-start gap-2">
        {item.disconnected ? (
          <ConnectButton label="Conectar de novo" variant="outline" />
        ) : (
          <>
            <form action={syncAction}>
              <input type="hidden" name="itemRowId" value={item.id} />
              <Button type="submit" variant="outline" disabled={syncing || inProgress}>
                <RotateCw className={cn('size-4', (syncing || inProgress) && 'animate-spin')} aria-hidden="true" />
                {syncing ? 'Sincronizando…' : 'Sincronizar'}
              </Button>
            </form>
            <ConnectButton itemRowId={item.id} variant={needsUser ? 'default' : 'ghost'} label={needsUser ? 'Reconectar' : 'Atualizar credenciais'} />
            <form
              action={discAction}
              onSubmit={(e) => {
                if (!window.confirm(`Desconectar ${item.connectorName}? O Pluggy deixa de acessar esse banco; o histórico importado continua aqui.`)) e.preventDefault()
              }}
            >
              <input type="hidden" name="itemRowId" value={item.id} />
              <Button type="submit" variant="ghost" disabled={disconnecting} className="text-muted-foreground hover:text-destructive">
                <Unplug className="size-4" aria-hidden="true" />
                Desconectar
              </Button>
            </form>
          </>
        )}
      </div>
      {feedback && <p role="alert" className="text-sm text-destructive">{feedback}</p>}
      {info && !feedback && <p role="status" className="text-sm text-muted-foreground">{info}</p>}
    </li>
  )
}
