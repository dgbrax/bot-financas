import { describe, expect, it } from 'vitest'
import { descriptionSimilarity, findMatch, MIN_SCORE, scoreMatch, type MatchSubject } from './reconcile'

const s = (p: Partial<MatchSubject> & { id: number }): MatchSubject => ({
  type: 'expense', amountCents: 4290, date: '2026-11-04', description: 'Almoço', accountId: 1, ...p,
})

describe('reconcile', () => {
  const imported = s({ id: 100, description: 'COMPRA CARTAO DEB RESTAURANTE ALMOCO', accountId: 9 })

  it('suggests a manual entry with same amount and date', () => {
    const m = findMatch(imported, [s({ id: 1, description: 'Almoço' })])
    expect(m).toMatchObject({ candidateId: 1 })
    expect(m!.score).toBeGreaterThanOrEqual(MIN_SCORE)
    expect(m!.reasons).toContain('mesma data')
  })

  it('requires exactly the same amount in cents', () => {
    expect(findMatch(imported, [s({ id: 1, amountCents: 4291 })])).toBeNull()
  })

  it('requires the same direction', () => {
    expect(findMatch(imported, [s({ id: 1, type: 'income' })])).toBeNull()
  })

  it('rejects dates more than 3 days apart', () => {
    expect(findMatch(imported, [s({ id: 1, date: '2026-11-08' })])).toBeNull()
    expect(scoreMatch(imported, s({ id: 1, date: '2026-11-07' }))).not.toBeNull()
  })

  it('a far date with an unrelated description is below the threshold', () => {
    expect(findMatch(imported, [s({ id: 1, date: '2026-11-07', description: 'Uber' })])).toBeNull()
  })

  it('prefers the closest/most similar candidate', () => {
    const m = findMatch(imported, [
      s({ id: 1, date: '2026-11-05', description: 'Uber' }),
      s({ id: 2, date: '2026-11-04', description: 'Almoço restaurante' }),
    ])
    expect(m?.candidateId).toBe(2)
  })

  it('skips candidates already matched to another import', () => {
    expect(findMatch(imported, [s({ id: 1 })], new Set([1]))).toBeNull()
  })

  it('similarity ignores accents, case and filler words', () => {
    expect(descriptionSimilarity('PIX ENVIADO Almoço', 'almoco')).toBe(1)
    expect(descriptionSimilarity('Netflix', 'Spotify')).toBe(0)
  })
})
