import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ process: vi.fn(), deliver: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/db', () => ({ pool: {} }))
vi.mock('./store', () => ({ TelegramStore: class { process = mocked.process; deliver = mocked.deliver } }))
vi.mock('./client', () => ({ sendTelegramMessage: mocked.send }))
import { POST } from '@/app/api/telegram/webhook/route'
const secret = 'test_webhook_secret_'.repeat(3)
const body = { update_id: 1, message: { message_id: 1, text: '/saldo', from: { id: 1, is_bot: false }, chat: { id: 1, type: 'private' } } }
function request(payload: unknown = body, key: string = secret) {
  return new Request('https://example.test/api/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': key }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) })
}
beforeEach(() => {
  vi.stubEnv('TELEGRAM_ENABLED','true');vi.resetAllMocks();vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', secret);vi.stubEnv('TELEGRAM_BOT_TOKEN','123:test_only')
  mocked.process.mockResolvedValue('1');mocked.deliver.mockResolvedValue(undefined)
})
describe('Telegram webhook boundary', () => {
  it('fails closed if not configured', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN','');expect((await POST(request())).status).toBe(503)
    expect(mocked.process).not.toHaveBeenCalled()
  })
  it('stays disabled even with credentials until explicitly enabled', async () => {
    vi.stubEnv('TELEGRAM_ENABLED','false')
    expect((await POST(request())).status).toBe(503)
    expect(mocked.process).not.toHaveBeenCalled()
  })
  it('rejects forged secrets before reading a malformed body', async () => {
    expect((await POST(request('{', 'bad'))).status).toBe(401)
    expect(mocked.process).not.toHaveBeenCalled()
  })
  it('rejects malformed JSON and oversized bodies', async () => {
    expect((await POST(request('{'))).status).toBe(400)
    expect((await POST(request('x'.repeat(32769)))).status).toBe(400)
  })
  it('never queries or sends financial replies to groups, edited messages or channels', async () => {
    for (const type of ['group','supergroup','channel']) {
      expect((await POST(request({ ...body,message:{...body.message,chat:{id:1,type}} }))).status).toBe(200)
    }
    expect((await POST(request({update_id:2,edited_message:body.message}))).status).toBe(200)
    expect(mocked.process).not.toHaveBeenCalled();expect(mocked.deliver).not.toHaveBeenCalled()
  })
  it('awaits transaction and delivery before acknowledging', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(mocked.process).toHaveBeenCalledWith(expect.objectContaining({telegramId:'1',chatId:'1'}))
    expect(mocked.deliver).toHaveBeenCalledWith('1',mocked.send)
  })
  it('returns retryable failure for DB or send errors, without leaking them', async () => {
    mocked.deliver.mockRejectedValue(new Error('sensitive URL'))
    const response=await POST(request());expect(response.status).toBe(503);expect(await response.text()).toBe('')
  })
})
