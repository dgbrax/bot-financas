// Pure mapping from Pluggy data to app rows.

import type { Classification } from '@/lib/bank/classify'
import { ACCOUNT_NAME_MAX } from '@/lib/banks'
import { centsToDecimal, toCents } from '@/lib/money'
import type { PluggyAccount, PluggyTransaction } from './types'

/** "Pluggy Bank · Conta Corrente", within the account-name limit. */
export function accountDisplayName(connectorName: string, account: PluggyAccount, suffix = '') {
  const label = account.marketingName || account.name
  const base = `${connectorName} · ${label}`
  return (base.slice(0, ACCOUNT_NAME_MAX - suffix.length).trim() + suffix).slice(0, ACCOUNT_NAME_MAX)
}

/** Last 4 digits only; never store full account/card numbers. */
export function numberMask(number: string | null) {
  if (!number) return null
  const digits = number.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

/**
 * Balance as shown in the app. Bank accounts: as reported. Credit cards: the
 * outstanding bill is a debt, so it's always shown as a negative number
 * (providers differ on the sign; the Sandbox reports -916.30).
 */
export function accountBalanceDecimal(account: PluggyAccount) {
  const cents = toCents(account.balance)
  return centsToDecimal(account.type === 'CREDIT' ? -Math.abs(cents) : cents)
}

export type ImportedRow = {
  externalId: string
  type: 'income' | 'expense'
  amount: string
  description: string
  category: string
  categoryStatus: 'suggested' | 'review'
  method: string
  occurredAt: string
  status: 'posted' | 'pending'
  merchant: string | null
  bankCategory: string | null
  isTransfer: boolean
  externalUpdatedAt: Date | null
}

const MAX_DESCRIPTION = 120

export function toImportedRow(tx: PluggyTransaction, c: Classification): ImportedRow {
  const description = (tx.description || tx.descriptionRaw || '(sem descrição)').replace(/\s+/g, ' ').trim()
  const withInstallment = tx.installment
    ? `${description} (${tx.installment.number}/${tx.installment.total})`
    : description
  return {
    externalId: tx.id,
    type: c.type,
    amount: centsToDecimal(toCents(c.amount)),
    description: withInstallment.slice(0, MAX_DESCRIPTION),
    category: c.category,
    categoryStatus: c.categoryStatus,
    method: c.method,
    occurredAt: tx.date,
    status: tx.status === 'PENDING' ? 'pending' : 'posted',
    merchant: tx.merchantName?.slice(0, 120) ?? null,
    bankCategory: tx.category?.slice(0, 120) ?? null,
    isTransfer: c.isTransfer,
    externalUpdatedAt: tx.updatedAt,
  }
}

/** First sync: everything; later: re-read a window to catch status changes. */
export const RESYNC_WINDOW_DAYS = 45

export function syncDateFrom(lastSyncedAt: Date | null): string | undefined {
  if (!lastSyncedAt) return undefined
  const d = new Date(lastSyncedAt.getTime() - RESYNC_WINDOW_DAYS * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export const IN_PROGRESS_STATUSES = new Set(['UPDATING'])
export const NEEDS_USER_STATUSES = new Set(['LOGIN_ERROR', 'WAITING_USER_INPUT'])

/** pt-BR description of an item status for the UI. */
export function itemStatusLabel(status: string, executionStatus: string | null) {
  switch (status) {
    case 'UPDATED':
      return executionStatus === 'PARTIAL_SUCCESS' ? 'Atualizado (parcial)' : 'Atualizado'
    case 'UPDATING':
      return 'Sincronizando com o banco…'
    case 'WAITING_USER_INPUT':
      return 'Aguardando sua confirmação (MFA)'
    case 'LOGIN_ERROR':
      return 'Credenciais inválidas: reconecte'
    case 'OUTDATED':
      return 'Desatualizado: última atualização falhou'
    case 'DISCONNECTED':
      return 'Desconectado'
    default:
      return status
  }
}
