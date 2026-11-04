'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { addTransaction, type ActionState } from '@/app/actions/transactions'
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

export function TransactionForm() {
  const [type, setType] = useState<TransactionType>('expense')
  const [formKey, setFormKey] = useState(0)
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    addTransaction,
    {},
  )
  const amountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.ok) {
      setFormKey((k) => k + 1)
      amountRef.current?.focus()
    }
  }, [state])

  const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  return (
    <section
      aria-labelledby="new-transaction"
      className="flex flex-col gap-4 rounded-xl border p-4 md:p-5"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="new-transaction" className="text-sm font-medium">
          Nova transação
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
        className="grid grid-cols-2 gap-3 md:grid-cols-12 md:items-end"
      >
        <input type="hidden" name="type" value={type} />

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
            defaultValue={today()}
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
            required
          />
        </div>

        <div className="col-span-1 flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="category" className="text-xs text-muted-foreground">
            Categoria
          </Label>
          <Select name="category" required>
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
          <Select name="method" defaultValue="pix">
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

        <Button
          type="submit"
          disabled={pending}
          className="col-span-2 md:col-span-1"
        >
          {pending ? '...' : 'Salvar'}
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
