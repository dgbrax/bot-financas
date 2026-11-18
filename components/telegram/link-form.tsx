'use client'

import { useActionState, useState } from 'react'
import { createTelegramLink, revokeTelegramLink, type TelegramState } from '@/app/actions/telegram'
import { Button } from '@/components/ui/button'

export function TelegramLinkForm({ accounts, linked }: {
  accounts: { id: number; name: string }[]; linked: boolean
}) {
  const [hideLink, setHideLink] = useState(false)
  const [state, create, pending] = useActionState<TelegramState, FormData>(createTelegramLink, {})
  const [revoked, revoke, revoking] = useActionState<TelegramState, FormData>(revokeTelegramLink, {})
  return <div className="flex max-w-xl flex-col gap-5">
    {!linked && <form action={create} onSubmit={() => setHideLink(false)} className="flex flex-col items-start gap-3">
      <label htmlFor="telegram-account" className="text-sm font-medium">Conta para novos lançamentos</label>
      <select id="telegram-account" name="accountId" required className="w-full rounded-md border bg-background px-3 py-2">
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <Button disabled={pending || !accounts.length}>{pending ? 'Gerando…' : 'Gerar link de uso único'}</Button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.url && !hideLink && <div className="flex flex-col gap-2 text-sm">
        <a href={state.url} target="_blank" rel="noreferrer noopener" referrerPolicy="no-referrer" className="font-medium text-primary underline">Abrir @botfinancas_dgbrax_bot e vincular</a>
        <p>Link válido por 10 minutos e uma única utilização. Não compartilhe. Gerar outro invalida o anterior.</p>
      </div>}
    </form>}
    <form action={revoke} onSubmit={() => setHideLink(true)} className="flex flex-col items-start gap-2">
      <Button variant="outline" disabled={revoking}>{revoking ? 'Revogando…' : 'Revogar vínculo e links pendentes'}</Button>
      {revoked.error && <p role="alert">{revoked.error}</p>}
      {revoked.revoked && <p role="status" className="text-sm">Acesso revogado.</p>}
    </form>
  </div>
}
