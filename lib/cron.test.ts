import { describe, expect, it } from 'vitest'
import { verifyCronAuthorization } from './cron'

const secret = 'a'.repeat(32)

describe('verifyCronAuthorization', () => {
  it('accepts the exact Bearer secret', () => {
    expect(verifyCronAuthorization(`Bearer ${secret}`, secret)).toBe(true)
  })
  it.each([
    [null],
    [''],
    [secret],
    [`Bearer ${secret}x`],
    [`bearer ${secret}`],
    [`Bearer ${'b'.repeat(32)}`],
  ])('rejects %j', (header) => {
    expect(verifyCronAuthorization(header, secret)).toBe(false)
  })
  it('never authorizes when CRON_SECRET is unset or too short', () => {
    expect(verifyCronAuthorization('Bearer ', '')).toBe(false)
    expect(verifyCronAuthorization('Bearer undefined', undefined)).toBe(false)
    expect(verifyCronAuthorization('Bearer short', 'short')).toBe(false)
  })
})
