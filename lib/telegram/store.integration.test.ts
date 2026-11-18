// Real PostgreSQL only: disposable local database, never DATABASE_URL / APP_DATABASE_URL.
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
const authMock = vi.hoisted(() => ({ userId: 'a' }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => ({ user: { id: authMock.userId } }) } } }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { TelegramStore } from './store'
import { hashCode, type PrivateMessage } from './protocol'

const url=process.env.TELEGRAM_TEST_DATABASE_URL
const enabled=Boolean(url)
const local=url ? new URL(url) : null
if (local && (!['127.0.0.1','localhost','[::1]'].includes(local.hostname) || local.pathname!=='/telegram_test')) {
 throw new Error('Telegram tests require a disposable localhost database named telegram_test')
}
const pool=enabled ? new Pool({connectionString:url}) : null
const store=pool ? new TelegramStore(pool) : null
let seq=100
function message(telegramId:number,text:string,updateId=++seq,messageId=updateId):PrivateMessage {
 return {telegramId:String(telegramId),chatId:String(telegramId),updateId,messageId,text}
}
async function query(sql:string,values:unknown[]=[]){return (await pool!.query(sql,values)).rows}
async function code(user='a',account=1){return new URL((await store!.issueCode(user,account)).url).searchParams.get('start')!}
async function run(id:number,text:string){const update=await store!.process(message(id,text));return (await query('SELECT reply FROM telegram_updates WHERE "updateId"=$1',[update]))[0]?.reply as string}
async function linked(id=111,user='a',account=1){await run(id,`/start ${await code(user,account)}`)}

