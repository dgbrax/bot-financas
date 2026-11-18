import { describe, expect, it } from 'vitest'
import { centsToDecimal, fromCents, parseAmount, sumCents, toCents } from './money'

describe('toCents', () => {
  it.each([
    ['1500.00', 150000],
    ['42.9', 4290],
    ['0.01', 1],
    ['-42.90', -4290],
    ['7', 700],
    [12.5, 1250],
    [0.29, 29], // 0.29 * 100 = 28.999999999999996 in floats
  ] as const)('%j -> %d', (input, cents) => {
    expect(toCents(input)).toBe(cents)
  })

  it('rejects malformed values instead of guessing', () => {
    for (const bad of ['', 'abc', '1.234', '1,50', NaN, Infinity]) {
      expect(() => toCents(bad as string | number)).toThrow()
    }
  })
})

describe('centsToDecimal', () => {
  it.each([
    [150000, '1500.00'],
    [1, '0.01'],
    [-4290, '-42.90'],
    [0, '0.00'],
  ])('%d -> %s', (cents, text) => {
    expect(centsToDecimal(cents)).toBe(text)
  })

  it('round-trips with toCents', () => {
    for (const c of [0, 1, 99, 100, 123456789, -5]) {
      expect(toCents(centsToDecimal(c))).toBe(c)
    }
  })
})

describe('sumCents', () => {
  it('is exact where float addition is not', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(sumCents(['0.10', '0.20'])).toBe(30)
    expect(fromCents(sumCents(['0.10', '0.20']))).toBe(0.3)
  })

  it('sums many values without drift', () => {
    const values = Array.from({ length: 1000 }, () => '0.01')
    expect(sumCents(values)).toBe(1000)
  })
})

describe('parseAmount (form + parser input)', () => {
  it('reads both decimal styles the same way', () => {
    // Regression: the form used to strip all dots, turning "12.50" into 1250.
    expect(parseAmount('12.50')).toBe(12.5)
    expect(parseAmount('12,50')).toBe(12.5)
    expect(parseAmount('1.234,56')).toBe(1234.56)
    expect(parseAmount('R$ 1.500,00')).toBe(1500)
  })

  it('rejects ambiguous or malformed input', () => {
    for (const bad of ['12,345', '1.2.3', '-5', '12,', 'abc', '']) {
      expect(parseAmount(bad)).toBeNull()
    }
  })
})
