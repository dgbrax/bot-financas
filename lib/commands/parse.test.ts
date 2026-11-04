import { describe, expect, it } from 'vitest'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/finance'
import { EXPENSE_KEYWORDS, INCOME_KEYWORDS } from './categories'
import {
  categorize,
  normalize,
  parseAmount,
  parseCommand,
  parseDateToken,
  type KeywordMaps,
} from './parse'

const TODAY = '2026-11-04'
const p = (input: string, maps?: KeywordMaps) =>
  parseCommand(input, { today: TODAY, maps })

describe('parseCommand: spec examples', () => {
  it('"add 320 trabalho" is income 320 / trabalho', () => {
    expect(p('add 320 trabalho')).toEqual({
      ok: true,
      type: 'income',
      amount: 320,
      description: 'trabalho',
      category: 'Salário',
      occurredAt: TODAY,
    })
  })

  it('"-100 Lanche" is expense 100 / Lanche', () => {
    expect(p('-100 Lanche')).toEqual({
      ok: true,
      type: 'expense',
      amount: 100,
      description: 'Lanche',
      category: 'Alimentação',
      occurredAt: TODAY,
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
    const r = p(input)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.type).toBe(type)
      expect(r.amount).toBe(amount)
    }
  })

  it('keeps the original description casing and inner text', () => {
    const r = p('-42,90 Almoço  no   Centro')
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
    expect(p(input)).toMatchObject({ ok: true, amount })
  })
})

describe('parseCommand: categories', () => {
  it('matches keywords ignoring case and accents', () => {
    expect(p('-30 FARMÁCIA')).toMatchObject({ category: 'Saúde' })
    expect(p('-30 farmacia')).toMatchObject({ category: 'Saúde' })
  })

  it('matches a keyword anywhere in the description', () => {
    expect(p('-25 corrida de uber')).toMatchObject({
      category: 'Transporte',
    })
  })

  it('uses the first matching keyword in word order', () => {
    expect(p('-80 mercado e farmacia')).toMatchObject({
      category: 'Mercado',
    })
  })

  it('uses the map for the transaction type', () => {
    // "presente" exists in both maps with different categories.
    expect(p('+100 presente')).toMatchObject({ category: 'Presente' })
    expect(p('-100 presente')).toMatchObject({ category: 'Compras' })
  })

  it('does not match partial words', () => {
    expect(p('-10 barco')).toMatchObject({ category: 'Outros' })
  })

  it('falls back to "Outros" for unknown keywords', () => {
    expect(p('-10 xyz')).toMatchObject({ category: 'Outros' })
    expect(p('add 10 xyz')).toMatchObject({ category: 'Outros' })
  })

  it('accepts custom keyword maps', () => {
    const maps = { income: {}, expense: { pão: 'Mercado' } }
    expect(p('-5 pao', maps)).toMatchObject({ category: 'Mercado' })
    expect(p('-5 lanche', maps)).toMatchObject({ category: 'Outros' })
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
    expect(p(input).ok).toBe(false)
  })

  it('rejects zero', () => {
    expect(p('-0 x')).toEqual({
      ok: false,
      error: 'O valor deve ser maior que zero.',
    })
  })

  it('rejects amounts above the limit', () => {
    expect(p('-1000000001 x').ok).toBe(false)
  })

  it('requires a description', () => {
    expect(p('add 320')).toEqual({
      ok: false,
      error: 'Informe uma descrição.',
    })
  })

  it('rejects descriptions over 120 chars', () => {
    expect(p(`-1 ${'a'.repeat(121)}`).ok).toBe(false)
    expect(p(`-1 ${'a'.repeat(120)}`).ok).toBe(true)
  })
})

