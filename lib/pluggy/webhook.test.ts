import { describe, expect, it, vi } from 'vitest'
import { parseWebhookPayload, verifyWebhookSecret } from './webhook'

// The module imports the DB and sync code; only pure helpers are tested here.
// (vi.mock is hoisted above the import.)
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('./sync', () => ({ removeImported: vi.fn(), syncItem: vi.fn() }))

describe('verifyWebhookSecret', () => {
  it('accepts only the exact secret', () => {
    expect(verifyWebhookSecret('s3cret-value', 's3cret-value')).toBe(true)
    expect(verifyWebhookSecret('s3cret-valuX', 's3cret-value')).toBe(false)
    expect(verifyWebhookSecret('s3cret', 's3cret-value')).toBe(false)
  })
  it('rejects when either side is missing (unconfigured server never accepts)', () => {
    expect(verifyWebhookSecret(null, 's3cret')).toBe(false)
    expect(verifyWebhookSecret('s3cret', undefined)).toBe(false)
    expect(verifyWebhookSecret('', '')).toBe(false)
  })
})

describe('parseWebhookPayload', () => {
  it('reads documented fields', () => {
    expect(parseWebhookPayload({
      event: 'transactions/deleted', eventId: 'ev-1', clientId: 'c', itemId: 'it', accountId: 'a', transactionIds: ['t1', 't2'],
    })).toEqual({ event: 'transactions/deleted', eventId: 'ev-1', clientId: 'c', itemId: 'it', transactionIds: ['t1', 't2'] })
  })
  it('tolerates optional fields being absent', () => {
    expect(parseWebhookPayload({ event: 'connector/status_updated', eventId: 'ev-2' })).toMatchObject({ itemId: null, clientId: null, transactionIds: [] })
  })
  it.each([
    null, [], 'x', {}, { event: 'item/updated' }, { eventId: 'e' },
    { event: 'not an event', eventId: 'e' }, { event: 'item/updated', eventId: '' },
    { event: 'item/updated', eventId: 'x'.repeat(201) },
  ])('rejects %j', (body) => {
    expect(parseWebhookPayload(body)).toBeNull()
  })
  it('drops non-string transaction ids', () => {
    expect(parseWebhookPayload({ event: 'transactions/deleted', eventId: 'e', transactionIds: ['a', 1, null, 'b'] })?.transactionIds).toEqual(['a', 'b'])
  })
})
