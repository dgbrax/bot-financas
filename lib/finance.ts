export type TransactionType = 'income' | 'expense'

export const EXPENSE_CATEGORIES = [
  'Alimentação',
  'Mercado',
  'Transporte',
  'Moradia',
  'Contas',
  'Saúde',
  'Lazer',
  'Compras',
  'Educação',
  'Assinaturas',
  'Transferências',
  'Outros',
] as const

export const INCOME_CATEGORIES = [
  'Salário',
  'Freelance',
  'Investimentos',
  'Reembolso',
  'Presente',
  'Transferências',
  'Outros',
] as const

export const METHODS = [
  { value: 'pix', label: 'Pix' },
  { value: 'debito', label: 'Débito' },
  { value: 'credito', label: 'Crédito' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'saque', label: 'Saque' },
  { value: 'deposito', label: 'Depósito' },
  { value: 'tarifa', label: 'Tarifa' },
  { value: 'outro', label: 'Outro' },
] as const

export const METHOD_VALUES = METHODS.map((m) => m.value) as string[]

export function methodLabel(value: string) {
  return METHODS.find((m) => m.value === value)?.label ?? value
}

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatBRL(value: number) {
  return brl.format(value)
}

export function formatDay(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
}

export function formatMonthLabel(monthKey: string) {
  const [y, m] = monthKey.split('-').map(Number)
  const label = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function shortMonthLabel(monthKey: string) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'short' })
    .replace('.', '')
}

export function currentMonthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function isValidMonthKey(value: string | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-31). */
export function isValidISODate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = m.slice(1).map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  )
}

export function shiftMonth(monthKey: string, delta: number) {
  const [y, m] = monthKey.split('-').map(Number)
  const date = new Date(y, m - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function monthRange(monthKey: string) {
  const start = `${monthKey}-01`
  const end = `${shiftMonth(monthKey, 1)}-01`
  return { start, end }
}