describe('parseCommand: dates', () => {
  it('defaults to the reference date when no date is given', () => {
    expect(p('-10 lanche')).toMatchObject({ occurredAt: TODAY })
  })

  it.each([
    ['-10 lanche hoje', '2026-11-04'],
    ['-10 lanche ontem', '2026-11-03'],
    ['-10 lanche Ontem', '2026-11-03'],
    ['-10 lanche anteontem', '2026-11-02'],
    ['-10 lanche 03/11', '2026-11-03'],
    ['-10 lanche 3/11', '2026-11-03'],
    ['-10 lanche 03/11/2025', '2025-11-03'],
    ['-10 lanche 03/11/25', '2025-11-03'],
    ['-10 lanche 29/02/2024', '2024-02-29'],
  ])('%j -> %s', (input, date) => {
    expect(p(input)).toMatchObject({ ok: true, description: 'lanche', occurredAt: date })
  })

  it('a day/month later than today means last year', () => {
    // On 2026-11-04, "25/12" can only be last Christmas.
    expect(p('-10 presente 25/12')).toMatchObject({ occurredAt: '2025-12-25' })
  })

  it('relative dates cross month and year boundaries', () => {
    expect(parseCommand('-1 x ontem', { today: '2026-03-01' })).toMatchObject({
      occurredAt: '2026-02-28',
    })
    expect(parseCommand('-1 x ontem', { today: '2026-01-01' })).toMatchObject({
      occurredAt: '2025-12-31',
    })
  })

  it.each(['-10 lanche 31/02', '-10 lanche 29/02/2025', '-10 lanche 00/05', '-10 lanche 12/13', '-10 lanche 01/01/1999'])(
    '%j is rejected, not rolled over',
    (input) => {
      const r = p(input)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/^Data inválida/)
    },
  )

  it('only the last word is treated as a date', () => {
    expect(p('-10 ontem eu comi')).toMatchObject({
      description: 'ontem eu comi',
      occurredAt: TODAY,
    })
  })

  it('a date alone is not a description', () => {
    expect(p('-10 ontem')).toEqual({ ok: false, error: 'Informe uma descrição.' })
    expect(p('-10 03/11')).toEqual({ ok: false, error: 'Informe uma descrição.' })
  })

  it('category is matched on the description without the date', () => {
    expect(p('-35 uber ontem')).toMatchObject({ category: 'Transporte', description: 'uber' })
  })

  it('requires a valid reference date', () => {
    expect(() => parseCommand('-1 x', { today: '2026-02-31' })).toThrow()
  })

  it('parseDateToken ignores non-date words', () => {
    expect(parseDateToken('lanche', TODAY)).toBeNull()
    expect(parseDateToken('1/2/3/4', TODAY)).toBeNull()
  })
})

describe('parseCommand: unexpected input', () => {
  it('explains why multi-line messages are rejected', () => {
    expect(p('-10 lanche\n-20 uber')).toEqual({
      ok: false,
      error: 'Envie um lançamento por mensagem.',
    })
    // A trailing newline alone is fine.
    expect(p('-10 lanche\n').ok).toBe(true)
  })

  it.each([
    ['multi-line text', '-10 lanche\n-20 uber'],
    ['only spaces', '    '],
    ['emoji instead of amount', '-💸 lanche'],
    ['amount glued to words', '-10reais lanche'],
    ['two signs', '--10 lanche'],
  ])('%s is rejected', (_label, input) => {
    expect(p(input).ok).toBe(false)
  })

  it('never returns a non-positive or non-finite amount when ok', () => {
    const inputs = ['-0,01 x', '+999999999 x', '-1.000.000.000 x', 'add 0,001 x', '-NaN x', '-Infinity x']
    for (const input of inputs) {
      const r = p(input)
      if (r.ok) {
        expect(Number.isFinite(r.amount)).toBe(true)
        expect(r.amount).toBeGreaterThan(0)
        expect(r.amount).toBeLessThanOrEqual(1_000_000_000)
        expect(Math.round(r.amount * 100) / 100).toBe(r.amount)
      }
    }
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
