import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { parseCommand } from '@/lib/commands/parse'

export const BOT_USERNAME = 'botfinancas_dgbrax_bot'
export const LINK_TTL_MS = 10 * 60 * 1000
export const MAX_BODY_BYTES = 32_768
export type PrivateMessage = {
  updateId: number; messageId: number; telegramId: string; chatId: string; text: string
}

export function secretMatches(provided: string | null, expected: string) {
  if (!provided || !/^[A-Za-z0-9_-]{32,256}$/.test(expected)) return false
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export const hashCode = (code: string) => createHash('sha256').update(code).digest('hex')
export function newLinkCode() {
  const code = randomBytes(32).toString('base64url')
  return { code, hash: hashCode(code), url: `https://t.me/${BOT_USERNAME}?start=${code}` }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}
const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

/** No edited messages, bot senders, business messages, topics, groups or channels. */
export function privateMessage(input: unknown): PrivateMessage | null {
  const update = object(input), message = object(update?.message)
  const from = object(message?.from), chat = object(message?.chat)
  if (!update || !message || !from || !chat || !id(update.update_id) ||
      !id(message.message_id) || !id(from.id) || !id(chat.id) ||
      chat.type !== 'private' || from.is_bot !== false || from.id !== chat.id ||
      message.business_connection_id || message.sender_chat || message.is_topic_message ||
      typeof message.text !== 'string' || message.text.length > 4096) return null
  return { updateId: update.update_id, messageId: message.message_id,
    telegramId: String(from.id), chatId: String(chat.id), text: message.text.trim() }
}

export function commandText(text: string) {
  return text.replace(new RegExp(`^(/\\w+)@${BOT_USERNAME}(?=\\s|$)`, 'i'), '$1')
}

/** Strict supported phrases; no LLM or external financial service. */
export function parseTelegramTransaction(text: string, today: string) {
  const natural = /^(gastei|recebi)\s+(?:r\$\s*)?(\d[\d.,]*)\s*(?:reais?|reals?)?\b(?:\s+(.*))?$/i.exec(text)
  if (natural) {
    const income = natural[1].toLowerCase() === 'recebi'
    const description = (natural[3] || (income ? 'Recebimento' : 'Despesa'))
      .replace(/^(?:no|na|em|com|de)\s+/i, '')
    return parseCommand(`${income ? '+' : '-'}${natural[2]} ${description}`, { today })
  }
  return parseCommand(text, { today })
}

export function todayInBrazil(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export const HELP = 'Use /saldo, /ultimas, /contas ou /conta ID. Para registrar: Gastei 35 reais no almoço; Recebi 150 reais; -12,50 lanche. /desvincular remove o acesso. Apenas registros: não realizo PIX, transferências ou pagamentos.'
export const NEED_LINK = 'Vincule primeiro sua conta em /telegram no dashboard e abra o link temporário. Não compartilhe esse link.'
