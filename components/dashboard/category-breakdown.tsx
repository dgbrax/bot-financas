import { formatBRL } from '@/lib/finance'
import type { StatementItem } from './transaction-list'

export function CategoryBreakdown({
  items,
  total,
}: {
  items: StatementItem[]
  total: number
}) {
  const byCategory = new Map<string, number>()
  for (const t of items) {
    if (t.type !== 'expense') continue
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount)
  }
  const rows = [...byCategory.entries()].sort((a, b) => b[1] - a[1])

  return (
    <section aria-labelledby="by-category" className="flex flex-col gap-4">
      <h2 id="by-category" className="text-sm font-medium">
        Onde você gastou
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma saída registrada neste mês.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(([category, value]) => {
            const pct = total > 0 ? (value / total) * 100 : 0
            return (
              <li key={category} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span>{category}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono">{formatBRL(value)}</span>
                    <span className="w-10 text-right font-mono text-xs text-muted-foreground">
                      {pct.toFixed(0)}%
                    </span>
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-muted">
                  <div
                    className="h-1 rounded-full bg-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
