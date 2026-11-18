'use server'

import { revalidatePath } from 'next/cache'
import { getUserId } from '@/lib/session'
import { pool } from '@/lib/db'
import { TelegramInputError, TelegramStore } from '@/lib/telegram/store'
import { telegramEnabled } from '@/lib/telegram/config'

const store = new TelegramStore(pool)
export type TelegramState = { error?: string; url?: string; expiresAt?: string; revoked?: boolean }

export async function createTelegramLink(_previous: TelegramState, form: FormData): Promise<TelegramState> {
  const userId = await getUserId()
  if (!telegramEnabled()) {
    return { error: 'Telegram ainda não configurado no servidor.' }
  }
  try {
    return await store.issueCode(userId, Number(form.get('accountId')))
  } catch (error) {
    return { error: error instanceof TelegramInputError ? error.message : 'Não foi possível gerar o vínculo. Tente novamente.' }
  }
}

export async function revokeTelegramLink(_previous: TelegramState, _form: FormData): Promise<TelegramState> {
  const userId = await getUserId()
  try {
    await store.revoke(userId)
    revalidatePath('/telegram')
    return { revoked: true }
  } catch { return { error: 'Não foi possível revogar o vínculo. Tente novamente.' } }
}
