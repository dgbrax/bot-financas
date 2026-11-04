import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runScheduledSync } from './scheduled'
import { syncItem } from './sync'

const items = vi.hoisted(() => ({ rows: [] as Array<{ id: number; userId: string }> }))
vi.mock('@/lib/db', () => {
  const chain = { from: () => chain, where: () => chain, orderBy: async () => items.rows }
  return { db: { select: () => chain } }
})
vi.mock('./sync', () => ({ syncItem: vi.fn() }))
const mockedSync = vi.mocked(syncItem)
const result = (status: 'success' | 'waiting' | 'error' | 'skipped') =>
  ({ runId: 1, status, accounts: 0, created: 0, updated: 0, removed: 0, matches: 0 })

beforeEach(() => {
  mockedSync.mockReset()
  items.rows = [{ id: 1, userId: 'a' }, { id: 2, userId: 'b' }, { id: 3, userId: 'a' }, { id: 4, userId: 'c' }]
})

describe('runScheduledSync', () => {
  it('syncs every due item as its own user with trigger "cron" and counts outcomes', async () => {
    mockedSync
      .mockResolvedValueOnce(result('success'))
      .mockResolvedValueOnce(result('waiting'))
      .mockResolvedValueOnce(result('error'))
      .mockResolvedValueOnce(result('skipped'))
    const s = await runScheduledSync({ budgetMs: 60_000 })
    expect(mockedSync.mock.calls).toEqual([['a', 1, 'cron'], ['b', 2, 'cron'], ['a', 3, 'cron'], ['c', 4, 'cron']])
    expect(s).toMatchObject({ considered: 4, synced: 1, waiting: 1, errors: 1, skipped: 1, deferred: 0 })
  })

  it('one failing item does not stop the others', async () => {
    mockedSync.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(result('success'))
    const s = await runScheduledSync({ budgetMs: 60_000 })
    expect(s).toMatchObject({ synced: 3, errors: 1 })
  })

  it('stops starting new items when the time budget is used up (rest deferred)', async () => {
    let t = 0
    mockedSync.mockImplementation(async () => { t += 30_000; return result('success') })
    const s = await runScheduledSync({ budgetMs: 50_000, now: () => t })
    expect(mockedSync).toHaveBeenCalledTimes(2)
    expect(s).toMatchObject({ synced: 2, deferred: 2 })
  })

  it('does nothing when no item is due', async () => {
    items.rows = []
    expect(await runScheduledSync({ budgetMs: 1000 })).toMatchObject({ considered: 0, synced: 0 })
    expect(mockedSync).not.toHaveBeenCalled()
  })
})
