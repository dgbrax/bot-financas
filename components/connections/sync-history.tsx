import { cn } from '@/lib/utils'

export type SyncRunView = {
  id: number
  connectorName: string
  trigger: string
  status: string
  startedAt: string
  created: number
  updated: number
  removed: number
  matches: number
  errorMessage: string | null
}

const TRIGGER: Record<string, string> = { connect: 'Conexão', manual: 'Manual', webhook: 'Automática (webhook)', cron: 'Automática (diária)' }
const STATUS: Record<string, string> = { success: 'Concluída', waiting: 'Aguardando banco', error: 'Erro', running: 'Em andamento' }

export function SyncHistory({ runs }: { runs: SyncRunView[] }) {
  return (
    <section aria-labelledby="sync-history" className="flex flex-col gap-3">
      <h2 id="sync-history" className="text-sm font-medium">Histórico de importação</h2>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma importação ainda.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Quando</th>
                <th className="px-3 py-2 font-medium">Banco</th>
                <th className="px-3 py-2 font-medium">Origem</th>
                <th className="px-3 py-2 font-medium">Resultado</th>
                <th className="px-3 py-2 text-right font-medium">Novas</th>
                <th className="px-3 py-2 text-right font-medium">Atualizadas</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Possíveis duplicatas</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-3 py-2">{r.connectorName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{TRIGGER[r.trigger] ?? r.trigger}</td>
                  <td className={cn('px-3 py-2', r.status === 'error' && 'text-expense')}>
                    {STATUS[r.status] ?? r.status}
                    {r.errorMessage && <span className="block text-xs text-muted-foreground">{r.errorMessage}</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{r.created}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.updated}</td>
                  <td className="hidden px-3 py-2 text-right font-mono sm:table-cell">{r.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
