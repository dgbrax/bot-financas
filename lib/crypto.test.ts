import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptionKey, encryptSecret, EncryptionKeyError } from './crypto'

const key = randomBytes(32)

describe('encryptSecret / decryptSecret', () => {
  it('round-trips and never contains the plaintext', () => {
    const enc = encryptSecret('super-secret-value', key)
    expect(enc).not.toContain('super-secret-value')
    expect(decryptSecret(enc, key)).toBe('super-secret-value')
  })
  it('uses a fresh IV each time', () => {
    expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key))
  })
  it('fails with the wrong key or tampered data (authenticated)', () => {
    const enc = encryptSecret('x', key)
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow()
    const parts = enc.split('.')
    parts[3] = Buffer.from('tampered').toString('base64url')
    expect(() => decryptSecret(parts.join('.'), key)).toThrow()
    expect(() => decryptSecret('garbage', key)).toThrow()
  })
})

describe('encryptionKey', () => {
  it('uses CREDENTIALS_ENCRYPTION_KEY when set (32 bytes)', () => {
    const k = randomBytes(32)
    expect(encryptionKey({ CREDENTIALS_ENCRYPTION_KEY: k.toString('base64') }).equals(k)).toBe(true)
    expect(() => encryptionKey({ CREDENTIALS_ENCRYPTION_KEY: 'short' })).toThrow(EncryptionKeyError)
  })
  it('derives a stable key from BETTER_AUTH_SECRET otherwise', () => {
    const env = { BETTER_AUTH_SECRET: 'b'.repeat(44) }
    expect(encryptionKey(env).equals(encryptionKey(env))).toBe(true)
    expect(encryptionKey(env).equals(Buffer.from('b'.repeat(32)))).toBe(false)
  })
  it('refuses to run without any key material', () => {
    expect(() => encryptionKey({})).toThrow(EncryptionKeyError)
  })
})
