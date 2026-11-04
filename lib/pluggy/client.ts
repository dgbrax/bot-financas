// Server-only Pluggy API client (https://docs.pluggy.ai).
// Holds the API key in memory; never send it or the client secret to the
// browser. Only the short-lived Connect Token goes to the frontend.

import {
  parseAccount,
  parseConnector,
  parseItem,
  parseTransaction,
  PluggyValidationError,
  type PluggyAccount,
  type PluggyConnector,
  type PluggyItem,
  type PluggyTransaction,
} from './types'

export const PLUGGY_BASE_URL = 'https://api.pluggy.ai'

// API keys live 2 hours; refresh a bit early.
const API_KEY_TTL_MS = 2 * 60 * 60 * 1000
const API_KEY_REFRESH_MARGIN_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 20_000
const MAX_RETRIES = 3
const MAX_PAGES = 200

export class PluggyApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'PluggyApiError'
  }
}

export class PluggyConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluggyConfigError'
  }
}

export type PluggyClientOptions = {
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export class PluggyClient {
  private apiKey: { value: string; expiresAt: number } | null = null
  private apiKeyPromise: Promise<string> | null = null
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly opts: PluggyClientOptions) {
    if (!opts.clientId || !opts.clientSecret) {
      throw new PluggyConfigError('PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET not set')
    }
    this.fetchImpl = opts.fetch ?? fetch
    this.now = opts.now ?? Date.now
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  /** Cached API key; concurrent callers share one POST /auth. */
  async getApiKey(): Promise<string> {
    if (this.apiKey && this.now() < this.apiKey.expiresAt - API_KEY_REFRESH_MARGIN_MS) {
      return this.apiKey.value
    }
    this.apiKeyPromise ??= this.authenticate().finally(() => {
      this.apiKeyPromise = null
    })
    return this.apiKeyPromise
  }

  private async authenticate(): Promise<string> {
    const res = await this.send('POST', '/auth', {
      clientId: this.opts.clientId,
      clientSecret: this.opts.clientSecret,
    })
    const body = (await res.json().catch(() => null)) as { apiKey?: unknown } | null
    if (!res.ok || typeof body?.apiKey !== 'string' || !body.apiKey) {
      throw new PluggyApiError(res.status, null, `Pluggy authentication failed (${res.status})`)
    }
    this.apiKey = { value: body.apiKey, expiresAt: this.now() + API_KEY_TTL_MS }
    return body.apiKey
  }

  private async send(method: string, path: string, body?: unknown, apiKey?: string) {
    let attempt = 0
    for (;;) {
      let res: Response
      try {
        res = await this.fetchImpl(PLUGGY_BASE_URL + path, {
          method,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: 'no-store',
        })
      } catch (err) {
        if (attempt >= MAX_RETRIES) {
          throw new PluggyApiError(0, 'NETWORK', `Pluggy request failed: ${(err as Error).name}`)
        }
        await this.sleep(backoffMs(attempt++))
        continue
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'))
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : backoffMs(attempt),
        )
        attempt++
        continue
      }
      return res
    }
  }

  /** Authenticated request; on 401/403 retries once with a fresh API key. */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    let key = await this.getApiKey()
    let res = await this.send(method, path, body, key)
    if (res.status === 401 || res.status === 403) {
      const err = await readError(res)
      // A feature not enabled for this client is a real 403, not an expired key.
      if (err.code && /NOT_ENABLED|FORBIDDEN_FEATURE/.test(err.code)) {
        throw new PluggyApiError(res.status, err.code, err.message)
      }
      this.apiKey = null
      key = await this.getApiKey()
      res = await this.send(method, path, body, key)
    }
    if (!res.ok) {
      const err = await readError(res)
      throw new PluggyApiError(res.status, err.code, err.message)
    }
    if (res.status === 204) return null as T
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  /** Short-lived (30 min) token for the Connect widget. */
  async createConnectToken(input: {
    clientUserId: string
    itemId?: string
    webhookUrl?: string
  }): Promise<string> {
    const body = await this.request<{ accessToken?: unknown }>('POST', '/connect_token', {
      ...(input.itemId ? { itemId: input.itemId } : {}),
      // clientUserId must be inside `options`; at the root it is discarded.
      options: {
        clientUserId: input.clientUserId,
        // Same credentials again must not create a second item (it would
        // import the same accounts twice).
        avoidDuplicates: true,
        ...(input.webhookUrl ? { webhookUrl: input.webhookUrl } : {}),
      },
    })
    if (typeof body?.accessToken !== 'string' || !body.accessToken) {
      throw new PluggyValidationError('connect token', 'accessToken missing')
    }
    return body.accessToken
  }

  async getItem(itemId: string): Promise<PluggyItem> {
    return parseItem(await this.request('GET', `/items/${encodeURIComponent(itemId)}`))
  }

  /** Deletes the item at Pluggy. A missing item (404) counts as deleted. */
  async deleteItem(itemId: string): Promise<void> {
    try {
      await this.request('DELETE', `/items/${encodeURIComponent(itemId)}`)
    } catch (err) {
      if (err instanceof PluggyApiError && err.status === 404) return
      throw err
    }
  }

  async listSandboxConnectors(): Promise<PluggyConnector[]> {
    const body = await this.request<{ results?: unknown }>('GET', '/connectors?sandbox=true')
    if (!Array.isArray(body?.results)) throw new PluggyValidationError('connectors', 'results missing')
    return body.results.map(parseConnector).filter((c) => c.isSandbox)
  }

  async listAccounts(itemId: string): Promise<PluggyAccount[]> {
    const out: PluggyAccount[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.request<{ results?: unknown; totalPages?: unknown }>(
        'GET',
        `/accounts?itemId=${encodeURIComponent(itemId)}${page > 1 ? `&page=${page}` : ''}`,
      )
      if (!Array.isArray(body?.results)) throw new PluggyValidationError('accounts', 'results missing')
      out.push(...body.results.map(parseAccount))
      const totalPages = typeof body.totalPages === 'number' ? body.totalPages : 1
      if (page >= totalPages) break
    }
    return out
  }

  /**
   * All transactions of an account (GET /v2/transactions, cursor-based),
   * optionally from a date (YYYY-MM-DD) or restricted to ids.
   */
  async listTransactions(
    accountId: string,
    opts: { dateFrom?: string; ids?: string[] } = {},
  ): Promise<PluggyTransaction[]> {
    const params = new URLSearchParams({ accountId })
    if (opts.dateFrom) params.set('dateFrom', opts.dateFrom)
    if (opts.ids?.length) params.set('ids', opts.ids.join(','))
    let next: string | null = `?${params}`
    const out: PluggyTransaction[] = []
    for (let page = 0; next; page++) {
      if (page >= MAX_PAGES) throw new PluggyApiError(0, 'TOO_MANY_PAGES', 'Pagination did not end')
      const body: { results?: unknown; next?: unknown } = await this.request('GET', `/v2/transactions${next}`)
      if (!Array.isArray(body?.results)) throw new PluggyValidationError('transactions', 'results missing')
      out.push(...body.results.map(parseTransaction))
      if (body.next != null && typeof body.next !== 'string') {
        throw new PluggyValidationError('transactions', 'next must be a string or null')
      }
      next = body.next ? (body.next.startsWith('?') ? body.next : `?${body.next}`) : null
    }
    return out
  }
}

function backoffMs(attempt: number) {
  return Math.min(500 * 2 ** attempt, 8_000)
}

async function readError(res: Response): Promise<{ code: string | null; message: string }> {
  const body = (await res.json().catch(() => null)) as {
    code?: unknown
    codeDescription?: unknown
    message?: unknown
  } | null
  const code =
    typeof body?.codeDescription === 'string'
      ? body.codeDescription
      : typeof body?.code === 'string'
        ? body.code
        : null
  const message = typeof body?.message === 'string' ? body.message : `HTTP ${res.status}`
  // Never include request data (could contain credentials) in errors.
  return { code, message: `Pluggy ${res.status}: ${message}`.slice(0, 300) }
}

let shared: PluggyClient | null = null

/** Process-wide client using PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET. */
export function pluggy(): PluggyClient {
  shared ??= new PluggyClient({
    clientId: process.env.PLUGGY_CLIENT_ID ?? '',
    clientSecret: process.env.PLUGGY_CLIENT_SECRET ?? '',
  })
  return shared
}

/** Real connections are blocked unless PLUGGY_SANDBOX_ONLY=false. */
export function sandboxOnly() {
  return process.env.PLUGGY_SANDBOX_ONLY !== 'false'
}
