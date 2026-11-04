import { describe, expect, it, vi } from 'vitest'
import { PluggyApiError, PluggyClient, PluggyConfigError } from './client'
import { PluggyValidationError } from './types'

type Call = { method: string; path: string; apiKey: string | null; body: unknown }

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** Fake Pluggy: routes by "METHOD /path" (path without query unless given). */
function fakePluggy(routes: Record<string, (c: Call, n: number) => Response>) {
  const calls: Call[] = []
  const counts = new Map<string, number>()
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const call: Call = {
      method,
      path: u.pathname + u.search,
      apiKey: headers['X-API-KEY'] ?? null,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    const key = Object.keys(routes).find((k) => k === `${method} ${call.path}`) ??
      Object.keys(routes).find((k) => k === `${method} ${u.pathname}`)
    if (!key) throw new Error(`unexpected ${method} ${call.path}`)
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    return routes[key](call, n)
  })
  return { fetchMock: fetchMock as unknown as typeof fetch, calls }
}

const auth = (key = 'key-1') => () => json(200, { apiKey: key })
const noSleep = async () => {}

function client(fetchMock: typeof fetch, now = () => 0) {
  return new PluggyClient({ clientId: 'id', clientSecret: 'secret', fetch: fetchMock, now, sleep: noSleep })
}

const tx = (id: string, extra: Record<string, unknown> = {}) => ({
  id, accountId: 'acc-1', description: `T ${id}`, amount: -10, date: '2026-10-01T00:00:00.000Z',
  type: 'DEBIT', status: 'POSTED', currencyCode: 'BRL', ...extra,
})

describe('PluggyClient: authentication', () => {
  it('requires credentials', () => {
    expect(() => new PluggyClient({ clientId: '', clientSecret: '' })).toThrow(PluggyConfigError)
  })

  it('posts clientId/clientSecret to /auth and sends the key as X-API-KEY', async () => {
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': auth('abc'),
      'GET /items/it-1': () => json(200, { id: 'it-1', status: 'UPDATED', connector: { id: 2, name: 'Pluggy Bank', isSandbox: true } }),
    })
    const item = await client(fetchMock).getItem('it-1')
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth', apiKey: null, body: { clientId: 'id', clientSecret: 'secret' } })
    expect(calls[1]).toMatchObject({ method: 'GET', path: '/items/it-1', apiKey: 'abc' })
    expect(item).toMatchObject({ id: 'it-1', status: 'UPDATED', connector: { isSandbox: true } })
  })

  it('caches the API key and refreshes it before the 2h expiry', async () => {
    let t = 0
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': (_c, n) => json(200, { apiKey: `key-${n}` }),
      'GET /items/x': () => json(200, { id: 'x', status: 'UPDATED', connector: { id: 1, name: 'B' } }),
    })
    const c = client(fetchMock, () => t)
    await c.getItem('x'); await c.getItem('x')
    t = 105 * 60 * 1000 // still fresh
    await c.getItem('x')
    expect(calls.filter((x) => x.path === '/auth')).toHaveLength(1)
    t = 111 * 60 * 1000 // within 10 min of the 2h expiry -> refresh
    await c.getItem('x')
    const authCalls = calls.filter((x) => x.path === '/auth').length
    expect(authCalls).toBe(2)
    expect(calls.at(-1)?.apiKey).toBe('key-2')
  })

  it('shares one /auth call between concurrent requests', async () => {
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': auth(),
      'GET /items/x': () => json(200, { id: 'x', status: 'UPDATED', connector: { id: 1, name: 'B' } }),
    })
    const c = client(fetchMock)
    await Promise.all([c.getItem('x'), c.getItem('x'), c.getItem('x')])
    expect(calls.filter((x) => x.path === '/auth')).toHaveLength(1)
  })

  it('re-authenticates once when the key is rejected (expired credentials)', async () => {
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': (_c, n) => json(200, { apiKey: `key-${n}` }),
      'GET /items/x': (c) => c.apiKey === 'key-1'
        ? json(401, { message: 'invalid api key' })
        : json(200, { id: 'x', status: 'UPDATED', connector: { id: 1, name: 'B' } }),
    })
    await client(fetchMock).getItem('x')
    expect(calls.map((c) => `${c.path}:${c.apiKey}`)).toEqual(['/auth:null', '/items/x:key-1', '/auth:null', '/items/x:key-2'])
  })

  it('does not loop on a feature that is not enabled (real 403)', async () => {
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': auth(),
      'GET /items/x': () => json(403, { code: 403, codeDescription: 'LIST_ITEMS_FEATURE_NOT_ENABLED', message: 'not enabled' }),
    })
    await expect(client(fetchMock).getItem('x')).rejects.toMatchObject({ status: 403, code: 'LIST_ITEMS_FEATURE_NOT_ENABLED' })
    expect(calls.filter((c) => c.path === '/auth')).toHaveLength(1)
  })

  it('surfaces bad credentials without leaking them', async () => {
    const { fetchMock } = fakePluggy({ 'POST /auth': () => json(401, { message: 'invalid' }) })
    const err = await client(fetchMock).getApiKey().catch((e) => e)
    expect(err).toBeInstanceOf(PluggyApiError)
    expect(String(err.message)).not.toContain('secret')
  })
})

