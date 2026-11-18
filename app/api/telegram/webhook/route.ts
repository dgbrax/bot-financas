import { telegramEnabled } from '@/lib/telegram/config'
import { pool } from '@/lib/db'
import { TelegramStore } from '@/lib/telegram/store'
import { sendTelegramMessage } from '@/lib/telegram/client'
import { MAX_BODY_BYTES, privateMessage, secretMatches } from '@/lib/telegram/protocol'

export const runtime = 'nodejs'
export const maxDuration = 60
const store = new TelegramStore(pool)

async function readBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('empty')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('size') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!telegramEnabled() || !secret) return new Response(null, { status: 503 })
  if (!secretMatches(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), secret)) {
    return new Response(null, { status: 401 })
  }
  let body: unknown
  try { body = await readBody(request) } catch { return new Response(null, { status: 400 }) }
  const message = privateMessage(body)
  if (!message) return new Response(null, { status: 200 })
  try {
    const updateId = await store.process(message)
    if (updateId) await store.deliver(updateId, sendTelegramMessage)
    return new Response(null, { status: 200 })
  } catch {
    // No request bodies, financial values, Telegram URLs, tokens or error objects in logs.
    // Telegram retries non-2xx deliveries; DB marker and pending reply survive send failures.
    return new Response(null, { status: 503 })
  }
}
