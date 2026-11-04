// Detects recurring transactions (subscriptions, salary, rent...). Pure.
//
// A group = same direction + same normalized description (digits, dates and
// punctuation removed). A group is recurring when it appears in at least
// MIN_MONTHS distinct months with amounts within AMOUNT_TOLERANCE of the
// group's median. Only the rows close to the median are flagged.

import { normalize } from '@/lib/commands/parse'

export type RecurringInput = {
  id: number
  type: 'income' | 'expense'
  amountCents: number
  /** YYYY-MM-DD */
  date: string
  description: string
}

const MIN_MONTHS = 3
const AMOUNT_TOLERANCE = 0.1

export function recurringKey(description: string) {
  return normalize(description)
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\b(parcela|parc|pix|ted|doc|compra|pagamento|pagto|pgto)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export function detectRecurring(rows: RecurringInput[]): Set<number> {
  const groups = new Map<string, RecurringInput[]>()
  for (const r of rows) {
    const key = recurringKey(r.description)
    if (key.length < 3) continue
    const k = `${r.type}|${key}`
    const g = groups.get(k)
    if (g) g.push(r)
    else groups.set(k, [r])
  }

  const out = new Set<number>()
  for (const group of groups.values()) {
    if (group.length < MIN_MONTHS) continue
    const mid = median(group.map((r) => r.amountCents))
    const close = group.filter(
      (r) => Math.abs(r.amountCents - mid) <= Math.abs(mid) * AMOUNT_TOLERANCE,
    )
    const months = new Set(close.map((r) => r.date.slice(0, 7)))
    if (months.size >= MIN_MONTHS) close.forEach((r) => out.add(r.id))
  }
  return out
}