describe('PluggyClient: connect token', () => {
  it('puts clientUserId inside options (root is discarded by Pluggy)', async () => {
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': auth(),
      'POST /connect_token': () => json(200, { accessToken: 'ct-1' }),
    })
    const token = await client(fetchMock).createConnectToken({ clientUserId: 'user-42' })
    expect(token).toBe('ct-1')
    expect(calls[1].body).toEqual({ options: { clientUserId: 'user-42', avoidDuplicates: true } })
  })

  it('scopes the token to an item for reconnection', async () => {
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': auth(),
      'POST /connect_token': () => json(200, { accessToken: 'ct-2' }),
    })
    await client(fetchMock).createConnectToken({ clientUserId: 'u', itemId: 'item-9' })
    expect(calls[1].body).toEqual({ itemId: 'item-9', options: { clientUserId: 'u', avoidDuplicates: true } })
  })

  it('rejects a response without accessToken', async () => {
    const { fetchMock } = fakePluggy({ 'POST /auth': auth(), 'POST /connect_token': () => json(200, {}) })
    await expect(client(fetchMock).createConnectToken({ clientUserId: 'u' })).rejects.toBeInstanceOf(PluggyValidationError)
  })
})

describe('PluggyClient: retries and errors', () => {
  it('retries 429 and 5xx, then succeeds', async () => {
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': auth(),
      'GET /items/x': (_c, n) => n === 1 ? json(429, {}, { 'retry-after': '1' }) : n === 2 ? json(503, {}) : json(200, { id: 'x', status: 'UPDATED', connector: { id: 1, name: 'B' } }),
    })
    await expect(client(fetchMock).getItem('x')).resolves.toMatchObject({ id: 'x' })
    expect(calls.filter((c) => c.path === '/items/x')).toHaveLength(3)
  })

  it('gives up after the retry budget', async () => {
    const { fetchMock } = fakePluggy({ 'POST /auth': auth(), 'GET /items/x': () => json(500, { message: 'boom' }) })
    await expect(client(fetchMock).getItem('x')).rejects.toMatchObject({ status: 500 })
  })

  it('does not retry 4xx client errors', async () => {
    const { fetchMock, calls } = fakePluggy({ 'POST /auth': auth(), 'GET /items/x': () => json(404, { message: 'not found' }) })
    await expect(client(fetchMock).getItem('x')).rejects.toMatchObject({ status: 404 })
    expect(calls.filter((c) => c.path === '/items/x')).toHaveLength(1)
  })

  it('treats deleting an already-deleted item as success', async () => {
    const { fetchMock } = fakePluggy({ 'POST /auth': auth(), 'DELETE /items/x': () => json(404, { message: 'gone' }) })
    await expect(client(fetchMock).deleteItem('x')).resolves.toBeUndefined()
  })

  it('rejects malformed items (response validation)', async () => {
    const { fetchMock } = fakePluggy({ 'POST /auth': auth(), 'GET /items/x': () => json(200, { id: 'x' }) })
    await expect(client(fetchMock).getItem('x')).rejects.toBeInstanceOf(PluggyValidationError)
  })
})

