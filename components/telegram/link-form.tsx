'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { createTelegramLink, revokeTelegramLink, type TelegramState } from '@/app/actions/telegram'
import { Button, buttonVariants } from '@/components/ui/button'

export function TelegramLinkForm({ accounts, linked }: {
  accounts: { id: number; name: string }[]; linked: boolean
}) {
  const [hideLink, setHideLink] = useState(false)
  const [expired, setExpired] = useState(false)
  const [copyStatus, setCopyStatus] = useState<{ error: boolean; text: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [state, create, pending] = useActionState<TelegramState, FormData>(async (previous, form) => {
    try { return await createTelegramLink(previous, form) }
    catch (error) {
      unstable_rethrow(error)
      return { error: 'Não foi possível gerar o link. Verifique sua conexão e tente novamente.' }
    }
  }, {})
  const [revoked, revoke, revoking] = useActionState<TelegramState, FormData>(async (previous, form) => {
    try { return await revokeTelegramLink(previous, form) }
    catch (error) {
      unstable_rethrow(error)
      return { error: 'Não foi possível revogar o vínculo. Verifique sua conexão e tente novamente.' }
    }
  }, {})

  useEffect(() => {
    if (!state.expiresAt) { setExpired(false); return }
    const remaining = new Date(state.expiresAt).getTime() - Date.now()
    setExpired(remaining <= 0)
    if (remaining <= 0) return
    const timer = setTimeout(() => { setExpired(true); setCopyStatus(null) }, remaining)
    return () => clearTimeout(timer)
  }, [state.expiresAt])

  useEffect(() => {
    if (revoked.revoked) { setHideLink(true); setCopyStatus(null) }
  }, [revoked])

  const showLink = !!state.url && !hideLink && !expired && !pending && !revoking

  async function copyLink() {
    if (!showLink || !state.url) return
    if (!state.expiresAt || Date.now() >= new Date(state.expiresAt).getTime()) {
      setExpired(true)
      return
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(state.url)
      setCopyStatus({ error: false, text: 'Link copiado.' })
    } catch {
      input.current?.focus()
      input.current?.select()
      input.current?.setSelectionRange(0, state.url.length)
      setCopyStatus({ error: true, text: 'Não foi possível copiar automaticamente. O link foi selecionado; copie manualmente.' })
    }
  }

  return <div className="flex w-full min-w-0 max-w-xl flex-col gap-5">
    {!linked && <form action={create} onSubmit={() => { setHideLink(false); setCopyStatus(null) }} className="flex w-full min-w-0 flex-col items-start gap-3">
      <label htmlFor="telegram-account" className="text-sm font-medium">Conta para novos lançamentos</label>
      <select id="telegram-account" name="accountId" required disabled={pending || revoking} className="w-full min-w-0 rounded-md border bg-background px-3 py-2">
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <Button type="submit" className="h-11 w-full sm:w-auto" disabled={pending || revoking || !accounts.length}>{pending ? 'Gerando…' : 'Gerar link de uso único'}</Button>
      {state.error && <p role="alert" className="text-sm">{state.error}</p>}
      {showLink && <div className="flex w-full min-w-0 flex-col gap-3 text-sm">
        <p role="status">Link gerado. Válido por 10 minutos e uma única utilização. Não compartilhe.</p>
        <label htmlFor="telegram-link" className="font-medium">Link temporário</label>
        <input ref={input} id="telegram-link" type="text" readOnly value={state.url} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} className="w-full min-w-0 rounded-md border bg-background px-3 py-2 font-mono text-xs" />
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button type="button" className="h-11 w-full sm:w-auto" onClick={copyLink}>Copiar link</Button>
          <a data-telegram-open href={state.url} target="_blank" rel="noreferrer noopener" referrerPolicy="no-referrer" className={`${buttonVariants({ variant: 'outline' })} h-11 w-full sm:w-auto`}>Abrir no Telegram</a>
        </div>
        {copyStatus && <p role={copyStatus.error ? 'alert' : 'status'}>{copyStatus.text}</p>}
        <p>Gerar outro link invalida o anterior.</p>
      </div>}
      {expired && state.url && !hideLink && !pending && <p role="alert" className="text-sm">O link expirou. Gere um novo link.</p>}
    </form>}
    <form action={revoke} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="outline" className="h-11 w-full sm:w-auto" disabled={revoking || pending}>{revoking ? 'Revogando…' : 'Revogar vínculo e links pendentes'}</Button>
      {revoked.error && <p role="alert">{revoked.error}</p>}
      {revoked.revoked && <p role="status" className="text-sm">Acesso revogado.</p>}
    </form>
  </div>
}
