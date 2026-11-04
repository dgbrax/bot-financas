// Symmetric encryption for secrets stored in the database (AES-256-GCM).
// Key: CREDENTIALS_ENCRYPTION_KEY (32 bytes, base64) if set, otherwise
// derived from BETTER_AUTH_SECRET with HKDF (rotating that secret makes
// stored values unreadable; users then re-enter them).

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const VERSION = 'v1'

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EncryptionKeyError'
  }
}

export function encryptionKey(env: Record<string, string | undefined> = process.env): Buffer {
  const explicit = env.CREDENTIALS_ENCRYPTION_KEY
  if (explicit) {
    const key = Buffer.from(explicit, 'base64')
    if (key.length !== 32) throw new EncryptionKeyError('CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (base64)')
    return key
  }
  const base = env.BETTER_AUTH_SECRET
  if (!base || base.length < 32) throw new EncryptionKeyError('No encryption key: set CREDENTIALS_ENCRYPTION_KEY or BETTER_AUTH_SECRET')
  return Buffer.from(hkdfSync('sha256', base, 'bot-financas', 'stored-credentials-v1', 32))
}

/** "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(plain: string, key: Buffer = encryptionKey()): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

export function decryptSecret(payload: string, key: Buffer = encryptionKey()): string {
  const [version, iv, tag, ct] = payload.split('.')
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error('Unsupported secret format')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}
