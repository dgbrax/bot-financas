'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { Pencil, Search, Trash2 } from 'lucide-react'
import { deleteTransaction } from '@/app/actions/transactions'
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
}

type Filter = 'all' | 'income' | 'expense'

const FILTERS: [Filter, string][] = [
  ['all', 'Tudo'],
  ['income', 'Entradas'],
  ['expense', 'Saídas'],
]

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(
      (t) =>
        (filter === 'all' || t.type === filter) &&
        (!q ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)),
    )
  }, [items, filter, query])

  function onDelete(id: number, description: string) {
    if (!window.confirm(`Excluir "${description}"? Essa ação não pode ser desfeita.`)) {
      return
    }
    setPendingId(id)
    startTransition(async () => {
      await deleteTransaction(id)
      setPendingId(null)
    })
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
                  'rounded-md px-2.5 py-1 font-medium text-muted-foreground transition-colors',
                  filter === value && 'bg-background text-foreground shadow-sm',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? 'Nenhuma transação neste mês. Registre a primeira acima.'
            : 'Nada encontrado com esse filtro.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y border-y">
          {visible.map((t) => (
            <li
              key={t.id}
              className={cn(
                'group flex items-center gap-3 py-3 sm:gap-4',
                pendingId === t.id && 'opacity-40',
                editingId === t.id && 'bg-primary/5',
              )}
            >
              <span className="w-16 shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
                {formatDay(t.occurredAt)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{t.description}</span>
                <span className="text-xs text-muted-foreground">
                  {t.category} · {methodLabel(t.method)}
                  {t.accountName && ` · ${t.accountName}`}
                </span>
              </div>
              <span
                className={cn(
                  'font-mono text-sm',
                  t.type === 'income' ? 'text-income' : 'text-foreground',
                )}
              >
                {t.type === 'income' ? '+' : '-'}
                {formatBRL(t.amount)}
              </span>
              <Link
                href={`/?mes=${month}&editar=${t.id}#transaction-form`}
                aria-label={`Editar ${t.description}`}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'icon' }),
                  'size-8 text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
                  editingId === t.id && 'md:opacity-100',
                )}
              >
                <Pencil className="size-4" />
              </Link>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
