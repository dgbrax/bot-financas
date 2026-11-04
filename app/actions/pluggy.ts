'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { pluggyItems } from '@/lib/db/schema'
import { PluggyApiError, PluggyConfigError, pluggy, sandboxOnly } from '@/lib/pluggy/client'
import {
  PluggyOwnershipError,
  registerItem,
  SandboxOnlyError,
  syncItem,
  type SyncResult,
} from '@/lib/pluggy/sync'
import { getUserId } from '@/lib/session'

export type ConnectConfig =
  | {
      connectToken: string
      includeSandbox: boolean
      connectorIds?: number[]
      updateItem?: string
    }
  | { error: string }

let sandboxIds: { ids: number[]; at: number } | null = null

async function sandboxConnectorIds() {
  if (!sandboxIds || Date.now() - sandboxIds.at > 60 * 60 * 1000) {
    const ids = (await pluggy().listSandboxConnectors()).map((c) => c.id)
    sandboxIds = { ids, at: Date.now() }
  }
  return sandboxIds.ids
}

function friendly(err: unknown): string {
  if (err instanceof PluggyConfigError) return 'Integração Pluggy não configurada no servidor.'
  if (err instanceof PluggyOwnershipError) return 'Essa conexão não pertence à sua conta.'
  if (err instanceof SandboxOnlyError) {
    return 'Este ambiente aceita apenas instituições de teste (Sandbox). A conexão foi descartada.'
  }
  if (err instanceof PluggyApiError) {
    if (err.status === 429) return 'Muitas requisições ao Pluggy. Tente em alguns minutos.'
    return 'Não foi possível falar com o Pluggy agora. Tente novamente.'
  }
  console.error('pluggy action failed', err instanceof Error ? err.name : 'unknown')
  return 'Erro inesperado. Tente novamente.'
}

async function ownedItem(userId: string, itemRowId: number) {
  if (!Number.isInteger(itemRowId) || itemRowId <= 0) return null
  const [row] = await db
    .select()
    .from(pluggyItems)
    .where(and(eq(pluggyItems.id, itemRowId), eq(pluggyItems.userId, userId)))
  return row ?? null
}

/** Token + widget options to connect a new institution. */
export async function startConnection(): Promise<ConnectConfig> {
  const userId = await getUserId()
  try {
    const restrict = sandboxOnly()
    const [connectToken, connectorIds] = await Promise.all([
      pluggy().createConnectToken({ clientUserId: userId }),
      restrict ? sandboxConnectorIds() : Promise.resolve(undefined),
    ])
    return {
      connectToken,
      includeSandbox: restrict || process.env.NODE_ENV !== 'production',
      ...(connectorIds ? { connectorIds } : {}),
    }
  } catch (err) {
    return { error: friendly(err) }
  }
}

/** Token scoped to an existing item, for reconnecting / re-entering MFA. */
export async function startReconnect(itemRowId: number): Promise<ConnectConfig> {
  const userId = await getUserId()
  const row = await ownedItem(userId, itemRowId)
  if (!row) return { error: 'Conexão não encontrada.' }
  try {
    const connectToken = await pluggy().createConnectToken({
      clientUserId: userId,
      itemId: row.pluggyItemId,
    })
    return {
      connectToken,
      includeSandbox: sandboxOnly() || process.env.NODE_ENV !== 'production',
      updateItem: row.pluggyItemId,
    }
  } catch (err) {
    return { error: friendly(err) }
  }
}

export type CompleteResult = { itemRowId: number; sync: SyncResult } | { error: string }

/** Called by the widget's onSuccess/onError with the item id it created. */
export async function completeConnection(pluggyItemId: string): Promise<CompleteResult> {
  const userId = await getUserId()
  if (typeof pluggyItemId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(pluggyItemId)) {
    return { error: 'Conexão inválida.' }
  }
  try {
    const itemRowId = await registerItem(userId, pluggyItemId)
    const sync = await syncItem(userId, itemRowId, 'connect')
    revalidatePath('/conexoes')
    revalidatePath('/')
    return { itemRowId, sync }
  } catch (err) {
    return { error: friendly(err) }
  }
}

export type SyncState = { message?: string; error?: string; status?: SyncResult['status'] }

export async function syncConnection(itemRowId: number): Promise<SyncState> {
  const userId = await getUserId()
  const row = await ownedItem(userId, itemRowId)
  if (!row) return { error: 'Conexão não encontrada.' }
  try {
    const r = await syncItem(userId, row.id, 'manual')
    revalidatePath('/conexoes')
    revalidatePath('/')
    if (r.status === 'success') {
      return {
        status: r.status,
        message: `Sincronizado: ${r.created} novas, ${r.updated} atualizadas${r.removed ? `, ${r.removed} removidas` : ''}.`,
      }
    }
    if (r.status === 'error') return { status: r.status, error: r.message }
    return { status: r.status, message: r.message }
  } catch (err) {
    return { error: friendly(err) }
  }
}

/** Form-friendly wrapper for useActionState. */
export async function syncConnectionForm(_prev: SyncState, formData: FormData): Promise<SyncState> {
  return syncConnection(Number(formData.get('itemRowId')))
}

/**
 * Deletes the item at Pluggy (stops data access) and marks it disconnected.
 * Imported accounts and transactions stay as history.
 */
export async function disconnectConnection(_prev: SyncState, formData: FormData): Promise<SyncState> {
  const userId = await getUserId()
  const row = await ownedItem(userId, Number(formData.get('itemRowId')))
  if (!row) return { error: 'Conexão não encontrada.' }
  try {
    await pluggy().deleteItem(row.pluggyItemId)
    await db
      .update(pluggyItems)
      .set({ status: 'DISCONNECTED', disconnectedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(pluggyItems.id, row.id), eq(pluggyItems.userId, userId)))
    revalidatePath('/conexoes')
    revalidatePath('/')
    return { message: 'Conexão removida. O histórico importado foi mantido.' }
  } catch (err) {
    return { error: friendly(err) }
  }
}
