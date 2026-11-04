// Suggests which manual entry an imported bank transaction duplicates. Pure.
//
// Safety: this only ever produces a *suggestion*. Nothing is deleted or
// overwritten; the user confirms or dismisses each match in the UI.
//
// Required: same direction, exact same amount (in cents), dates at most
// MAX_DAYS apart. The score then rewards close dates, similar descriptions
// and the same account.

import { normalize } from '@/lib/commands/parse'

export type MatchSubject = {
  id: number
  type: 'income' | 'expense'
  amountCents: number
  /** YYYY-MM-DD */
  date: string
  description: string
  accountId: number
}

export type Match = { candidateId: number; score: number; reasons: string[] }

export const MAX_DAYS = 3
export const MIN_SCORE = 65

const STOP = new Set(['de', 'da', 'do', 'em', 'no', 'na', 'para', 'pix', 'ted', 'doc', 'compra', 'pagamento', 'pagto', 'enviado', 'enviada', 'recebido', 'recebida', 'cartao', 'deb', 'debito', 'credito', 'the', 'and'])

function tokens(text: string) {
  return new Set(
    normalize(text)
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(' ')
      .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)),
  )
}

/** Jaccard similarity of meaningful words, 0..1. */
export function descriptionSimilarity(a: string, b: string) {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

function dayDiff(a: string, b: string) {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

export function scoreMatch(imported: MatchSubject, manual: MatchSubject): Match | null {
  if (imported.type !== manual.type) return null
  if (imported.amountCents !== manual.amountCents) return null
  const days = dayDiff(imported.date, manual.date)
  if (days > MAX_DAYS) return null

  const reasons = ['mesmo valor']
  let score = 50
  if (days === 0) { score += 25; reasons.push('mesma data') }
  else if (days === 1) { score += 15; reasons.push('1 dia de diferença') }
  else { score += 5; reasons.push(`${days} dias de diferença`) }

  const sim = descriptionSimilarity(imported.description, manual.description)
  if (sim > 0) { score += Math.round(sim * 25); reasons.push('descrição parecida') }
  if (imported.accountId === manual.accountId) { score += 10; reasons.push('mesma conta') }
  return { candidateId: manual.id, score, reasons }
}

/**
 * Best manual candidate for an imported transaction, or null when nothing
 * reaches MIN_SCORE. `taken` holds manual ids already matched elsewhere.
 */
export function findMatch(
  imported: MatchSubject,
  candidates: MatchSubject[],
  taken: ReadonlySet<number> = new Set(),
): Match | null {
  let best: Match | null = null
  for (const c of candidates) {
    if (c.id === imported.id || taken.has(c.id)) continue
    const m = scoreMatch(imported, c)
    if (m && m.score >= MIN_SCORE && (!best || m.score > best.score)) best = m
  }
  return best
}
