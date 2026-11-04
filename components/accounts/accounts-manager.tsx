'use client'

import { useActionState, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  createAccount,
  deleteAccount,
  updateAccount,
  type AccountActionState,
} from '@/app/actions/accounts'
import { ACCOUNT_NAME_MAX, BANKS, bankLabel } from '@/lib/banks'
import { formatBRL } from '@/lib/finance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type ManagedAccount = {
  id: number
  name: string
  bank: string
  balance: number
  balanceAt: string | null
}

function formatSnapshot(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function AccountsManager({
  accounts,
  total,
}: {
  accounts: ManagedAccount[]
  total: number
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-baseline justify-between gap-4 border-b pb-4">
        <span className="text-sm text-muted-foreground">Saldo total</span>
        <span
          className={cn(
            'font-mono text-2xl font-semibold tracking-tight',
            total < 0 && 'text-expense',
          )}
        >
          {formatBRL(total)}
        </span>
      </div>

      <ul className="flex flex-col gap-3" aria-label="Suas contas">
        {accounts.map((a) => (
          <AccountRow
            key={`${a.id}-${a.name}-${a.balance}-${a.balanceAt}`}
            account={a}
          />
        ))}
      </ul>

      <NewAccountForm />
    </div>
  )
}

function AccountRow({ account }: { account: ManagedAccount }) {
  const [state, action, pending] = useActionState<AccountActionState, FormData>(
    updateAccount,
    {},
  )
  const [delState, delAction, deleting] = useActionState<
    AccountActionState,
    FormData
  >(deleteAccount, {})
  const error = state.error ?? delState.error

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4',
        (pending || deleting) && 'opacity-60',
      )}
      aria-label={`Conta ${account.name}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <span className="font-medium">{account.name}</span>
          <span className="text-xs text-muted-foreground">
            {bankLabel(account.bank)}
            {account.balanceAt
              ? ` · saldo informado em ${formatSnapshot(account.balanceAt)}`
              : ' · saldo calculado pelos lançamentos'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className={cn(
              'font-mono text-lg font-semibold',
              account.balance < 0 && 'text-expense',
            )}
          >
            {formatBRL(account.balance)}
          </span>
          <form
            action={delAction}
            onSubmit={(e) => {
              if (
                !window.confirm(
                  `Excluir a conta "${account.name}"? Essa ação não pode ser desfeita.`,
                )
              ) {
                e.preventDefault()
              }
            }}
          >
            <input type="hidden" name="id" value={account.id} />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              disabled={deleting}
              aria-label={`Excluir conta ${account.name}`}
              className="size-8 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </form>
        </div>
      </div>

      <form
        action={action}
        className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <input type="hidden" name="id" value={account.id} />
        <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <Label
            htmlFor={`name-${account.id}`}
            className="text-xs text-muted-foreground"
          >
            Nome
          </Label>
          <Input
            id={`name-${account.id}`}
            name="name"
            defaultValue={account.name}
            maxLength={ACCOUNT_NAME_MAX}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`balance-${account.id}`}
            className="text-xs text-muted-foreground"
          >
            Saldo atual (R$)
          </Label>
          <Input
            id={`balance-${account.id}`}
            name="balance"
            inputMode="decimal"
            placeholder="Deixe vazio para não alterar"
            className="font-mono"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? '...' : 'Salvar'}
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  )
}

function NewAccountForm() {
  const [state, action, pending] = useActionState<AccountActionState, FormData>(
    createAccount,
    {},
  )
  const [formKey, setFormKey] = useState(0)
  useEffect(() => {
    if (state.ok) setFormKey((k) => k + 1)
  }, [state])

  return (
    <section
      aria-labelledby="new-account"
      className="flex flex-col gap-4 rounded-xl border border-dashed p-4"
    >
      <h2 id="new-account" className="text-sm font-medium">
        Nova conta
      </h2>
      <form
        key={formKey}
        action={action}
        className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <Label htmlFor="new-name" className="text-xs text-muted-foreground">
            Nome
          </Label>
          <Input
            id="new-name"
            name="name"
            placeholder="Ex: Nubank"
            maxLength={ACCOUNT_NAME_MAX}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-bank" className="text-xs text-muted-foreground">
            Banco
          </Label>
          <Select name="bank" items={BANKS} required>
            <SelectTrigger id="new-bank" className="w-full">
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {BANKS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? '...' : 'Adicionar'}
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </section>
  )
}
