// Pure parser for short text commands (e.g. from WhatsApp):
//   "add 320 trabalho"  -> income 320,   description "trabalho"
//   "+320 trabalho"     -> income 320
//   "-100 Lanche"       -> expense 100,  description "Lanche"
// Amounts accept "12,50", "12.50", "1.234,56" and "1,234.56".
// No I/O here: callers decide what to do with the result.

import type { TransactionType } from '@/lib/finance'
import { parseAmount } from '@/lib/money'
import {
  DEFAULT_CATEGORY,
  EXPENSE_KEYWORDS,
  INCOME_KEYWORDS,
} from './categories'

export { parseAmount }

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
