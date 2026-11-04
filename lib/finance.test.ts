import { describe, expect, it } from 'vitest'
import { isValidISODate, isValidMonthKey, monthRange, shiftMonth } from './finance'

describe('isValidISODate', () => {
  it.each(['2026-11-04', '2024-02-29', '2026-12-31', '2026-01-01'])('accepts %s', (d) => {
    expect(isValidISODate(d)).toBe(true)
  })

  it.each([
    '2026-02-31', // regex-valid but not a real date (Postgres would throw)
    '2025-02-29', // not a leap year
    '2026-13-01',
    '2026-00-10',
    '2026-11-4',
    '04/11/2026',
    '',
  ])('rejects %j', (d) => {
    expect(isValidISODate(d)).toBe(false)
  })
})

describe('month helpers', () => {
  it('shiftMonth crosses year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-11', -5)).toBe('2026-06')
  })

  it('monthRange is [first day, first day of next month)', () => {
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' })
  })

  it('isValidMonthKey guards the ?mes= query param', () => {
    expect(isValidMonthKey('2026-11')).toBe(true)
    expect(isValidMonthKey('2026-13')).toBe(false)
    expect(isValidMonthKey("2026-11' or 1=1")).toBe(false)
    expect(isValidMonthKey(undefined)).toBe(false)
  })
})
