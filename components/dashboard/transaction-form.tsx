'use client'

import Link from 'next/link'
import { useActionState, useEffect, useRef, useState } from 'react'
import { saveTransaction, type ActionState } from '@/app/actions/transactions'
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  METHODS,
  type TransactionType,
} from '@/lib/finance'
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

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type AccountOption = { id: number; name: string; isManual: boolean }

export type EditableTransaction = {
  id: number
  type: TransactionType
  amount: number
  description: string
  category: string
  method: string
  occurredAt: string
  accountId: number | null
  /** 'manual' rows are fully editable; imported rows only their category. */
  source?: string
}

const amountInput = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Create form, or edit form when `editing` is set. Mount with
 * a key derived from `editing` so switching/saving resets the inputs.
 */
export function TransactionForm({
  accounts,
  editing = null,
  doneHref,
}: {
  accounts: AccountOption[]
  editing?: EditableTransaction | null
  /** Where to go after saving/cancelling an edit. */
  doneHref: string
}) {
  const defaultAccountId = String(
    editing?.accountId ??
      (accounts.find((a) => a.isManual) ?? accounts[0])?.id ??
      '',
  )
  const accountItems = accounts.map((a) => ({
    value: String(a.id),
    label: a.name,
  }))
  const [type, setType] = useState<TransactionType>(editing?.type ?? 'expense')
  const [formKey, setFormKey] = useState(0)
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveTransaction,
    {},
  )
  const amountRef = useRef<HTMLInputElement>(null)

  // Edits redirect server-side to `doneHref`; only creates come back with ok.
  useEffect(() => {
    if (!state.ok) return
    setFormKey((k) => k + 1)
    amountRef.current?.focus()
  }, [state])

  // Imported rows: amount, date and account come from the bank.
  const locked = !!editing && !!editing.source && editing.source !== 'manual'

  // Keep the original category only while the type is unchanged.
  const defaultCategory =
    editing && editing.type === type ? editing.category : undefined

  const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  return (
    <section
      id="transaction-form"
      aria-labelledby="new-transaction"
      className={cn(
        'flex scroll-mt-6 flex-col gap-4 rounded-xl border p-4 md:p-5',
        editing && 'border-primary/50 ring-3 ring-primary/10',
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="new-transaction" className="text-sm font-medium">
          {editing ? 'Editar transação' : 'Nova transação'}
        </h2>
        <div
          role="radiogroup"
          aria-label="Tipo de transação"
          className="flex rounded-lg bg-muted p-0.5 text-sm"
        >
          {(
            [
              ['expense', 'Saída'],
              ['income', 'Entrada'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              disabled={locked}
              onClick={() => setType(value)}
              className={cn(
                'rounded-md px-3 py-1 font-medium text-muted-foreground transition-colors',
                type === value && 'bg-background text-foreground shadow-sm',
                type === value && value === 'income' && 'text-income',
                type === value && value === 'expense' && 'text-expense',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <form
        key={`${type}-${formKey}`}
        action={formAction}
        className="grid grid-cols-2 gap-3 md:grid-cols-14 md:items-end"
      >
        <input type="hidden" name="type" value={type} />
        {editing && (
          <>
            <input type="hidden" name="id" value={editing.id} />
            <input type="hidden" name="returnTo" value={doneHref} />
          </>
        )}

        <div className="col-span-1 flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="amount" className="text-xs text-muted-foreground">
            Valor (R$)
          </Label>
          <Input
            ref={amountRef}
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={editing ? amountInput.format(editing.amount) : undefined}
            readOnly={locked}
            required
            className="font-mono"
          />
        </div>

        <div className="col-span-1 flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="occurredAt" className="text-xs text-muted-foreground">
            Data
          </Label>
          <Input
            id="occurredAt"
            name="occurredAt"
            type="date"
            defaultValue={editing?.occurredAt ?? today()}
            readOnly={locked}
            required
          />
        </div>

        <div className="col-span-2 flex flex-col gap-1.5 md:col-span-3">
          <Label htmlFor="description" className="text-xs text-muted-foreground">
            Descrição
          </Label>
          <Input
            id="description"
            name="description"
            placeholder={type === 'income' ? 'Ex: Salário' : 'Ex: Almoço'}
            maxLength={120}
            defaultValue={editing?.description}
            readOnly={locked}
            required
          />
        </div>

        <div className="col-span-1 flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="category" className="text-xs text-muted-foreground">
            Categoria
          </Label>
          <Select name="category" defaultValue={defaultCategory} required>
            <SelectTrigger id="category" className="w-full">
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-1 flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="method" className="text-xs text-muted-foreground">
            Forma
          </Label>
          <Select
            name="method"
            defaultValue={editing?.method ?? 'pix'}
            items={METHODS}
            disabled={locked}
          >
            <SelectTrigger id="method" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-2 flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="accountId" className="text-xs text-muted-foreground">
            Conta
          </Label>
          <Select
            name="accountId"
            defaultValue={defaultAccountId}
            items={accountItems}
            disabled={locked}
            required
          >
            <SelectTrigger id="accountId" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accountItems.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="submit"
          disabled={pending}
          className="col-span-2 md:col-span-1"
        >
          {pending ? '...' : editing ? 'Atualizar' : 'Salvar'}
        </Button>
      </form>

      {editing && (
        <p className="text-xs text-muted-foreground">
          Editando “{editing.description}”.{' '}
          {locked && 'Importada do banco: só a categoria pode ser alterada. '}
          <Link
            href={doneHref}
            scroll={false}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Cancelar edição
          </Link>
        </p>
      )}

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </section>
  )
}
