// Manual activation only. Never invoke from a build, migration or CI job.
const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
const [command, address] = process.argv.slice(2)
async function api(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}), redirect: 'error', signal: AbortSignal.timeout(10000),
  })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error('Telegram API failed')
  return body.result
}
try {
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error('Missing token')
  if (!['set', 'status'].includes(command)) throw new Error('Invalid command')
  const me = await api('getMe')
  if (me.username !== 'botfinancas_dgbrax_bot') throw new Error('Unexpected bot identity')
  if (command === 'set') {
    if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw new Error('Invalid secret')
    const url = new URL(address)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/api/telegram/webhook') throw new Error('Invalid webhook URL')
    await api('setWebhook', { url: url.href, secret_token: secret,
      allowed_updates: ['message'], max_connections: 10, drop_pending_updates: false })
    console.log('Webhook configurado para @botfinancas_dgbrax_bot.')
  }
  const info = await api('getWebhookInfo')
  console.log(JSON.stringify({ configured: Boolean(info.url), pendingUpdates: info.pending_update_count,
    deliveryErrorReported: Boolean(info.last_error_date) }))
} catch {
  // Do not print native fetch exceptions or Telegram responses (may contain tokens/URLs).
  console.error('Não foi possível configurar/consultar o webhook. Confira comando, credenciais, identidade do bot e URL HTTPS.')
  process.exitCode = 1
}
