// Money helpers. Amounts are stored as numeric(14,2) and arrive from Postgres
// as strings ("1500.00"). Do arithmetic in integer cents, never in floats.

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

/**
 * Exact conversion of a numeric(…,2) string (or a 2-decimal number) to
 * integer cents. "1500.00" -> 150000, "-42.9" -> -4290.
 */
export function toCents(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${value}`)
    return Math.round(value * 100)
  }
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!m) throw new Error(`Invalid amount: ${value}`)
  const [, minus, int, dec = ''] = m
  const cents = Number(int) * 100 + Number(dec.padEnd(2, '0'))
  return minus ? -cents : cents
}

/** Cents -> numeric string for the database ("150000" -> "1500.00"). */
export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Invalid cents: ${cents}`)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Cents -> number of reais, for display/formatting only. */
export function fromCents(cents: number): number {
  return cents / 100
}

export function sumCents(values: Array<string | number>): number {
  return values.reduce<number>((total, v) => total + toCents(v), 0)
}
