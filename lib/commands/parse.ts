// Pure parser for short text commands (e.g. from WhatsApp):
//   "add 320 trabalho"  -> income 320,   description "trabalho"
//   "+320 trabalho"     -> income 320
//   "-100 Lanche"       -> expense 100,  description "Lanche"
//   "-35 uber ontem"    -> expense 35,   date = yesterday
//   "-80 mercado 03/11" -> expense 80,   date = 3 Nov (this year, or last
//                          year if that would be in the future)
// Amounts accept "12,50", "12.50", "1.234,56" and "1,234.56".
// An optional date may end the message: hoje | ontem | anteontem |
// dd/mm | dd/mm/aa | dd/mm/aaaa. Impossible dates are rejected, never rolled
// over. No I/O and no clock: the reference date comes from the caller.

import { isValidISODate, type TransactionType } from '@/lib/finance'
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
      /** YYYY-MM-DD */
      occurredAt: string
    }
  | { ok: false; error: string }

export type ParseOptions = {
  /** Reference "today" as YYYY-MM-DD (the user's local date). */
  today: string
  maps?: KeywordMaps
}

export type KeywordMaps = {
  income: Record<string, string>
  expense: Record<string, string>
}

const DEFAULT_MAPS: KeywordMaps = {
  income: INCOME_KEYWORDS,
  expense: EXPENSE_KEYWORDS,
}

const MAX_AMOUNT = 1_000_000_000
const MIN_YEAR = 2000
const MAX_YEAR = 2100

const RELATIVE_DAYS: Record<string, number> = { hoje: 0, ontem: 1, anteontem: 2 }

function addDays(isoDate: string, delta: number) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + delta))
  return date.toISOString().slice(0, 10)
}

function isoFrom(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Reads a trailing date token. Returns null when the token is not a date,
 * or { error } when it looks like a date but is invalid.
 */
export function parseDateToken(
  token: string,
  today: string,
): { date: string } | { error: string } | null {
  const word = normalize(token)
  if (word in RELATIVE_DAYS) return { date: addDays(today, -RELATIVE_DAYS[word]) }

  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(token)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const todayYear = Number(today.slice(0, 4))
  let year: number
  if (m[3] === undefined) {
    year = todayYear
    // "30/12" typed in early January means last December.
    const candidate = isoFrom(year, month, day)
    if (isValidISODate(candidate) && candidate > today) year -= 1
  } else {
    year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  }
  const date = isoFrom(year, month, day)
  if (!isValidISODate(date) || year < MIN_YEAR || year > MAX_YEAR) {
    return { error: `Data inválida: ${token}.` }
  }
  return { date }
}
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
  { today, maps = DEFAULT_MAPS }: ParseOptions,
): ParsedCommand {
  if (!isValidISODate(today)) throw new Error(`Invalid reference date: ${today}`)
  // Several lines usually mean several transactions; merging them into one
  // description would silently record the wrong thing.
  if (/[\r\n]/.test(input.trim())) {
    return { ok: false, error: 'Envie um lançamento por mensagem.' }
  }
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

  const words = rest.trim() ? rest.trim().split(' ') : []
  let occurredAt = today
  const dateToken = words.length > 0 ? parseDateToken(words[words.length - 1], today) : null
  if (dateToken && 'error' in dateToken) return { ok: false, error: dateToken.error }
  if (dateToken) {
    occurredAt = dateToken.date
    words.pop()
  }

  const description = words.join(' ')
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
    occurredAt,
  }
}
