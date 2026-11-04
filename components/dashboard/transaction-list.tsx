'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { Check, Pencil, Search, Trash2 } from 'lucide-react'
import {
  acceptCategory,
  confirmMatch,
  deleteTransaction,
  dismissMatch,
  undoMatch,
} from '@/app/actions/transactions'
import { channelLabel } from '@/lib/bank/classify'
import { formatBRL, formatDay, methodLabel } from '@/lib/finance'
import { Input } from '@/components/ui/input'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type StatementItem = {
  id: number
  type: 'income' | 'expense'
  amount: number
  description: string
  category: string
  method: string
  occurredAt: string
  accountName: string | null
  source: string
  status: 'posted' | 'pending'
  categoryStatus: 'confirmed' | 'suggested' | 'review'
  isTransfer: boolean
  recurring: boolean
  merchant: string | null
  matchStatus: 'suggested' | 'confirmed' | 'dismissed' | null
  duplicateOf: number | null
  matchCandidate: { id: number; description: string; occurredAt: string } | null
}

type Filter = 'all' | 'income' | 'expense' | 'review'

const FILTERS: [Filter, string][] = [
  ['all', 'Tudo'],
  ['income', 'Entradas'],
  ['expense', 'Saídas'],
  ['review', 'Revisar'],
]

export function needsReview(t: StatementItem) {
  return t.categoryStatus === 'review' || t.matchStatus === 'suggested'
}

function Badge({ children, tone = 'muted', title }: { children: React.ReactNode; tone?: 'muted' | 'warn' | 'info'; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'warn' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        tone === 'info' && 'bg-primary/10 text-primary',
      )}
    >
      {children}
    </span>
  )
}

export function TransactionList({
  items,
  month,
  editingId = null,
}: {
  items: StatementItem[]
  month: string
  editingId?: number | null
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  const reviewCount = items.filter(needsReview).length

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(
      (t) =>
        (filter === 'all' ||
          (filter === 'review' ? needsReview(t) : t.type === filter)) &&
        (!q ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          (t.merchant ?? '').toLowerCase().includes(q)),
    )
  }, [items, filter, query])

  function run(id: number, action: () => Promise<void>) {
    setPendingId(id)
    startTransition(async () => {
      await action()
      setPendingId(null)
    })
  }

  function onDelete(id: number, description: string) {
    if (!window.confirm(`Excluir "${description}"? Essa ação não pode ser desfeita.`)) {
      return
    }
    run(id, () => deleteTransaction(id))
  }

  return (
    <section aria-labelledby="statement" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="statement" className="text-sm font-medium">
          Extrato
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar"
              aria-label="Buscar no extrato"
              className="h-8 w-full pl-8 sm:w-40"
            />
          </div>
          <div className="flex shrink-0 rounded-lg bg-muted p-0.5 text-xs">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  'rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors sm:px-2.5',
                  filter === value && 'bg-background text-foreground shadow-sm',
                )}
              >
                {label}
                {value === 'review' && reviewCount > 0 && ` (${reviewCount})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? 'Nenhuma transação neste mês. Registre a primeira acima ou conecte um banco.'
            : filter === 'review'
              ? 'Nada para revisar neste mês.'
              : 'Nada encontrado com esse filtro.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y border-y">
          {visible.map((t) => {
            const imported = t.source === 'bank'
            const channel = channelLabel(t.method, t.type)
            const isDuplicate = t.duplicateOf !== null
            return (
              <li
                key={t.id}
                aria-label={t.description}
                className={cn(
                  'group flex flex-col gap-2 py-3',
                  pendingId === t.id && 'opacity-40',
                  editingId === t.id && 'bg-primary/5',
                )}
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <span className="w-16 shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
                    {formatDay(t.occurredAt)}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cn('truncate text-sm', isDuplicate && 'text-muted-foreground line-through')}>
                      {t.description}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.category}
                      {imported ? (channel ? ` · ${channel}` : '') : ` · ${methodLabel(t.method)}`}
                      {t.accountName && ` · ${t.accountName}`}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {imported && <Badge tone="info" title="Importada do banco via Pluggy">Banco</Badge>}
                      {t.status === 'pending' && <Badge tone="warn">Pendente</Badge>}
                      {t.isTransfer && <Badge title="Movimentação entre suas contas; não entra em entradas/saídas">Transferência</Badge>}
                      {t.recurring && <Badge>Recorrente</Badge>}
                      {t.categoryStatus === 'review' && <Badge tone="warn" title="Categoria automática incerta">Revisar categoria</Badge>}
                      {isDuplicate && <Badge title="Confirmada como a mesma transação importada do banco; não conta nos totais">Duplicata</Badge>}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'font-mono text-sm whitespace-nowrap',
                      t.type === 'income' ? 'text-income' : 'text-foreground',
                      (t.isTransfer || isDuplicate) && 'text-muted-foreground',
                    )}
                  >
                    {t.type === 'income' ? '+' : '-'}
                    {formatBRL(t.amount)}
                  </span>
                  {imported && t.categoryStatus !== 'confirmed' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-income"
                      onClick={() => run(t.id, () => acceptCategory(t.id))}
                      disabled={pendingId === t.id}
                      aria-label={`Categoria ok: ${t.description}`}
                      title={`Manter "${t.category}"`}
                    >
                      <Check className="size-4" />
                    </Button>
                  )}
                  <Link
                    href={`/?mes=${month}&editar=${t.id}#transaction-form`}
                    aria-label={`Editar ${t.description}`}
                    className={cn(
                      buttonVariants({ variant: 'ghost', size: 'icon' }),
                      'size-8 text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
                      (editingId === t.id || (imported && t.categoryStatus !== 'confirmed')) && 'md:opacity-100',
                    )}
                  >
                    <Pencil className="size-4" />
                  </Link>
                  {!imported && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-ml-2 size-8 text-muted-foreground opacity-100 hover:text-destructive sm:-ml-3 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                      onClick={() => onDelete(t.id, t.description)}
                      disabled={pendingId === t.id}
                      aria-label={`Excluir ${t.description}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>

                {imported && t.matchStatus === 'suggested' && t.matchCandidate && (
                  <div
                    role="group"
                    aria-label={`Possível duplicata de ${t.matchCandidate.description}`}
                    className="ml-0 flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs sm:ml-20"
                  >
                    <span className="min-w-0 flex-1">
                      Parece ser o lançamento manual “{t.matchCandidate.description}” de{' '}
                      {formatDay(t.matchCandidate.occurredAt)}. É a mesma transação?
                    </span>
                    <Button size="sm" variant="outline" onClick={() => run(t.id, () => confirmMatch(t.id))} disabled={pendingId === t.id}>
                      É a mesma
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => run(t.id, () => dismissMatch(t.id))} disabled={pendingId === t.id}>
                      São diferentes
                    </Button>
                  </div>
                )}
                {isDuplicate && (
                  <div className="ml-0 flex items-center gap-2 text-xs text-muted-foreground sm:ml-20">
                    Mantida como histórico; não conta nos totais.
                    <Button size="sm" variant="ghost" onClick={() => run(t.id, () => undoMatch(t.id))} disabled={pendingId === t.id}>
                      Desfazer
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
