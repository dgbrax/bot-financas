// Which Pluggy credentials to use for a user. Server-only.
// Precedence: server env vars (PLUGGY_CLIENT_ID/SECRET) > the user's stored
// credentials (encrypted in pluggy_credentials) > none.

import { eq, sql } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { db } from '@/lib/db'
import { pluggyCredentials } from '@/lib/db/schema'
import { PluggyApiError, PluggyClient, PluggyConfigError, pluggy } from './client'

export function envCredentialsConfigured() {
  return !!process.env.PLUGGY_CLIENT_ID && !!process.env.PLUGGY_CLIENT_SECRET
}

export type CredentialStatus =
  | { source: 'env' }
  | { source: 'user'; clientIdMasked: string; updatedAt: string }
  | { source: 'none' }

export function maskClientId(clientId: string) {
  return clientId.length <= 8 ? '••••' : `${clientId.slice(0, 4)}••••${clientId.slice(-4)}`
}

/** Status for the UI. Never returns the secret. */
export async function credentialStatus(userId: string): Promise<CredentialStatus> {
  if (envCredentialsConfigured()) return { source: 'env' }
  const [row] = await db
    .select({ clientId: pluggyCredentials.clientId, updatedAt: pluggyCredentials.updatedAt })
    .from(pluggyCredentials)
    .where(eq(pluggyCredentials.userId, userId))
  return row
    ? { source: 'user', clientIdMasked: maskClientId(row.clientId), updatedAt: row.updatedAt.toISOString() }
    : { source: 'none' }
}

// One client (and cached API key) per credential set.
const clients = new Map<string, PluggyClient>()

/** Pluggy client for this user's requests, or throws PluggyConfigError. */
export async function pluggyFor(userId: string): Promise<PluggyClient> {
  if (envCredentialsConfigured()) return pluggy()
  const [row] = await db
    .select()
    .from(pluggyCredentials)
    .where(eq(pluggyCredentials.userId, userId))
  if (!row) throw new PluggyConfigError('No Pluggy credentials configured')
  const cacheKey = `${row.clientId}|${row.clientSecretEncrypted}`
  let client = clients.get(cacheKey)
  if (!client) {
    client = new PluggyClient({ clientId: row.clientId, clientSecret: decryptSecret(row.clientSecretEncrypted) })
    clients.set(cacheKey, client)
  }
  return client
}

export type SaveResult = { ok: true } | { error: string }

/** Validates the credentials with POST /auth, then stores them encrypted. */
export async function saveUserCredentials(
  userId: string,
  clientId: string,
  clientSecret: string,
  makeClient: (id: string, secret: string) => PluggyClient = (id, secret) =>
    new PluggyClient({ clientId: id, clientSecret: secret }),
): Promise<SaveResult> {
  const id = clientId.trim()
  const secret = clientSecret.trim()
  if (!/^[A-Za-z0-9-]{8,100}$/.test(id)) return { error: 'Client ID inválido.' }
  if (secret.length < 8 || secret.length > 200 || /\s/.test(secret)) return { error: 'Client Secret inválido.' }
  try {
    await makeClient(id, secret).getApiKey()
  } catch (err) {
    if (err instanceof PluggyApiError && (err.status === 400 || err.status === 401 || err.status === 403)) {
      return { error: 'O Pluggy recusou essas credenciais.' }
    }
    return { error: 'Não foi possível validar com o Pluggy agora. Tente novamente.' }
  }
  const encrypted = encryptSecret(secret)
  await db
    .insert(pluggyCredentials)
    .values({ userId, clientId: id, clientSecretEncrypted: encrypted })
    .onConflictDoUpdate({
      target: pluggyCredentials.userId,
      set: { clientId: id, clientSecretEncrypted: encrypted, updatedAt: sql`now()` },
    })
  return { ok: true }
}

export async function deleteUserCredentials(userId: string) {
  await db.delete(pluggyCredentials).where(eq(pluggyCredentials.userId, userId))
}
