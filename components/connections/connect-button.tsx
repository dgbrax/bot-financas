'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Landmark, RefreshCcw } from 'lucide-react'
import {
  completeConnection,
  startConnection,
  startReconnect,
  type ConnectConfig,
} from '@/app/actions/pluggy'
import { Button } from '@/components/ui/button'

type Phase = 'idle' | 'opening' | 'open' | 'saving'

/**
 * Opens the Pluggy Connect widget. Without itemRowId it creates a new
 * connection; with it, it reconnects that item (new credentials / MFA).
 */
export function ConnectButton({
  itemRowId,
  label,
  variant = 'default',
}: {
  itemRowId?: number
  label?: string
  variant?: 'default' | 'outline' | 'ghost'
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  async function finish(pluggyItemId: string) {
    setPhase('saving')
    const r = await completeConnection(pluggyItemId)
    setPhase('idle')
    if ('error' in r) {
      setMessage({ kind: 'error', text: r.error })
    } else if (r.sync.status === 'success') {
      setMessage({ kind: 'info', text: `Conectado. ${r.sync.created} transações importadas.` })
    } else {
      // Widget closed or succeeded, but the bank may still be sending data.
      setMessage({ kind: 'info', text: r.sync.message ?? 'Conexão salva. A importação continua em segundo plano.' })
    }
    router.refresh()
  }

  async function open() {
    setMessage(null)
    setPhase('opening')
    const cfg: ConnectConfig = itemRowId ? await startReconnect(itemRowId) : await startConnection()
    if ('error' in cfg) {
      setPhase('idle')
      setMessage({ kind: 'error', text: cfg.error })
      return
    }
    try {
      const { PluggyConnect } = await import('pluggy-connect-sdk')
      let handled = false
      const widget = new PluggyConnect({
        connectToken: cfg.connectToken,
        includeSandbox: cfg.includeSandbox,
        connectorIds: cfg.connectorIds,
        updateItem: cfg.updateItem,
        language: 'pt',
        connectorSortAlphabetically: true,
        onOpen: () => setPhase('open'),
        onSuccess: async ({ item }) => {
          handled = true
          await finish(item.id)
        },
        onError: async (error) => {
          // The item may exist even on error (e.g. wrong password): record it
          // so its status shows up and it can be reconnected.
          if (error.data?.item?.id && !handled) {
            handled = true
            await finish(error.data.item.id)
          }
          setMessage({ kind: 'error', text: 'O banco recusou a conexão. Verifique os dados e tente de novo.' })
        },
        onClose: () => {
          if (!handled) setPhase('idle')
        },
      })
      await widget.init()
    } catch {
      setPhase('idle')
      setMessage({ kind: 'error', text: 'Não foi possível abrir o Pluggy Connect.' })
    }
  }

  const busy = phase !== 'idle'
  const Icon = itemRowId ? RefreshCcw : Landmark
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="button" variant={variant} onClick={open} disabled={busy}>
        <Icon className="size-4" aria-hidden="true" />
        {phase === 'opening'
          ? 'Abrindo…'
          : phase === 'saving'
            ? 'Importando…'
            : phase === 'open'
              ? 'Conectando…'
              : (label ?? (itemRowId ? 'Reconectar' : 'Conectar banco'))}
      </Button>
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}
