import { formatBRL } from '@/lib/finance'
import { cn } from '@/lib/utils'

export function BalanceSummary({
  balance,
  income,
  expense,
}: {
  balance: number
  income: number
  expense: number
}) {
  const net = income - expense
  const flowTotal = income + expense
  const incomeShare = flowTotal > 0 ? (income / flowTotal) * 100 : 50

  return (
    <section aria-labelledby="balance-label" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p id="balance-label" className="text-sm text-muted-foreground">
          Saldo total
        </p>
        <p
          className={cn(
            'font-mono text-4xl font-semibold tracking-tight md:text-5xl',
            balance < 0 && 'text-expense',
          )}
        >
          {formatBRL(balance)}
        </p>
      </div>

      <div className="flex flex-col gap-2 md:w-96">
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`Entradas ${formatBRL(income)}, saídas ${formatBRL(expense)}`}
        >
          {flowTotal > 0 && (
            <>
              <div className="bg-income" style={{ width: `${incomeShare}%` }} />
              <div className="flex-1 bg-expense" />
            </>
          )}
        </div>
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Entradas</dt>
            <dd className="font-mono text-income">{formatBRL(income)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Saídas</dt>
            <dd className="font-mono text-expense">{formatBRL(expense)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Resultado</dt>
            <dd
              className={cn(
                'font-mono',
                net >= 0 ? 'text-income' : 'text-expense',
              )}
            >
              {net >= 0 ? '+' : ''}
              {formatBRL(net)}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
