// Pluggy webhook handling (https://docs.pluggy.ai/en/docs/webhooks).
// Pluggy does not sign payloads. Authenticity comes from a secret custom
// header configured when the webhook is created via POST /webhooks; payloads
// are treated as signals and the data is re-read from the API.

import { timingSafeEqual } from 'node:crypto'
import { and, eq, lt, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pluggyItems, webhookEvents } from '@/lib/db/schema'
import { removeImported, syncItem } from './sync'

export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret'

export function verifyWebhookSecret(received: string | null, expected: string | undefined) {
  if (!expected || !received) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type WebhookPayload = {
  event: string
  eventId: string
  clientId: string | null
  itemId: string | null
  transactionIds: string[]
}

/** Validates the fields we use; returns null for malformed payloads. */
export function parseWebhookPayload(body: unknown): WebhookPayload | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const o = body as Record<string, unknown>
  if (typeof o.event !== 'string' || !/^[a-z_]+\/[a-z_]+$/.test(o.event)) return null
  if (typeof o.eventId !== 'string' || !o.eventId || o.eventId.length > 200) return null
  const ids = Array.isArray(o.transactionIds)
    ? o.transactionIds.filter((x): x is string => typeof x === 'string' && x.length <= 100).slice(0, 5000)
    : []
  return {
    event: o.event,
    eventId: o.eventId,
    clientId: typeof o.clientId === 'string' ? o.clientId : null,
    itemId: typeof o.itemId === 'string' && o.itemId.length <= 100 ? o.itemId : null,
    transactionIds: ids,
  }
}

/** Events that require re-reading the item and importing data. */
const SYNC_EVENTS = new Set([
  'item/created',
  'item/updated',
  'item/error',
  'item/login_succeeded',
  'item/waiting_user_input',
  'item/waiting_user_action',
  'transactions/created',
  'transactions/updated',
])

/**
 * Records the delivery. Returns true when it should be processed now: first
 * delivery, or a redelivery of an event whose processing failed or stalled.
 */
export async function recordWebhookEvent(p: WebhookPayload): Promise<boolean> {
  const rows = await db
    .insert(webhookEvents)
    .values({ eventId: p.eventId, event: p.event, pluggyItemId: p.itemId, status: 'received' })
    .onConflictDoUpdate({
      target: webhookEvents.eventId,
      set: { status: 'received', errorMessage: null, receivedAt: sql`now()` },
      setWhere: or(
        eq(webhookEvents.status, 'error'),
        and(eq(webhookEvents.status, 'received'), lt(webhookEvents.receivedAt, sql`now() - interval '5 minutes'`)),
      ),
    })
    .returning({ id: webhookEvents.id })
  return rows.length > 0
}

export async function processWebhookEvent(p: WebhookPayload): Promise<void> {
  const done = (status: 'processed' | 'ignored' | 'error', userId: string | null, errorMessage?: string) =>
    db
      .update(webhookEvents)
      .set({ status, userId, errorMessage: errorMessage?.slice(0, 300) ?? null, processedAt: sql`now()` })
      .where(eq(webhookEvents.eventId, p.eventId))

  if (!p.itemId) return void (await done('ignored', null))
  const [item] = await db
    .select({ id: pluggyItems.id, userId: pluggyItems.userId, disconnectedAt: pluggyItems.disconnectedAt })
    .from(pluggyItems)
    .where(eq(pluggyItems.pluggyItemId, p.itemId))
  // Unknown item (e.g. created outside this app): nothing to do.
  if (!item) return void (await done('ignored', null))

  try {
    if (p.event === 'item/deleted') {
      await db
        .update(pluggyItems)
        .set({ status: 'DISCONNECTED', disconnectedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(pluggyItems.id, item.id))
    } else if (p.event === 'transactions/deleted') {
      await removeImported(item.userId, p.transactionIds)
    } else if (SYNC_EVENTS.has(p.event) && !item.disconnectedAt) {
      const r = await syncItem(item.userId, item.id, 'webhook')
      if (r.status === 'error') return void (await done('error', item.userId, r.message))
    } else {
      return void (await done('ignored', item.userId))
    }
    await done('processed', item.userId)
  } catch (err) {
    await done('error', item.userId, err instanceof Error ? err.name : 'error')
  }
}
