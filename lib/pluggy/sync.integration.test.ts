// Integration test against the Pluggy SANDBOX and the database in
// DATABASE_URL (use a TEST branch). Skipped unless RUN_PLUGGY_IT=1:
//   pnpm test:integration
// Creates two clearly-labelled test users and one sandbox item (deleted at
// the end). Uses only Pluggy's documented sandbox credentials.

import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const RUN = process.env.RUN_PLUGGY_IT === '1'

describe.skipIf(!RUN)('Pluggy sync (sandbox + test DB)', async () => {
  const { db } = await import('@/lib/db')
  const schema = await import('@/lib/db/schema')
  const { ensureDefaultAccounts } = await import('@/lib/accounts')
  const { pluggy } = await import('./client')
  const sync = await import('./sync')
  const webhook = await import('./webhook')
  const { parseItem } = await import('./types')

  // Collection runs even when skipped; only build the client when running.
  const client = RUN ? pluggy() : (null as unknown as ReturnType<typeof pluggy>)
  const stamp = Date.now()
  const userA = { id: randomUUID(), email: `e2e-it-a+${stamp}@example.com` }
  const userB = { id: randomUUID(), email: `e2e-it-b+${stamp}@example.com` }
  let pluggyItemId = ''
  let itemRowId = 0

  const txOf = (userId: string) =>
    db.select().from(schema.transactions).where(eq(schema.transactions.userId, userId))

  beforeAll(async () => {
    const host = new URL(process.env.DATABASE_URL ?? '').hostname
    if (process.env.PLUGGY_IT_DB_HOST && host !== process.env.PLUGGY_IT_DB_HOST) {
      throw new Error('refusing to run against an unexpected database host')
    }
    for (const u of [userA, userB]) {
      await db.insert(schema.user).values({ id: u.id, name: 'Teste Integração', email: u.email })
      await ensureDefaultAccounts(u.id)
    }
    const connector = parseItem({ id: 'x', status: 'x', connector: await client.request('GET', '/connectors/2') }).connector
    if (!connector.isSandbox) throw new Error('connector 2 is not a sandbox connector')
    const created = parseItem(
      await client.request('POST', '/items', {
        connectorId: 2,
        parameters: { user: 'user-ok', password: 'password-ok' },
        clientUserId: userA.id,
      }),
    )
    pluggyItemId = created.id
  }, 60_000)

  afterAll(async () => {
    if (pluggyItemId) await client.deleteItem(pluggyItemId).catch(() => {})
  })

  it('refuses to register the item for another user (isolation)', async () => {
    await expect(sync.registerItem(userB.id, pluggyItemId)).rejects.toBeInstanceOf(sync.PluggyOwnershipError)
  })

  it('registers the item for its owner', async () => {
    itemRowId = await sync.registerItem(userA.id, pluggyItemId)
    const [row] = await db.select().from(schema.pluggyItems).where(eq(schema.pluggyItems.id, itemRowId))
    expect(row).toMatchObject({ userId: userA.id, pluggyItemId, connectorId: 2, isSandbox: true })
  })

  it('waits while the bank is still collecting, then imports everything', async () => {
    let result = await sync.syncItem(userA.id, itemRowId, 'connect')
    for (let i = 0; i < 40 && result.status === 'waiting'; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      result = await sync.syncItem(userA.id, itemRowId, 'manual')
    }
    expect(result.status).toBe('success')
    expect(result.accounts).toBe(2)

    // Same count as Pluggy reports.
    const pluggyAccounts = await client.listAccounts(pluggyItemId)
    let pluggyTotal = 0
    for (const a of pluggyAccounts) pluggyTotal += (await client.listTransactions(a.id)).length
    const rows = await txOf(userA.id)
    expect(rows.filter((r) => r.source === 'bank')).toHaveLength(pluggyTotal)
    expect(result.created).toBe(pluggyTotal)

    const accounts = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.itemId, itemRowId))
    expect(accounts.map((a) => a.accountType).sort()).toEqual(['BANK', 'CREDIT'])
    expect(accounts.every((a) => a.userId === userA.id && a.balanceAt)).toBe(true)
    expect(Number(accounts.find((a) => a.accountType === 'CREDIT')!.balance)).toBeLessThanOrEqual(0)
  }, 180_000)

  it('recognizes and classifies imported transactions', async () => {
    const rows = await txOf(userA.id)
    const by = (d: string) => rows.find((r) => r.description.startsWith(d))!
    expect(by('SALARIO EMPRESA')).toMatchObject({ type: 'income', category: 'Salário', categoryStatus: 'suggested', recurring: true })
    expect(by('PAGAMENTO FATURA CARTAO')).toMatchObject({ isTransfer: true })
    expect(by('NETFLIX.COM')).toMatchObject({ type: 'expense', method: 'credito', category: 'Assinaturas', recurring: true })
    expect(by('Pagamento de boleto')).toMatchObject({ method: 'boleto' })
    expect(rows.every((r) => r.categoryStatus !== 'confirmed')).toBe(true)
  })

  it('a second sync is a no-op (no duplicates)', async () => {
    const before = (await txOf(userA.id)).length
    const r = await sync.syncItem(userA.id, itemRowId, 'manual')
    expect(r).toMatchObject({ status: 'success', created: 0, updated: 0, removed: 0 })
    expect((await txOf(userA.id)).length).toBe(before)
  }, 60_000)

  it('updates a row when the bank changes it, keeping user-confirmed categories', async () => {
    const rows = await txOf(userA.id)
    const [recent, other] = rows
      .filter((r) => r.source === 'bank' && r.occurredAt >= new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10))
      .slice(0, 2)
    // Simulate: one row was pending with stale data; the user confirmed another's category.
    await db.update(schema.transactions).set({ status: 'pending', externalUpdatedAt: null }).where(eq(schema.transactions.id, recent.id))
    await db.update(schema.transactions)
      .set({ category: 'Lazer', categoryStatus: 'confirmed', externalUpdatedAt: null })
      .where(eq(schema.transactions.id, other.id))
    const r = await sync.syncItem(userA.id, itemRowId, 'manual')
    expect(r.updated).toBe(2)
    const after = await db.select().from(schema.transactions).where(inArray(schema.transactions.id, [recent.id, other.id]))
    expect(after.find((x) => x.id === recent.id)?.status).toBe('posted')
    expect(after.find((x) => x.id === other.id)).toMatchObject({ category: 'Lazer', categoryStatus: 'confirmed' })
  }, 60_000)

  it('removes imported pending rows the bank no longer reports', async () => {
    const [acct] = await db.select().from(schema.bankAccounts).where(and(eq(schema.bankAccounts.itemId, itemRowId), eq(schema.bankAccounts.accountType, 'BANK')))
    await db.insert(schema.transactions).values({
      userId: userA.id, accountId: acct.id, source: 'bank', externalId: `gone-${stamp}`, status: 'pending',
      type: 'expense', amount: '1.00', description: 'pendente cancelada', category: 'Outros',
      occurredAt: new Date().toISOString().slice(0, 10),
    })
    const r = await sync.syncItem(userA.id, itemRowId, 'manual')
    expect(r.removed).toBe(1)
  }, 60_000)

  it('suggests (but never applies) a match with a manual entry', async () => {
    const netflix = (await txOf(userA.id)).find((r) => r.description === 'NETFLIX.COM')!
    const [carteira] = await db.select().from(schema.bankAccounts).where(and(eq(schema.bankAccounts.userId, userA.id), eq(schema.bankAccounts.bank, 'manual')))
    const [manual] = await db.insert(schema.transactions).values({
      userId: userA.id, accountId: carteira.id, source: 'manual', type: 'expense', amount: netflix.amount,
      description: 'Netflix', category: 'Assinaturas', occurredAt: netflix.occurredAt,
    }).returning()
    await db.update(schema.transactions).set({ matchStatus: null, matchCandidateId: null }).where(eq(schema.transactions.id, netflix.id))
    expect(await sync.suggestMatches(userA.id, [netflix.id])).toBe(1)
    const [imp] = await db.select().from(schema.transactions).where(eq(schema.transactions.id, netflix.id))
    expect(imp).toMatchObject({ matchCandidateId: manual.id, matchStatus: 'suggested' })
    const [man] = await db.select().from(schema.transactions).where(eq(schema.transactions.id, manual.id))
    expect(man).toMatchObject({ duplicateOf: null, amount: netflix.amount, description: 'Netflix' })
  })

  it('handles transactions/deleted webhooks once, even if redelivered', async () => {
    const victim = (await txOf(userA.id)).find((r) => r.source === 'bank' && r.description === 'SPOTIFY AB')!
    const payload = { event: 'transactions/deleted', eventId: `it-${stamp}`, clientId: null, itemId: pluggyItemId, transactionIds: [victim.externalId!] }
    expect(await webhook.recordWebhookEvent(payload)).toBe(true)
    await webhook.processWebhookEvent(payload)
    expect(await webhook.recordWebhookEvent(payload)).toBe(false) // duplicate delivery
    const [ev] = await db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.eventId, payload.eventId))
    expect(ev).toMatchObject({ status: 'processed', userId: userA.id })
    expect((await txOf(userA.id)).some((r) => r.id === victim.id)).toBe(false)
  })

  it('drops a second connection to the same accounts (no double import)', async () => {
    const dup = parseItem(await client.request('POST', '/items', {
      connectorId: 2, parameters: { user: 'user-ok', password: 'password-ok' }, clientUserId: userA.id,
    }))
    const dupRow = await sync.registerItem(userA.id, dup.id)
    const before = (await txOf(userA.id)).length
    let r = await sync.syncItem(userA.id, dupRow, 'connect')
    for (let i = 0; i < 40 && r.status === 'waiting'; i++) {
      await new Promise((res) => setTimeout(res, 3000))
      r = await sync.syncItem(userA.id, dupRow, 'manual')
    }
    expect(r.status).toBe('error')
    expect(r.message).toMatch(/já estão conectadas/)
    expect((await txOf(userA.id)).length).toBe(before)
    await expect(client.getItem(dup.id)).rejects.toMatchObject({ status: 404 })
  }, 180_000)

  it("user B sees nothing of user A's", async () => {
    expect((await txOf(userB.id)).filter((r) => r.source === 'bank')).toHaveLength(0)
    await expect(sync.syncItem(userB.id, itemRowId, 'manual')).rejects.toBeInstanceOf(sync.PluggyOwnershipError)
    const bAccounts = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.userId, userB.id))
    expect(bAccounts.every((a) => a.itemId === null)).toBe(true)
  })

  it('stops syncing after disconnect and keeps imported history', async () => {
    await client.deleteItem(pluggyItemId)
    await db.update(schema.pluggyItems).set({ disconnectedAt: new Date(), status: 'DISCONNECTED' }).where(eq(schema.pluggyItems.id, itemRowId))
    const r = await sync.syncItem(userA.id, itemRowId, 'manual')
    expect(r.status).toBe('error')
    expect((await txOf(userA.id)).filter((x) => x.source === 'bank').length).toBeGreaterThan(0)
    await expect(client.getItem(pluggyItemId)).rejects.toMatchObject({ status: 404 })
    pluggyItemId = ''
  }, 60_000)
})