describe.skipIf(!enabled)('Telegram SQL integration (disposable Postgres)',()=>{
 let dashboard: typeof import('@/app/actions/transactions')
 let dashboardPool: Pool
 beforeAll(async()=>{
  const existing=await query("SELECT to_regclass('public.telegram_links') AS name")
  if(!existing[0].name) {
   await pool!.query(readFileSync('lib/telegram/fixtures/main-schema.sql','utf8'))
   await pool!.query(`INSERT INTO "user"(id,name,email) VALUES ('historical','Historical','fixture@example.test')`)
   await pool!.query(`INSERT INTO transactions ("userId",type,amount,description,category) VALUES ('historical','income',123.45,'before migration','Outros')`)
   const before = (await query('SELECT row_to_json(t) AS row FROM transactions t'))[0].row
   await pool!.query(readFileSync('migrations/001_telegram_main.sql','utf8'))
   // pg sends a multi-statement query in an implicit transaction; concurrent indexes
   // must be separate statements, as with psql --file in autocommit mode.
   const indexes = readFileSync('migrations/002_telegram_indexes.sql','utf8').replace(/--[^\n]*/g,'')
   for(const sql of indexes.split(';').map(s=>s.trim()).filter(Boolean)) await pool!.query(sql)
   const after = (await query('SELECT row_to_json(t) AS row FROM transactions t'))[0].row
   for(const [key,value] of Object.entries(before)) expect(after[key]).toEqual(value)
   expect(after.accountId).toBeNull();expect(after.externalId).toBeNull();expect(after.source).toBe('manual')
  }
  vi.stubEnv('DATABASE_URL',url!)
  dashboard=await import('@/app/actions/transactions')
  dashboardPool=(await import('@/lib/db')).pool
 },30000)
 beforeEach(async()=>{
  await query('TRUNCATE telegram_updates,telegram_link_codes,telegram_links,transactions,bank_accounts,"user" RESTART IDENTITY CASCADE')
  await query(`INSERT INTO "user" (id,name,email) VALUES ('a','Alice','a@example.test'),('b','Bob','b@example.test')`)
  authMock.userId='a'
  await query(`INSERT INTO bank_accounts ("userId",name,bank) VALUES ('a','Carteira A','manual'),('b','Carteira B','manual')`)
 })
 afterAll(async()=>{await dashboardPool?.end();await pool?.end();vi.unstubAllEnvs()})
 it('never registers or queries financial data before linking',async()=>{
  expect(await run(111,'Gastei 35 reais no almoço')).toContain('Vincule primeiro')
  expect(await run(111,'/saldo')).toContain('Vincule primeiro')
  expect(await query('SELECT * FROM transactions')).toHaveLength(0)
 })
 it('validates session user/account ownership when issuing links',async()=>{
  await expect(store!.issueCode('a',2)).rejects.toThrow('Conta não encontrada')
  await expect(store!.issueCode('missing',1)).rejects.toThrow()
  await expect(store!.issueCode('a',NaN)).rejects.toThrow()
  await expect(store!.issueCode('a',9999999999)).rejects.toThrow()
 })
 it('stores only a hash and invalidates prior links',async()=>{
  const first=await code();const second=await code()
  const rows=await query('SELECT hash FROM telegram_link_codes')
  expect(rows).toEqual([{hash:hashCode(second)}]);expect(JSON.stringify(rows)).not.toContain(second)
  expect(await run(111,`/start ${first}`)).toContain('inválido')
  expect(await run(111,`/start ${second}`)).toContain('vinculado')
  expect(await query('SELECT * FROM telegram_link_codes')).toHaveLength(0)
 })
 it('rejects expired codes and consumes a code only once under concurrent redemption',async()=>{
  let value=await code();await query(`UPDATE telegram_link_codes SET "expiresAt"=now()-interval '1 minute'`)
  expect(await run(111,`/start ${value}`)).toContain('expirado')
  value=await code()
  await Promise.all([run(111,`/start ${value}`),run(222,`/start ${value}`)])
  expect(await query('SELECT * FROM telegram_links')).toHaveLength(1)
 })
 it('never silently reassigns an existing dashboard or Telegram identity',async()=>{
  await linked()
  await expect(store!.issueCode('a',1)).rejects.toThrow('Desvincule')
  const other=await code('b',2)
  expect(await run(111,`/start ${other}`)).toContain('Já existe')
  expect((await query('SELECT "userId" FROM telegram_links'))[0].userId).toBe('a')
 })
 it('records exact cents/category and isolates expenses, balances, history and account selection',async()=>{
  await linked();await linked(222,'b',2)
  expect(await run(111,'Gastei 35 reais no almoço')).toContain('Despesa registrada')
  expect(await run(222,'Recebi 150 reais')).toContain('Receita registrada')
  expect(await query('SELECT "userId",amount,source,category,method FROM transactions ORDER BY id')).toEqual([
   {userId:'a',amount:'35.00',source:'telegram',category:'Alimentação',method:'outro'},
   {userId:'b',amount:'150.00',source:'telegram',category:'Outros',method:'outro'},
  ])
  const balance=await run(111,'/saldo');expect(balance).toContain('35,00');expect(balance).not.toContain('Carteira B')
  const history=await run(111,'/ultimas');expect(history).toContain('almoço');expect(history).not.toContain('Recebimento')
  const accounts=await run(111,'/contas');expect(accounts).toContain('Carteira A');expect(accounts).not.toContain('Carteira B')
  expect(await run(111,'/conta 2')).toBe('Conta não encontrada.')
  expect(await run(111,'/conta 9999999999')).toBe('Conta não encontrada.')
  expect((await query('SELECT "accountId" FROM telegram_links WHERE "userId"=$1',['a']))[0].accountId).toBe(1)
 })
 it('revalidates account ownership on every command, even for an inconsistent stored binding',async()=>{
  await linked()
  await query('UPDATE telegram_links SET "accountId"=2 WHERE "userId"=$1',['a'])
  for(const command of ['/saldo','/ultimas','/contas','Gastei 10 reais com café']) {
   expect(await run(111,command)).toContain('Vincule primeiro')
  }
  expect(await query('SELECT * FROM transactions')).toHaveLength(0)
 })
 it('preserves legacy dashboard create, listing, balance, flow and deletion without accountId',async()=>{
  const form=new FormData()
  for(const [k,v] of Object.entries({type:'income',amount:'100,00',description:'Legacy salary',category:'Salário',method:'pix',occurredAt:'2026-11-18'})) form.set(k,v)
  expect(await dashboard.addTransaction({},form)).toEqual({ok:true})
  const legacy=(await query('SELECT * FROM transactions'))[0]
  expect(legacy.accountId).toBeNull();expect(legacy.source).toBe('manual')
  expect(await dashboard.getOverallBalance()).toBe(100)
  await linked();await run(111,'Gastei 35 reais no almoço')
  expect(await dashboard.getOverallBalance()).toBe(65)
  expect(await run(111,'/saldo')).toContain('65,00')
  const month=await dashboard.getMonthTransactions('2026-11')
  expect(month).toHaveLength(2)
  expect((await dashboard.getMonthlyFlow('2026-11',1))[0]).toMatchObject({income:100,expense:35})
  expect(await run(111,'/ultimas')).toContain('Legacy salary (Dashboard)')
  // Existing dashboard cannot delete another user's data.
  authMock.userId='b';await dashboard.deleteTransaction(legacy.id)
  expect(await dashboard.getOverallBalance()).toBe(0)
  expect(await dashboard.getMonthTransactions('2026-11')).toHaveLength(0)
  expect(await query('SELECT * FROM transactions WHERE id=$1',[legacy.id])).toHaveLength(1)
  authMock.userId='a';await dashboard.deleteTransaction(legacy.id)
  expect(await dashboard.getOverallBalance()).toBe(-35)
 })
 it('provisions only the authenticated Telegram onboarding user, idempotently',async()=>{
  await query('TRUNCATE bank_accounts RESTART IDENTITY CASCADE')
  const [first,second]=await Promise.all([store!.accountsForUser('a'),store!.accountsForUser('a')])
  expect(first).toEqual(second);expect(first).toHaveLength(1)
  expect(await query('SELECT * FROM bank_accounts WHERE "userId"=$1',['b'])).toHaveLength(0)
  await expect(store!.accountsForUser('missing')).rejects.toThrow('Usuário indisponível')
 })
 it('adds no Pluggy tables and keeps accountId nullable with a valid external ID index',async()=>{
  expect((await query("SELECT to_regclass('public.pluggy_items') AS table"))[0].table).toBeNull()
  expect((await query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='accountId'"))[0].is_nullable).toBe('YES')
  expect((await query("SELECT indisvalid FROM pg_index WHERE indexrelid='transactions_user_source_external_unique'::regclass"))[0].indisvalid).toBe(true)
  expect((await query("SELECT convalidated FROM pg_constraint WHERE conname='transactions_account_id_fk'"))[0].convalidated).toBe(true)
 })
 it('processes concurrent duplicate update IDs and message IDs exactly once',async()=>{
  await linked();const original=message(111,'Gastei 12,50 reais com lanche')
  await Promise.all([store!.process(original),store!.process(original)])
  await store!.process({...original,updateId:++seq})
  expect(await query('SELECT * FROM transactions')).toHaveLength(1)
  expect((await query('SELECT amount FROM transactions'))[0].amount).toBe('12.50')
 })
 it('rolls back the dedup marker if insertion fails, allowing a safe retry',async()=>{
  await linked();const event=message(111,'Gastei 10 reais com café')
  await query(`CREATE FUNCTION telegram_fail_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test'; END $$`)
  await query('CREATE TRIGGER telegram_fail BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION telegram_fail_test()')
  try {
   await expect(store!.process(event)).rejects.toThrow()
   expect(await query('SELECT * FROM telegram_updates WHERE "updateId"=$1',[String(event.updateId)])).toHaveLength(0)
  } finally {await query('DROP TRIGGER telegram_fail ON transactions');await query('DROP FUNCTION telegram_fail_test()')}
  await store!.process(event);expect(await query('SELECT * FROM transactions')).toHaveLength(1)
 })
 it('retries failed outbound replies without repeating financial effects, then erases sensitive reply',async()=>{
  await linked();const event=message(111,'Gastei 10 reais com café');const id=await store!.process(event)
  const send=vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined)
  await expect(store!.deliver(id!,send)).rejects.toThrow('network')
  expect((await query('SELECT reply FROM telegram_updates WHERE "updateId"=$1',[id]))[0].reply).toContain('Despesa')
  await store!.process(event);await store!.deliver(id!,send);await store!.deliver(id!,send)
  expect(send).toHaveBeenCalledTimes(2);expect(await query('SELECT * FROM transactions')).toHaveLength(1)
  expect((await query('SELECT reply FROM telegram_updates WHERE "updateId"=$1',[id]))[0].reply).toBeNull()
 })
 it('revokes pending codes, financial commands and pending financial replies immediately',async()=>{
  await linked();const pending=await store!.process(message(111,'/saldo'))
  await store!.revoke('a');expect(await query('SELECT * FROM telegram_links')).toHaveLength(0)
  const send=vi.fn();await store!.deliver(pending!,send);expect(send).not.toHaveBeenCalled()
  expect(await run(111,'Recebi 100 reais')).toContain('Vincule primeiro')
  const value=await code();await store!.revoke('a');expect(await run(111,`/start ${value}`)).toContain('inválido')
 })
 it('drops stale replies if account deletion removed the binding and Telegram is linked to another dashboard user',async()=>{
  await linked();const pending=await store!.process(message(111,'/saldo'))
  await query('DELETE FROM bank_accounts WHERE id=1')
  await linked(111,'b',2)
  const send=vi.fn();await store!.deliver(pending!,send);expect(send).not.toHaveBeenCalled()
 })
 it('supports unlink from the bot and only local records, never actual bank movements',async()=>{
  await linked();expect(await run(111,'faça pix 100')).toContain('não realizo PIX')
  expect(await query('SELECT * FROM transactions')).toHaveLength(0)
  expect(await run(111,'/desvincular')).toContain('desvinculado')
  expect(await run(111,'/saldo')).toContain('Vincule primeiro')
 })
})
