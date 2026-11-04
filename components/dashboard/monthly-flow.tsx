import Link from 'next/link'
import { formatBRL, shortMonthLabel } from '@/lib/finance'
import { cn } from '@/lib/utils'

type FlowPoint = { month: string; income: number; expense: number }

export function MonthlyFlow({
  data,
  activeMonth,
}: {
  data: FlowPoint[]
  activeMonth: string
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]))
  const avgExpense =
    data.reduce((s, d) => s + d.expense, 0) / Math.max(1, data.length)

  return (
    <section aria-labelledby="monthly-flow" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="monthly-flow" className="text-sm font-medium">
          Últimos 6 meses
        </h2>
        <p className="text-xs text-muted-foreground">
          Média de saídas{' '}
          <span className="font-mono text-foreground">
            {formatBRL(avgExpense)}
          </span>
        </p>
      </div>

      <div className="flex h-40 items-end gap-3">
        {data.map((d) => (
          <Link
            key={d.month}
            href={`/?mes=${d.month}`}
            className="group flex h-full flex-1 flex-col items-center gap-2"
            aria-label={`${shortMonthLabel(d.month)}: entradas ${formatBRL(d.income)}, saídas ${formatBRL(d.expense)}`}
          >
            <div className="flex w-full flex-1 items-end justify-center gap-1">
              <div
                className="w-full max-w-4 rounded-t-sm bg-income transition-opacity group-hover:opacity-80"
                style={{ height: `${(d.income / max) * 100}%` }}
              />
              <div
                className="w-full max-w-4 rounded-t-sm bg-expense/80 transition-opacity group-hover:opacity-80"
                style={{ height: `${(d.expense / max) * 100}%` }}
              />
            </div>
            <span
              className={cn(
                'text-xs capitalize text-muted-foreground',
                d.month === activeMonth && 'font-medium text-foreground',
              )}
            >
              {shortMonthLabel(d.month)}
            </span>
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-income" aria-hidden="true" />
          Entradas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-expense/80" aria-hidden="true" />
          Saídas
        </span>
      </div>
    </section>
  )
}
