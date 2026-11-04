import { describe, expect, it } from 'vitest'
import { detectRecurring, recurringKey, type RecurringInput } from './recurring'

let id = 0
const r = (description: string, amountCents: number, date: string, type: 'income' | 'expense' = 'expense'): RecurringInput =>
  ({ id: ++id, description, amountCents, date, type })

describe('detectRecurring', () => {
  it('flags monthly subscriptions and salary (Sandbox pattern)', () => {
    const rows = [
      r('NETFLIX.COM', 5590, '2026-08-01'), r('NETFLIX.COM', 5590, '2026-09-01'), r('NETFLIX.COM', 5590, '2026-10-01'),
      r('SALARIO EMPRESA XYZ LTDA', 850000, '2026-08-05', 'income'), r('SALARIO EMPRESA XYZ LTDA', 850000, '2026-09-05', 'income'),
      r('SALARIO EMPRESA XYZ LTDA', 850000, '2026-10-05', 'income'),
      r('Padaria', 1250, '2026-10-02'),
    ]
    const flagged = detectRecurring(rows)
    expect(rows.filter((x) => flagged.has(x.id)).map((x) => x.description)).toEqual([
      'NETFLIX.COM', 'NETFLIX.COM', 'NETFLIX.COM',
      'SALARIO EMPRESA XYZ LTDA', 'SALARIO EMPRESA XYZ LTDA', 'SALARIO EMPRESA XYZ LTDA',
    ])
  })

  it('needs 3 different months, not 3 rows in one month', () => {
    const rows = [r('UBER TRIP', 2000, '2026-10-01'), r('UBER TRIP', 2000, '2026-10-02'), r('UBER TRIP', 2000, '2026-10-03')]
    expect(detectRecurring(rows).size).toBe(0)
  })

  it('tolerates small amount changes (bills) but not outliers', () => {
    const rows = [r('ENEL ENERGIA', 18000, '2026-08-15'), r('ENEL ENERGIA', 18500, '2026-09-15'), r('ENEL ENERGIA', 17500, '2026-10-15'), r('ENEL ENERGIA', 90000, '2026-11-15')]
    const flagged = detectRecurring(rows)
    expect(flagged.size).toBe(3)
    expect(flagged.has(rows[3].id)).toBe(false)
  })

  it('ignores digits and dates in descriptions', () => {
    expect(recurringKey('PIX ENVIADO 12/10 ALUGUEL APTO 302')).toBe(recurringKey('PIX ENVIADO 12/11 ALUGUEL APTO 302'))
  })

  it('does not mix income and expense with the same text', () => {
    const rows = [r('TRANSF JOAO', 1000, '2026-08-01'), r('TRANSF JOAO', 1000, '2026-09-01', 'income'), r('TRANSF JOAO', 1000, '2026-10-01')]
    expect(detectRecurring(rows).size).toBe(0)
  })
})
