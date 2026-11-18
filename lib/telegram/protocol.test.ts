import { describe, expect, it } from 'vitest'
import { commandText, hashCode, newLinkCode, parseTelegramTransaction, privateMessage, secretMatches, todayInBrazil } from './protocol'
const update = { update_id: 1, message: { message_id: 2, text: '/saldo', from: { id: 123, is_bot: false }, chat: { id: 123, type: 'private' } } }

describe('Telegram protocol', () => {
  it('accepts only genuine private sender/chat numeric identity, never username', () => {
    expect(privateMessage(update)).toMatchObject({ telegramId: '123', chatId: '123' })
    for (const change of [
      { chat: { id: -123, type: 'group' } }, { chat: { id: -123, type: 'supergroup' } },
      { chat: { id: 456, type: 'private' } }, { from: { id: 123, is_bot: true } },
      { from: { username: '123', is_bot: false } }, { sender_chat: { id: 123 } },
      { business_connection_id: 'x' }, { is_topic_message: true }, { text: 'x'.repeat(4097) },
    ]) expect(privateMessage({ ...update, message: { ...update.message, ...change } })).toBeNull()
    expect(privateMessage({ update_id: 1, edited_message: update.message })).toBeNull()
    expect(privateMessage(null)).toBeNull()
  })
  it('checks webhook secret and refuses missing/invalid configuration', () => {
    const s = 'x'.repeat(40)
    expect(secretMatches(s, s)).toBe(true)
    for (const wrong of [null, '', 'x'.repeat(39), 'z'.repeat(40)]) expect(secretMatches(wrong, s)).toBe(false)
    expect(secretMatches('short', 'short')).toBe(false)
  })
  it('issues unpredictable, Telegram-compatible codes stored as hashes', () => {
    const a = newLinkCode(), b = newLinkCode()
    expect(a.code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.hash).toBe(hashCode(a.code))
    expect(a.hash).not.toContain(a.code)
    expect(a.url).toBe(`https://t.me/botfinancas_dgbrax_bot?start=${a.code}`)
    expect(a.code).not.toBe(b.code)
  })
  it.each([
    ['Gastei 35 reais no almoço', 'expense', 35, 'almoço'],
    ['Recebi 150 reais', 'income', 150, 'Recebimento'],
    ['Gastei R$ 12,50 com lanche', 'expense', 12.5, 'lanche'],
    ['Recebi 1.234,56 reais de freelance ontem', 'income', 1234.56, 'freelance'],
    ['-20 mercado', 'expense', 20, 'mercado'],
  ])('parses %s using existing money/date/category rules', (text, type, amount, description) => {
    expect(parseTelegramTransaction(text, '2026-11-18')).toMatchObject({ ok: true, type, amount, description })
  })
  it.each(['Gastei 0 reais', 'Recebi -1 reais', 'Gastei 1000000001 reais', 'Gastei 12,345 reais', 'faça pix 100', '-35 almoço\n+150 salario'])('rejects unsupported or unsafe input %s', text => {
    expect(parseTelegramTransaction(text, '2026-11-18').ok).toBe(false)
  })
  it('uses São Paulo calendar date and accepts only our command suffix', () => {
    expect(todayInBrazil(new Date('2026-11-18T01:00:00Z'))).toBe('2026-11-17')
    expect(commandText('/saldo@botfinancas_dgbrax_bot')).toBe('/saldo')
    expect(commandText('/saldo@outro_bot')).toBe('/saldo@outro_bot')
  })
})
