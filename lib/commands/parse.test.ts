import { describe, expect, it } from 'vitest'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/finance'
import { EXPENSE_KEYWORDS, INCOME_KEYWORDS } from './categories'
import { categorize, normalize, parseAmount, parseCommand } from './parse'

describe('parseCommand: spec examples', () => {
  it('"add 320 trabalho" is income 320 / trabalho', () => {
    expect(parseCommand('add 320 trabalho')).toEqual({
      ok: true,
      type: 'income',
      amount: 320,
      description: 'trabalho',
      category: 'Salário',
    })
  })

  it('"-100 Lanche" is expense 100 / Lanche', () => {
    expect(parseCommand('-100 Lanche')).toEqual({
      ok: true,
      type: 'expense',
      amount: 100,
      description: 'Lanche',
      category: 'Alimentação',
    })
  })
})

describe('parseCommand: syntax variants', () => {
  it.each([
    ['ADD 50 freela', 'income', 50],
    ['Add 50 freela', 'income', 50],
    ['add +50 freela', 'income', 50],
    ['+50 freela', 'income', 50],
    ['+ 50 freela', 'income', 50],
    ['- 50 uber', 'expense', 50],
    ['  -50    uber  ', 'expense', 50],
    ['-R$50 uber', 'expense', 50],
  ] as const)('%j -> %s %d', (input, type, amount) => {
    const r = parseCommand(input)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.type).toBe(type)
      expect(r.amount).toBe(amount)
    }
  })

  it('keeps the original description casing and inner text', () => {
    const r = parseCommand('-42,90 Almoço  no   Centro')
    expect(r).toMatchObject({ ok: true, description: 'Almoço no Centro' })
  })
})

describe('parseCommand: amounts', () => {
  it.each([
    ['-12,50 x', 12.5],
    ['-12.50 x', 12.5],
    ['-0,99 x', 0.99],
    ['-1.234,56 x', 1234.56],
    ['-1,234.56 x', 1234.56],
    ['-1.234 x', 1234],
    ['-1.000.000 x', 1_000_000],
    ['-12,5 x', 12.5],
  ])('%j -> %d', (input, amount) => {
    expect(parseCommand(input)).toMatchObject({ ok: true, amount })
  })
})

describe('parseCommand: categories', () => {
  it('matches keywords ignoring case and accents', () => {
    expect(parseCommand('-30 FARMÁCIA')).toMatchObject({ category: 'Saúde' })
    expect(parseCommand('-30 farmacia')).toMatchObject({ category: 'Saúde' })
  })

  it('matches a keyword anywhere in the description', () => {
    expect(parseCommand('-25 corrida de uber')).toMatchObject({
      category: 'Transporte',
    })
  })

  it('uses the first matching keyword in word order', () => {
    expect(parseCommand('-80 mercado e farmacia')).toMatchObject({
      category: 'Mercado',
    })
  })

  it('uses the map for the transaction type', () => {
    // "presente" exists in both maps with different categories.
    expect(parseCommand('+100 presente')).toMatchObject({ category: 'Presente' })
    expect(parseCommand('-100 presente')).toMatchObject({ category: 'Compras' })
  })

  it('does not match partial words', () => {
    expect(parseCommand('-10 barco')).toMatchObject({ category: 'Outros' })
  })

  it('falls back to "Outros" for unknown keywords', () => {
    expect(parseCommand('-10 xyz')).toMatchObject({ category: 'Outros' })
    expect(parseCommand('add 10 xyz')).toMatchObject({ category: 'Outros' })
  })

  it('accepts custom keyword maps', () => {
    const maps = { income: {}, expense: { pão: 'Mercado' } }
    expect(parseCommand('-5 pao', maps)).toMatchObject({ category: 'Mercado' })
    expect(parseCommand('-5 lanche', maps)).toMatchObject({ category: 'Outros' })
  })
})

describe('parseCommand: errors', () => {
  it.each([
    ['', 'empty'],
    ['320 trabalho', 'no sign or add'],
    ['adicionar 320 x', 'unknown verb'],
    ['add trabalho', 'no amount'],
    ['-abc lanche', 'non-numeric amount'],
    ['-12,345 x', 'more than 2 decimals'],
    ['-1.2.3 x', 'bad grouping'],
    ['-12, x', 'trailing separator'],
    ['add -100 x', 'negative amount after add'],
  ])('%j (%s) is rejected', (input) => {
    expect(parseCommand(input).ok).toBe(false)
  })

  it('rejects zero', () => {
    expect(parseCommand('-0 x')).toEqual({
      ok: false,
      error: 'O valor deve ser maior que zero.',
    })
  })

  it('rejects amounts above the limit', () => {
    expect(parseCommand('-1000000001 x').ok).toBe(false)
  })

  it('requires a description', () => {
    expect(parseCommand('add 320')).toEqual({
      ok: false,
      error: 'Informe uma descrição.',
    })
  })

  it('rejects descriptions over 120 chars', () => {
    expect(parseCommand(`-1 ${'a'.repeat(121)}`).ok).toBe(false)
    expect(parseCommand(`-1 ${'a'.repeat(120)}`).ok).toBe(true)
  })
})

describe('helpers', () => {
  it('normalize strips accents and case', () => {
    expect(normalize('  Ônibus   PARA  São Paulo ')).toBe('onibus para sao paulo')
  })

  it('parseAmount returns null for garbage', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount(',50')).toBeNull()
    expect(parseAmount('1e5')).toBeNull()
  })

  it('categorize ignores punctuation around keywords', () => {
    expect(categorize('uber, volta pra casa', 'expense')).toBe('Transporte')
  })
})

describe('keyword maps', () => {
  it('expense keywords map to valid expense categories', () => {
    for (const category of Object.values(EXPENSE_KEYWORDS)) {
      expect(EXPENSE_CATEGORIES).toContain(category)
    }
  })

  it('income keywords map to valid income categories', () => {
    for (const category of Object.values(INCOME_KEYWORDS)) {
      expect(INCOME_CATEGORIES).toContain(category)
    }
  })

  it('keywords are stored normalized so they can match', () => {
    for (const keyword of [
      ...Object.keys(EXPENSE_KEYWORDS),
      ...Object.keys(INCOME_KEYWORDS),
    ]) {
      expect(normalize(keyword)).toBe(keyword)
    }
  })
})
