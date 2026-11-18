import { afterEach, expect, it, vi } from 'vitest'
import { sendTelegramMessage } from './client'
afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('sends plain text with protected content and without parse mode', async () => {
 vi.stubEnv('TELEGRAM_BOT_TOKEN','123:test_only')
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true})});vi.stubGlobal('fetch',fetch)
 await sendTelegramMessage('1','<script>')
 const options=fetch.mock.calls[0][1];expect(JSON.parse(options.body)).toMatchObject({chat_id:'1',text:'<script>',protect_content:true})
 expect(JSON.parse(options.body)).not.toHaveProperty('parse_mode')
})
it('replaces token-bearing fetch errors with a generic error', async () => {
 vi.stubEnv('TELEGRAM_BOT_TOKEN','123:test_only');vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('https://api.telegram.org/bot123:test_only')))
 await expect(sendTelegramMessage('1','hello')).rejects.toThrow('Falha ao entregar resposta Telegram')
})
