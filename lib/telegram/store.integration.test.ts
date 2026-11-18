// Real PostgreSQL only: disposable local database, never DATABASE_URL / APP_DATABASE_URL.
import { readFileSync, readdirSync } from 'node:fs'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
 beforeAll(async()=>{
  // A reused disposable test container may already have these migrations.
  const existing=await query("SELECT to_regclass('public.telegram_links') AS name")
  if(existing[0].name) return
  for(const file of readdirSync('drizzle').filter(f=>/^\d+.*\.sql$/.test(f)).sort()) {
   await pool!.query(readFileSync(`drizzle/${file}`,'utf8'))
  }
 },30000)
 beforeEach(async()=>{
  await query('TRUNCATE telegram_updates,telegram_link_codes,telegram_links,transactions,bank_accounts,"user" RESTART IDENTITY CASCADE')
  await query(`INSERT INTO "user" (id,name,email) VALUES ('a','Alice','a@example.test'),('b','Bob','b@example.test')`)
  await query(`INSERT INTO bank_accounts ("userId",name,bank,balance) VALUES ('a','Carteira A','manual',100),('b','Carteira B','manual',900)`)
 })
 afterAll(async()=>{await pool?.end()})
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
  const balance=await run(111,'/saldo');expect(balance).toContain('65,00');expect(balance).not.toContain('Carteira B')
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
 it('reuses dashboard snapshot and duplicate rules for balances',async()=>{
  await linked()
  await query(`UPDATE bank_accounts SET balance=100,"balanceAt"='2026-11-01' WHERE id=1`)
  await query(`INSERT INTO transactions ("userId","accountId",type,amount,description,category,"occurredAt") VALUES
    ('a',1,'income',50,'before snapshot','Outros','2026-10-31'),
    ('a',1,'expense',10,'after snapshot','Outros','2026-11-02'),
    ('b',2,'income',999,'other user','Outros','2026-11-02')`)
  expect(await run(111,'/saldo')).toContain('90,00')
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
