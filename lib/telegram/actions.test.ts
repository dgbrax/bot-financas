import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({getUserId:vi.fn(),issueCode:vi.fn(),revoke:vi.fn(),revalidate:vi.fn()}))
vi.mock('@/lib/session',()=>({getUserId:mocks.getUserId}))
vi.mock('@/lib/db',()=>({pool:{}}))
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}))
vi.mock('./store',()=>({TelegramInputError:class extends Error {},TelegramStore:class{
 issueCode=mocks.issueCode;revoke=mocks.revoke
}}))
import {createTelegramLink,revokeTelegramLink} from '@/app/actions/telegram'
beforeEach(()=>{
 vi.stubEnv('TELEGRAM_ENABLED','true');vi.resetAllMocks();mocks.getUserId.mockResolvedValue('session-user')
 vi.stubEnv('TELEGRAM_BOT_TOKEN','123:test_only');vi.stubEnv('TELEGRAM_WEBHOOK_SECRET','x'.repeat(40))
})
describe('dashboard Telegram authorization',()=>{
 it('uses authenticated session identity, ignoring userId from form',async()=>{
  const form=new FormData();form.set('accountId','2');form.set('userId','victim')
  mocks.issueCode.mockResolvedValue({url:'https://t.me/example',expiresAt:'2026-11-18'})
  await createTelegramLink({},form);expect(mocks.issueCode).toHaveBeenCalledWith('session-user',2)
 })
 it('refuses missing configuration without issuing any code',async()=>{
  vi.stubEnv('TELEGRAM_BOT_TOKEN','')
  expect(await createTelegramLink({},new FormData())).toHaveProperty('error')
  expect(mocks.issueCode).not.toHaveBeenCalled()
 })
 it('does not issue links while the feature is disabled',async()=>{
  vi.stubEnv('TELEGRAM_ENABLED','false')
  expect(await createTelegramLink({},new FormData())).toHaveProperty('error')
  expect(mocks.issueCode).not.toHaveBeenCalled()
 })
 it('does not continue when session resolution fails',async()=>{
  mocks.getUserId.mockRejectedValue(new Error('unauthenticated'))
  await expect(createTelegramLink({},new FormData())).rejects.toThrow('unauthenticated')
  expect(mocks.issueCode).not.toHaveBeenCalled()
 })
 it('revokes only the session user and refreshes the page',async()=>{
  const form=new FormData();form.set('userId','victim')
  expect(await revokeTelegramLink({},form)).toEqual({revoked:true})
  expect(mocks.revoke).toHaveBeenCalledWith('session-user');expect(mocks.revalidate).toHaveBeenCalledWith('/telegram')
 })
 it('does not expose database exception contents',async()=>{
  mocks.issueCode.mockRejectedValue(new Error('sensitive financial parameters'))
  const result=await createTelegramLink({},new FormData());expect(JSON.stringify(result)).not.toContain('sensitive')
 })
})
