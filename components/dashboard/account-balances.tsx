import { formatBRL } from '@/lib/finance'
import { cn } from '@/lib/utils'

export type AccountBalance = {
  id: number
  name: string
  balance: number
  balanceAt: string | null
}

function formatSnapshotDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
}

export function AccountBalances({
  accounts,
  unassigned,
}: {
  accounts: AccountBalance[]
  unassigned: number | null
}) {
  const rows = [
    ...accounts.map((a) => ({
      key: String(a.id),
      name: a.name,
      balance: a.balance,
      note: a.balanceAt ? `saldo em ${formatSnapshotDate(a.balanceAt)}` : null,
    })),
    ...(unassigned !== null
      ? [{ key: 'unassigned', name: 'Sem conta', balance: unassigned, note: null }]
      : []),
  ]

  return (
    <section aria-labelledby="accounts-label" className="flex flex-col gap-3">
      <h2 id="accounts-label" className="text-sm font-medium">
        Contas
      </h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-1 rounded-xl border p-3">
            <span className="text-xs text-muted-foreground">{r.name}</span>
            <span
              className={cn(
                'font-mono text-lg font-semibold tracking-tight',
                r.balance < 0 && 'text-expense',
              )}
            >
              {formatBRL(r.balance)}
            </span>
            {r.note && (
              <span className="text-xs text-muted-foreground">{r.note}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
