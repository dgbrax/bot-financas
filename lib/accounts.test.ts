import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ACCOUNTS, MANUAL_ACCOUNT_NAME } from './accounts'

const seedSql = readFileSync(
  fileURLToPath(
    new URL('../drizzle/0002_seed_default_accounts.sql', import.meta.url),
  ),
  'utf8',
)

describe('default accounts', () => {
  it('seed SQL creates exactly the accounts in DEFAULT_ACCOUNTS', () => {
    const tuples = [...seedSql.matchAll(/\('([^']+)',\s*'([^']+)'\)/g)].map(
      ([, name, bank]) => ({ name, bank }),
    )
    expect(tuples).toEqual(DEFAULT_ACCOUNTS.map(({ name, bank }) => ({ name, bank })))
  })

  it('backfill targets the manual account', () => {
    expect(DEFAULT_ACCOUNTS.map((a) => a.name)).toContain(MANUAL_ACCOUNT_NAME)
    expect(seedSql).toContain(`ba."name" = '${MANUAL_ACCOUNT_NAME}'`)
  })

  it('backfill only touches rows without an account (idempotent)', () => {
    expect(seedSql).toMatch(/"accountId" IS NULL/)
    expect(seedSql).toMatch(/ON CONFLICT \("userId", "name"\) DO NOTHING/)
  })
})
