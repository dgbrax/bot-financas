// Scheduled sync of every active Pluggy connection. Platform-agnostic:
// called by the cron route (Vercel Cron today, a VPS crontab later).

import { and, asc, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pluggyItems } from '@/lib/db/schema'
import { syncItem } from './sync'

export type ScheduledSyncSummary = {
  considered: number
  synced: number
  waiting: number
  errors: number
  skipped: number
  deferred: number
  durationMs: number
}

/** Items synced more recently than this are skipped (saves API calls, makes
 * duplicate cron deliveries harmless). */
export const MIN_INTERVAL_HOURS = 20

export async function runScheduledSync({
  budgetMs,
  now = Date.now,
}: {
  budgetMs: number
  now?: () => number
}): Promise<ScheduledSyncSummary> {
  const started = now()
  const cutoff = new Date(started - MIN_INTERVAL_HOURS * 3_600_000)
  // Oldest first, so if the time budget runs out the rest go first next run.
  const items = await db
    .select({ id: pluggyItems.id, userId: pluggyItems.userId })
    .from(pluggyItems)
    .where(
      and(
        isNull(pluggyItems.disconnectedAt),
        or(isNull(pluggyItems.lastSyncedAt), lt(pluggyItems.lastSyncedAt, cutoff)),
      ),
    )
    .orderBy(sql`${pluggyItems.lastSyncedAt} asc nulls first`, asc(pluggyItems.id))

  const summary: ScheduledSyncSummary = {
    considered: items.length, synced: 0, waiting: 0, errors: 0, skipped: 0, deferred: 0, durationMs: 0,
  }
  for (const [i, item] of items.entries()) {
    if (now() - started > budgetMs) {
      summary.deferred = items.length - i
      break
    }
    try {
      const r = await syncItem(item.userId, item.id, 'cron')
      if (r.status === 'success') summary.synced++
      else if (r.status === 'waiting') summary.waiting++
      else if (r.status === 'skipped') summary.skipped++
      else summary.errors++
    } catch {
      // syncItem records its own failures; never let one item stop the rest.
      summary.errors++
    }
  }
  summary.durationMs = now() - started
  return summary
}
