import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { formatBRL } from '@/lib/finance'
import { centsToDecimal, fromCents, toCents } from '@/lib/money'
import { commandText, hashCode, HELP, LINK_TTL_MS, NEED_LINK, newLinkCode,
  parseTelegramTransaction, todayInBrazil, type PrivateMessage } from './protocol'

type Link = { id: string; userId: string; accountId: number }
type Pending = { updateId: string; chatId: string; telegramUserId: string;
  userId: string | null; bindingId: string | null; reply: string | null }
export class TelegramInputError extends Error {}

/** All mutations and the dedup marker commit together; no financial side effects outside SQL. */
export class TelegramStore {
  constructor(private pool: Pick<Pool, 'connect'>) {}

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL statement_timeout = '8000'")
      await client.query("SET LOCAL lock_timeout = '5000'")
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally { client.release() }
  }

  private async lock(client: PoolClient, key: string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key])
  }

  async issueCode(userId: string, accountId: number) {
    if (!Number.isSafeInteger(accountId) || accountId <= 0 || accountId > 2_147_483_647) throw new TelegramInputError('Escolha uma conta válida.')
    return this.transaction(async client => {
      await this.lock(client, `user:${userId}`)
      const { rows } = await client.query(`SELECT a.id FROM bank_accounts a JOIN "user" u ON u.id=a."userId"
        WHERE a.id=$1 AND a."userId"=$2 FOR SHARE OF a, u`, [accountId, userId])
      if (!rows.length) throw new TelegramInputError('Conta não encontrada.')
      const { rows: links } = await client.query('SELECT id FROM telegram_links WHERE "userId"=$1', [userId])
      if (links.length) throw new TelegramInputError('Desvincule o Telegram atual antes de gerar outro link.')
      const link = newLinkCode()
      await client.query(`INSERT INTO telegram_link_codes (hash,"userId","accountId","expiresAt")
        VALUES ($1,$2,$3,now()+interval '10 minutes') ON CONFLICT ("userId") DO UPDATE
        SET hash=excluded.hash,"accountId"=excluded."accountId","expiresAt"=excluded."expiresAt","createdAt"=now()`,
      [link.hash, userId, accountId])
      return { url: link.url, expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString() }
    })
  }

  async revoke(userId: string) {
    return this.transaction(async client => {
      await this.lock(client, `user:${userId}`)
      await client.query('DELETE FROM telegram_link_codes WHERE "userId"=$1', [userId])
      await client.query('DELETE FROM telegram_links WHERE "userId"=$1', [userId])
      await client.query('UPDATE telegram_updates SET reply=NULL WHERE "userId"=$1', [userId])
    })
  }

  async accountsForUser(userId: string) {
    return this.transaction(async client => {
      await this.lock(client, `user:${userId}`)
      // Verify the user still exists before provisioning; no auth changes.
      const user = await client.query('SELECT id FROM "user" WHERE id=$1 FOR SHARE', [userId])
      if (!user.rows.length) throw new TelegramInputError('Usuário indisponível.')
      const accounts = await client.query('SELECT id,name FROM bank_accounts WHERE "userId"=$1 ORDER BY id', [userId])
      if (accounts.rows.length) return accounts.rows as { id: number; name: string }[]
      const created = await client.query(`INSERT INTO bank_accounts ("userId",name,bank)
        VALUES ($1,'Carteira','manual') RETURNING id,name`, [userId])
      return created.rows as { id: number; name: string }[]
    })
  }

  async status(userId: string) {
    const client = await this.pool.connect()
    try {
      const { rows } = await client.query(`SELECT l."telegramUserId", a.name AS "accountName"
        FROM telegram_links l JOIN bank_accounts a ON a.id=l."accountId" AND a."userId"=l."userId"
        WHERE l."userId"=$1`, [userId])
      return rows[0] as { telegramUserId: string; accountName: string } | undefined
    } finally { client.release() }
  }

  private async bind(client: PoolClient, message: PrivateMessage, code: string): Promise<{ text: string; link?: Link }> {
    const invalid = { text: 'Link inválido, expirado ou já utilizado. Gere outro no dashboard.' }
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return invalid
    const hash = hashCode(code)
    const candidate = await client.query('SELECT "userId" FROM telegram_link_codes WHERE hash=$1', [hash])
    if (!candidate.rows.length) return invalid
    const userId: string = candidate.rows[0].userId
    await this.lock(client, `user:${userId}`)
    // Recheck expiry and ownership under the same lock used by dashboard revoke/issue.
    const codes = await client.query(`SELECT c."accountId" FROM telegram_link_codes c
      JOIN bank_accounts a ON a.id=c."accountId" AND a."userId"=c."userId"
      JOIN "user" u ON u.id=c."userId"
      WHERE c.hash=$1 AND c."userId"=$2 AND c."expiresAt">clock_timestamp() FOR UPDATE OF c`, [hash, userId])
    if (!codes.rows.length) return invalid
    const inserted = await client.query(`INSERT INTO telegram_links (id,"telegramUserId","chatId","userId","accountId")
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id,"userId","accountId"`,
    [randomUUID(), message.telegramId, message.chatId, userId, codes.rows[0].accountId])
    if (!inserted.rows.length) return { text: 'Já existe um vínculo. Desvincule a conta atual antes de tentar novamente.' }
    await client.query('DELETE FROM telegram_link_codes WHERE "userId"=$1', [userId])
    return { text: `Telegram vinculado. ${HELP}`, link: inserted.rows[0] }
  }

  private async linked(client: PoolClient, message: PrivateMessage): Promise<Link | undefined> {
    const { rows } = await client.query(`SELECT l.id,l."userId",l."accountId" FROM telegram_links l
      JOIN "user" u ON u.id=l."userId"
      WHERE l."telegramUserId"=$1 AND l."chatId"=$2`, [message.telegramId, message.chatId])
    if (!rows[0]) return undefined
    await this.lock(client, `user:${rows[0].userId}`)
    const checked = await client.query(`SELECT l.id,l."userId",l."accountId" FROM telegram_links l
      JOIN bank_accounts a ON a.id=l."accountId" AND a."userId"=l."userId"
      JOIN "user" u ON u.id=l."userId"
      WHERE l.id=$1 AND l."telegramUserId"=$2 AND l."chatId"=$3 FOR SHARE OF a, u`,
    [rows[0].id, message.telegramId, message.chatId])
    return checked.rows[0]
  }

  async process(message: PrivateMessage): Promise<string | null> {
    return this.transaction(async client => {
      await this.lock(client, `telegram:${message.telegramId}`)
      const marker = await client.query(`INSERT INTO telegram_updates ("updateId","chatId","messageId","telegramUserId")
        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING "updateId"`,
      [String(message.updateId), message.chatId, String(message.messageId), message.telegramId])
      if (!marker.rows.length) {
        const existing = await client.query(`SELECT "updateId" FROM telegram_updates
          WHERE "telegramUserId"=$1 AND "chatId"=$2 AND ("updateId"=$3 OR "messageId"=$4)`,
        [message.telegramId, message.chatId, String(message.updateId), String(message.messageId)])
        return existing.rows[0]?.updateId ?? null
      }
      const text = commandText(message.text)
      let link: Link | undefined, reply: string
      const start = /^\/start\s+(\S+)$/.exec(text)
      if (start) {
        const result = await this.bind(client, message, start[1])
        reply = result.text; link = result.link
      } else {
        link = await this.linked(client, message)
        reply = link ? await this.execute(client, message, link, text) : NEED_LINK
      }
      await client.query(`UPDATE telegram_updates SET reply=$2,"userId"=$3,"bindingId"=$4 WHERE "updateId"=$1`,
      [String(message.updateId), reply, link?.userId ?? null, link?.id ?? null])
      return String(message.updateId)
    })
  }

  private async execute(client: PoolClient, message: PrivateMessage, link: Link, text: string) {
    const userId = link.userId
    if (text === '/desvincular') {
      await client.query('DELETE FROM telegram_link_codes WHERE "userId"=$1', [userId])
      await client.query('DELETE FROM telegram_links WHERE id=$1 AND "userId"=$2', [link.id, userId])
      await client.query('UPDATE telegram_updates SET reply=NULL WHERE "userId"=$1', [userId])
      return 'Acesso desvinculado. Para usar novamente, gere um link no dashboard.'
    }
    if (text === '/start' || text === '/ajuda' || text === '/help') return HELP
    if (text === '/contas') {
      const { rows } = await client.query('SELECT id,name FROM bank_accounts WHERE "userId"=$1 ORDER BY id LIMIT 30', [userId])
      return `Contas (ativa: ${link.accountId}):\n${rows.map(r => `${r.id}: ${r.name}`).join('\n')}\nUse /conta ID para selecionar.`
    }
    const selection = /^\/conta\s+([1-9]\d{0,9})$/.exec(text)
    if (selection) {
      if (Number(selection[1]) > 2_147_483_647) return 'Conta não encontrada.'
      const { rows } = await client.query(`UPDATE telegram_links l SET "accountId"=a.id FROM bank_accounts a
        WHERE l.id=$1 AND l."userId"=$2 AND a.id=$3 AND a."userId"=$2 RETURNING a.name`,
      [link.id, userId, Number(selection[1])])
      return rows.length ? `Conta selecionada: ${rows[0].name}.` : 'Conta não encontrada.'
    }
    if (text === '/saldo' || text.toLowerCase() === 'saldo') {
      // Same ledger semantics as production getOverallBalance: all user rows,
      // including historical dashboard entries without accountId. No snapshots.
      const { rows } = await client.query(`SELECT COALESCE(SUM(CASE WHEN type='income'
        THEN amount ELSE -amount END),0)::text AS balance FROM transactions WHERE "userId"=$1`, [userId])
      return `Saldo registrado: ${formatBRL(fromCents(toCents(rows[0].balance)))}.`
    }
    if (text === '/ultimas' || text.toLowerCase() === 'ultimas') {
      const { rows } = await client.query(`SELECT t.type,t.amount,t.description,t."occurredAt"::text AS "occurredAt",COALESCE(a.name,'Dashboard') AS name
        FROM transactions t LEFT JOIN bank_accounts a ON a.id=t."accountId" AND a."userId"=t."userId"
        WHERE t."userId"=$1
        ORDER BY t."occurredAt" DESC,t.id DESC LIMIT 5`, [userId])
      return rows.length ? `Últimas transações:\n${rows.map(r => `${String(r.occurredAt).slice(0, 10)} ${r.type === 'income' ? '+' : '-'}${formatBRL(Number(r.amount))} — ${r.description} (${r.name})`).join('\n')}` : 'Nenhuma transação registrada.'
    }
    const parsed = parseTelegramTransaction(text, todayInBrazil())
    if (!parsed.ok) return HELP
    const { rows } = await client.query(`INSERT INTO transactions
      ("userId","accountId",type,amount,description,category,method,source,"externalId","occurredAt")
      SELECT $1,a.id,$3,$4,$5,$6,'outro','telegram',$7,$8 FROM bank_accounts a
      JOIN "user" u ON u.id=a."userId" WHERE a.id=$2 AND a."userId"=$1
      ON CONFLICT DO NOTHING RETURNING id`,
    [userId, link.accountId, parsed.type, centsToDecimal(toCents(parsed.amount)), parsed.description,
      parsed.category, `${message.chatId}:${message.messageId}`, parsed.occurredAt])
    return rows.length ? `${parsed.type === 'income' ? 'Receita' : 'Despesa'} registrada: ${formatBRL(parsed.amount)} — ${parsed.description}. Conta: ${link.accountId}.` : 'Lançamento não registrado: conta indisponível ou mensagem já processada.'
  }

  /** Retryable outbox: rechecks the binding before disclosing financial replies. */
  async deliver(updateId: string, send: (chatId: string, text: string) => Promise<void>) {
    const client = await this.pool.connect()
    let pending: Pending | undefined
    try {
      const result = await client.query('SELECT * FROM telegram_updates WHERE "updateId"=$1 AND reply IS NOT NULL', [updateId])
      pending = result.rows[0]
    } finally { client.release() }
    if (!pending) return
    await this.transaction(async client => {
      await this.lock(client, `telegram:${pending!.telegramUserId}`)
      if (pending!.userId) await this.lock(client, `user:${pending!.userId}`)
      const result = await client.query('SELECT * FROM telegram_updates WHERE "updateId"=$1 AND reply IS NOT NULL FOR UPDATE', [updateId])
      const row: Pending | undefined = result.rows[0]
      if (!row?.reply) return
      let allowed = !row.bindingId
      if (row.bindingId) {
        const current = await client.query(`SELECT l.id FROM telegram_links l JOIN "user" u ON u.id=l."userId"
          JOIN bank_accounts a ON a.id=l."accountId" AND a."userId"=l."userId"
          WHERE l.id=$1 AND l."telegramUserId"=$2 AND l."chatId"=$3 AND l."userId"=$4`,
        [row.bindingId, row.telegramUserId, row.chatId, row.userId])
        allowed = current.rows.length > 0
      }
      // Unlink acknowledgement has no sensitive content and needs no live binding.
      if (allowed || row.reply === 'Acesso desvinculado. Para usar novamente, gere um link no dashboard.') {
        await send(row.chatId, row.reply)
      }
      await client.query('UPDATE telegram_updates SET reply=NULL,"deliveredAt"=now() WHERE "updateId"=$1', [updateId])
    })
  }
}
