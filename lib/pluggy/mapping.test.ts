import { describe, expect, it } from 'vitest'
import { classify } from '@/lib/bank/classify'
import { accountBalanceDecimal, accountDisplayName, itemStatusLabel, numberMask, syncDateFrom, toImportedRow } from './mapping'
import type { PluggyAccount, PluggyTransaction } from './types'

const acct = (p: Partial<PluggyAccount>): PluggyAccount => ({
  id: 'a', itemId: 'i', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta Corrente', marketingName: null,
  number: '0001/12345-0', balance: 36001.43, currencyCode: 'BRL', ...p,
})
const tx = (p: Partial<PluggyTransaction>): PluggyTransaction => ({
  id: 'tx-1', accountId: 'a', description: 'NETFLIX.COM', descriptionRaw: null, amount: -55.9, currencyCode: 'BRL',
  date: '2026-11-01', type: 'DEBIT', status: 'POSTED', category: 'Video streaming', operationType: null,
  paymentMethod: null, merchantName: null, merchantCategory: null, payerDocument: null, receiverDocument: null,
  hasCreditCardMetadata: false, installment: null, updatedAt: new Date('2026-11-01T10:00:00Z'), ...p,
})

describe('account mapping', () => {
  it('names accounts by institution and product, within 40 chars', () => {
    expect(accountDisplayName('Pluggy Bank', acct({}))).toBe('Pluggy Bank · Conta Corrente')
    expect(accountDisplayName('Pluggy Bank', acct({ marketingName: 'Mastercard Black' }), ' 2')).toBe('Pluggy Bank · Mastercard Black 2')
    expect(accountDisplayName('A'.repeat(50), acct({}), ' 2').length).toBeLessThanOrEqual(40)
  })
  it('keeps only the last 4 digits of account numbers', () => {
    expect(numberMask('0001/12345-0')).toBe('3450')
    expect(numberMask('12')).toBeNull()
    expect(numberMask(null)).toBeNull()
  })
  it('bank balance as reported; card bill is always a debt (negative)', () => {
    expect(accountBalanceDecimal(acct({ balance: 36001.43 }))).toBe('36001.43')
    expect(accountBalanceDecimal(acct({ type: 'CREDIT', balance: -916.3 }))).toBe('-916.30')
    expect(accountBalanceDecimal(acct({ type: 'CREDIT', balance: 916.3 }))).toBe('-916.30')
  })
})

describe('transaction mapping', () => {
  it('maps a classified transaction to an imported row', () => {
    const t = tx({})
    expect(toImportedRow(t, classify({ tx: t, accountType: 'CREDIT' }))).toMatchObject({
      externalId: 'tx-1', type: 'expense', amount: '55.90', occurredAt: '2026-11-01', status: 'posted',
      category: 'Assinaturas', categoryStatus: 'suggested', method: 'credito', bankCategory: 'Video streaming', isTransfer: false,
    })
  })
  it('keeps pending status and installment info', () => {
    const t = tx({ status: 'PENDING', installment: { number: 2, total: 10 }, description: 'LOJA X' })
    expect(toImportedRow(t, classify({ tx: t, accountType: 'CREDIT' }))).toMatchObject({ status: 'pending', description: 'LOJA X (2/10)' })
  })
  it('amounts are exact decimals', () => {
    const t = tx({ amount: -0.29, category: null, description: 'x' })
    expect(toImportedRow(t, classify({ tx: t, accountType: 'BANK' })).amount).toBe('0.29')
  })
})

describe('sync window and status labels', () => {
  it('first sync reads everything; later syncs re-read 45 days', () => {
    expect(syncDateFrom(null)).toBeUndefined()
    expect(syncDateFrom(new Date('2026-11-04T12:00:00Z'))).toBe('2026-09-20')
  })
  it('labels item statuses in pt-BR', () => {
    expect(itemStatusLabel('LOGIN_ERROR', 'INVALID_CREDENTIALS')).toMatch(/reconecte/)
    expect(itemStatusLabel('UPDATED', 'PARTIAL_SUCCESS')).toBe('Atualizado (parcial)')
  })
})
