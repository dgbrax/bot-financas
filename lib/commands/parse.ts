// Pure parser for short text commands (e.g. from WhatsApp):
//   "add 320 trabalho"  -> income 320,   description "trabalho"
//   "+320 trabalho"     -> income 320
//   "-100 Lanche"       -> expense 100,  description "Lanche"
// Amounts accept "12,50", "12.50", "1.234,56" and "1,234.56".
// No I/O here: callers decide what to do with the result.

import type { TransactionType } from '@/lib/finance'
import {
  DEFAULT_CATEGORY,
  EXPENSE_KEYWORDS,
  INCOME_KEYWORDS,
} from './categories'

export type ParsedCommand =
  | {
      ok: true
      type: TransactionType
      amount: number
      description: string
      category: string
    }
  | { ok: false; error: string }

export type KeywordMaps = {
  income: Record<string, string>
  expense: Record<string, string>
}

const DEFAULT_MAPS: KeywordMaps = {
  income: INCOME_KEYWORDS,
  expense: EXPENSE_KEYWORDS,
}

const MAX_AMOUNT = 1_000_000_000
const MAX_DESCRIPTION = 120

// "add 320 x" | "add +320 x" | "+320 x" | "-320 x" | "+ 320 x"
const COMMAND_RE = /^(?:(add)\s+\+?|([+-])\s*)(\S+)(?:\s+(.*))?$/i

/** Lowercase, strip accents, collapse whitespace. */
export function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse a pt-BR or en-style amount. Returns null if invalid.
 * - Both separators: the last one is the decimal separator.
 * - Only commas: a single comma is decimal ("12,5"); several are thousands.
 * - Only dots: a single dot followed by exactly 3 digits is thousands
 *   ("1.234" = 1234); otherwise decimal ("12.50"); several are thousands.
 */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/^r\$\s*/i, '')
  if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let intPart: string
  let decPart = ''

  if (lastComma >= 0 && lastDot >= 0) {
    const decSep = lastComma > lastDot ? ',' : '.'
    const thouSep = decSep === ',' ? '.' : ','
    const i = s.lastIndexOf(decSep)
    intPart = s.slice(0, i)
    decPart = s.slice(i + 1)
    if (intPart.includes(decSep)) return null
    if (!isGroupedThousands(intPart, thouSep)) return null
    intPart = intPart.split(thouSep).join('')
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.'
    const parts = s.split(sep)
    if (parts.length > 2) {
      if (!isGroupedThousands(s, sep)) return null
      intPart = parts.join('')
    } else if (sep === '.' && parts[1].length === 3) {
      intPart = parts.join('')
    } else {
      intPart = parts[0]
      decPart = parts[1]
    }
  } else {
    intPart = s
  }

  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(decPart)) return null
  if (decPart.length > 2) return null

  const value = Number(`${intPart}.${decPart || '0'}`)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100) / 100
}

function isGroupedThousands(s: string, sep: string) {
  if (!s.includes(sep)) return /^\d+$/.test(s)
  const [head, ...rest] = s.split(sep)
  return /^\d{1,3}$/.test(head) && rest.every((g) => /^\d{3}$/.test(g))
}

/** First keyword (in description word order) that maps to a category. */
export function categorize(
  description: string,
  type: TransactionType,
  maps: KeywordMaps = DEFAULT_MAPS,
): string {
  const map = maps[type]
  const text = ` ${normalize(description).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `
  let best: { index: number; category: string } | null = null
  for (const [keyword, category] of Object.entries(map)) {
    const index = text.indexOf(` ${normalize(keyword)} `)
    if (index >= 0 && (!best || index < best.index)) {
      best = { index, category }
    }
  }
  return best?.category ?? DEFAULT_CATEGORY
}

export function parseCommand(
  input: string,
  maps: KeywordMaps = DEFAULT_MAPS,
): ParsedCommand {
  const text = input.replace(/\s+/g, ' ').trim()
  const match = COMMAND_RE.exec(text)
  if (!match) {
    return {
      ok: false,
      error: 'Formato não reconhecido. Use "add 320 trabalho" ou "-100 lanche".',
    }
  }

  const [, add, sign, rawAmount, rest = ''] = match
  const type: TransactionType = add || sign === '+' ? 'income' : 'expense'

  const amount = parseAmount(rawAmount)
  if (amount === null) return { ok: false, error: 'Valor inválido.' }
  if (amount <= 0) return { ok: false, error: 'O valor deve ser maior que zero.' }
  if (amount > MAX_AMOUNT) return { ok: false, error: 'Valor muito alto.' }

  const description = rest.trim()
  if (!description) return { ok: false, error: 'Informe uma descrição.' }
  if (description.length > MAX_DESCRIPTION) {
    return { ok: false, error: 'Descrição muito longa (até 120 caracteres).' }
  }

  return {
    ok: true,
    type,
    amount,
    description,
    category: categorize(description, type, maps),
  }
}
