import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptSecret } from '@/lib/crypto'
import { PluggyApiError, type PluggyClient } from './client'
import { credentialStatus, maskClientId, saveUserCredentials } from './credentials'

const store = vi.hoisted(() => ({ inserted: [] as Array<Record<string, unknown>>, rows: [] as unknown[] }))
vi.mock('@/lib/db', () => {
  const select = { from: () => select, where: async () => store.rows }
  return {
    db: {
      select: () => select,
      insert: () => ({ values: (v: Record<string, unknown>) => { store.inserted.push(v); return { onConflictDoUpdate: async () => {} } } }),
      delete: () => ({ where: async () => {} }),
    },
  }
})

const okClient = () => ({ getApiKey: async () => 'k' }) as unknown as PluggyClient
const rejectingClient = (status: number) => () =>
  ({ getApiKey: async () => { throw new PluggyApiError(status, null, 'x') } }) as unknown as PluggyClient
const ID = '0a1b2c3d-1111-2222-3333-444455556666'
const SECRET = 'sEcReT-value-123456'

beforeEach(() => {
  store.inserted = []; store.rows = []
  vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(44))
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '')
  vi.stubEnv('PLUGGY_CLIENT_ID', '')
  vi.stubEnv('PLUGGY_CLIENT_SECRET', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('saveUserCredentials', () => {
  it('validates with Pluggy and stores the secret encrypted', async () => {
    expect(await saveUserCredentials('u1', ` ${ID} `, ` ${SECRET} `, okClient)).toEqual({ ok: true })
    const [row] = store.inserted
    expect(row).toMatchObject({ userId: 'u1', clientId: ID })
    expect(JSON.stringify(row)).not.toContain(SECRET)
    expect(decryptSecret(row.clientSecretEncrypted as string)).toBe(SECRET)
  })

  it.each([401, 403, 400])('does not store credentials Pluggy rejects (%d)', async (status) => {
    expect(await saveUserCredentials('u1', ID, SECRET, rejectingClient(status))).toEqual({ error: 'O Pluggy recusou essas credenciais.' })
    expect(store.inserted).toHaveLength(0)
  })

  it('does not store when Pluggy is unreachable', async () => {
    const r = await saveUserCredentials('u1', ID, SECRET, rejectingClient(503))
    expect(r).toHaveProperty('error')
    expect(store.inserted).toHaveLength(0)
  })

  it.each([
    ['bad client id', 'x y', SECRET],
    ['short secret', ID, 'abc'],
    ['secret with spaces', ID, 'abc def ghi'],
  ])('rejects %s before calling Pluggy', async (_l, id, secret) => {
    const spy = vi.fn(okClient)
    expect(await saveUserCredentials('u1', id, secret, spy)).toHaveProperty('error')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('credentialStatus', () => {
  it('env credentials take precedence (no DB read)', async () => {
    vi.stubEnv('PLUGGY_CLIENT_ID', 'env-id'); vi.stubEnv('PLUGGY_CLIENT_SECRET', 'env-secret')
    store.rows = [{ clientId: ID, updatedAt: new Date() }]
    expect(await credentialStatus('u1')).toEqual({ source: 'env' })
  })
  it('reports stored credentials masked, never the secret', async () => {
    store.rows = [{ clientId: ID, updatedAt: new Date('2026-11-04T00:00:00Z') }]
    const s = await credentialStatus('u1')
    expect(s).toMatchObject({ source: 'user', clientIdMasked: '0a1b••••6666' })
    expect(JSON.stringify(s)).not.toContain(ID)
  })
  it('reports none when nothing is configured', async () => {
    expect(await credentialStatus('u1')).toEqual({ source: 'none' })
  })
  it('masks short ids completely', () => {
    expect(maskClientId('abc')).toBe('••••')
  })
})
