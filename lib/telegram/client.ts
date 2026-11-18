import 'server-only'

/** Server-only import path: used exclusively by the webhook route. Never log URLs/errors. */
export async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('Telegram indisponível')
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000),
        protect_content: true, link_preview_options: { is_disabled: true } }),
      cache: 'no-store', signal: AbortSignal.timeout(8000), redirect: 'error',
    })
    const body: unknown = await response.json()
    if (!response.ok || !body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) {
      throw new Error('Falha Telegram')
    }
  } catch {
    // Fetch errors can contain the token-bearing URL. Replace, never rethrow them.
    throw new Error('Falha ao entregar resposta Telegram')
  }
}
