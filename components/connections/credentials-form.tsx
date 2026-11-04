'use client'

import { useActionState } from 'react'
import { KeyRound } from 'lucide-react'
import {
  deleteCredentialsAction,
  saveCredentialsAction,
  type CredentialsState,
} from '@/app/actions/pluggy'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Form to enter the user's own Pluggy credentials (never pre-filled). */
export function CredentialsForm({ replacing = false }: { replacing?: boolean }) {
  const [state, action, pending] = useActionState<CredentialsState, FormData>(saveCredentialsAction, {})
  return (
    <section aria-labelledby="pluggy-credentials" className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-col gap-1">
        <h2 id="pluggy-credentials" className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4" aria-hidden="true" />
          {replacing ? 'Trocar credenciais do Pluggy' : 'Credenciais do Pluggy'}
        </h2>
        <p className="text-sm text-muted-foreground">
          Informe o Client ID e o Client Secret da sua aplicação no painel do Pluggy. Eles são
          validados com o Pluggy e o secret é guardado criptografado; ele nunca volta para o
          navegador.
        </p>
      </div>
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pluggy-client-id" className="text-xs text-muted-foreground">Client ID</Label>
          <Input id="pluggy-client-id" name="clientId" autoComplete="off" spellCheck={false} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pluggy-client-secret" className="text-xs text-muted-foreground">Client Secret</Label>
          <Input id="pluggy-client-secret" name="clientSecret" type="password" autoComplete="off" required />
        </div>
        <Button type="submit" disabled={pending}>{pending ? 'Validando…' : 'Salvar'}</Button>
      </form>
      {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    </section>
  )
}

export function CredentialsSummary({ clientIdMasked, updatedAt }: { clientIdMasked: string; updatedAt: string }) {
  const [state, action, pending] = useActionState<CredentialsState, FormData>(deleteCredentialsAction, {})
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span>
        Usando suas credenciais do Pluggy (Client ID <span className="font-mono">{clientIdMasked}</span>,
        salvas em {new Date(updatedAt).toLocaleDateString('pt-BR')}).
      </span>
      <form
        action={action}
        onSubmit={(e) => {
          if (!window.confirm('Remover suas credenciais do Pluggy? As conexões existentes deixam de sincronizar até você informar credenciais de novo.')) e.preventDefault()
        }}
      >
        <Button type="submit" size="sm" variant="ghost" disabled={pending}>Remover credenciais</Button>
      </form>
      {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    </div>
  )
}
