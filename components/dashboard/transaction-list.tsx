'use client'

import { useMemo, useState, useTransition } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { deleteTransaction } from '@/app/actions/transactions'
import { formatBRL, formatDay, methodLabel } from '@/lib/finance'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type StatementItem = {
  id: number
  type: 'income' | 'expense'
  amount: number
  description: string
  category: string
  method: string
  occurredAt: string
}

type Filter = 'all' | 'income' | 'expense'

const FILTERS: [Filter, string][] = [
  ['all', 'Tudo'],
  ['income', 'Entradas'],
  ['expense', 'Saídas'],
]

export function TransactionList({ items }: { items: StatementItem[] }) {
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

  function onDelete(id: number) {
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
        <div className="flex items-center gap-2">
          <div className="relative">
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
              className="h-8 w-40 pl-8"
            />
          </div>
          <div className="flex rounded-lg bg-muted p-0.5 text-xs">
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
                'group flex items-center gap-4 py-3',
                pendingId === t.id && 'opacity-40',
              )}
            >
              <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                {formatDay(t.occurredAt)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{t.description}</span>
                <span className="text-xs text-muted-foreground">
                  {t.category} · {methodLabel(t.method)}
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
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground opacity-100 hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                onClick={() => onDelete(t.id)}
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
