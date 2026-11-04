// Pure constants, safe to import from client components.

// Institutions offered when creating an account. `bank` stores the value.
export const BANKS = [
  { value: 'inter', label: 'Inter' },
  { value: 'santander', label: 'Santander' },
  { value: 'nubank', label: 'Nubank' },
  { value: 'itau', label: 'Itaú' },
  { value: 'bradesco', label: 'Bradesco' },
  { value: 'bb', label: 'Banco do Brasil' },
  { value: 'caixa', label: 'Caixa' },
  { value: 'c6', label: 'C6 Bank' },
  { value: 'manual', label: 'Dinheiro / manual' },
  { value: 'outro', label: 'Outro' },
] as const

export const BANK_VALUES: readonly string[] = BANKS.map((b) => b.value)

export function bankLabel(value: string) {
  return BANKS.find((b) => b.value === value)?.label ?? value
}

export const ACCOUNT_NAME_MAX = 40