describe('PluggyClient: accounts and transactions', () => {
  it('lists accounts of an item across pages', async () => {
    const acct = (id: string) => ({ id, itemId: 'it', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: id, balance: 10.5, currencyCode: 'BRL' })
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': auth(),
      'GET /accounts?itemId=it': () => json(200, { page: 1, totalPages: 2, results: [acct('a1')] }),
      'GET /accounts?itemId=it&page=2': () => json(200, { page: 2, totalPages: 2, results: [acct('a2')] }),
    })
    const accounts = await client(fetchMock).listAccounts('it')
    expect(accounts.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(calls.map((c) => c.path)).toContain('/accounts?itemId=it&page=2')
  })

  it('follows the `next` cursor until null (pagination)', async () => {
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': auth(),
      'GET /v2/transactions?accountId=acc-1': () => json(200, { results: [tx('t1'), tx('t2')], next: '?accountId=acc-1&after=c1' }),
      'GET /v2/transactions?accountId=acc-1&after=c1': () => json(200, { results: [tx('t3')], next: null }),
    })
    const list = await client(fetchMock).listTransactions('acc-1')
    expect(list.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(calls.filter((c) => c.path.startsWith('/v2/transactions'))).toHaveLength(2)
  })

  it('passes dateFrom for incremental sync', async () => {
    const { fetchMock, calls } = fakePluggy({
      'POST /auth': auth(),
      'GET /v2/transactions?accountId=acc-1&dateFrom=2026-10-01': () => json(200, { results: [], next: null }),
    })
    await client(fetchMock).listTransactions('acc-1', { dateFrom: '2026-10-01' })
    expect(calls[1].path).toBe('/v2/transactions?accountId=acc-1&dateFrom=2026-10-01')
  })

  it('maps transaction fields used by the importer', async () => {
    const { fetchMock } = fakePluggy({
      'POST /auth': auth(),
      'GET /v2/transactions?accountId=acc-1': () => json(200, { next: null, results: [tx('t1', {
        status: 'PENDING', category: 'Transfer - PIX', merchant: { name: 'Padaria', category: 'Bakery' },
        paymentData: { paymentMethod: 'PIX', payer: { documentNumber: { type: 'CPF', value: '1' } }, receiver: { documentNumber: { type: 'CPF', value: '1' } } },
        creditCardMetadata: { installmentNumber: 2, totalInstallments: 3 }, updatedAt: '2026-10-02T10:00:00.000Z',
      })] }),
    })
    const [t] = await client(fetchMock).listTransactions('acc-1')
    expect(t).toMatchObject({
      status: 'PENDING', date: '2026-10-01', category: 'Transfer - PIX', paymentMethod: 'PIX',
      merchantName: 'Padaria', payerDocument: '1', receiverDocument: '1', installment: { number: 2, total: 3 },
    })
  })

  it('rejects unknown transaction types instead of guessing', async () => {
    const { fetchMock } = fakePluggy({
      'POST /auth': auth(),
      'GET /v2/transactions?accountId=acc-1': () => json(200, { next: null, results: [tx('t1', { type: 'OTHER' })] }),
    })
    await expect(client(fetchMock).listTransactions('acc-1')).rejects.toBeInstanceOf(PluggyValidationError)
  })
})
