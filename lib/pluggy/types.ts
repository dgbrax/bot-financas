// Validated shapes of the Pluggy API responses we use.
// Field names follow https://docs.pluggy.ai (Items, Accounts, Transactions).
// Only fields the app reads are kept; unknown fields are ignored.

export class PluggyValidationError extends Error {
  constructor(what: string, detail: string) {
    super(`Invalid Pluggy ${what}: ${detail}`)
    this.name = 'PluggyValidationError'
  }
}

type Obj = Record<string, unknown>

function obj(v: unknown, what: string): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new PluggyValidationError(what, 'not an object')
  }
  return v as Obj
}
function str(o: Obj, k: string, what: string): string {
  const v = o[k]
  if (typeof v !== 'string' || !v) throw new PluggyValidationError(what, `${k} must be a non-empty string`)
  return v
}
function optStr(o: Obj, k: string): string | null {
  const v = o[k]
  return typeof v === 'string' && v ? v : null
}
function num(o: Obj, k: string, what: string): number {
  const v = o[k]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new PluggyValidationError(what, `${k} must be a finite number`)
  return v
}
function optNum(o: Obj, k: string): number | null {
  const v = o[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function optDate(o: Obj, k: string): Date | null {
  const v = o[k]
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export type PluggyConnector = {
  id: number
  name: string
  imageUrl: string | null
  isSandbox: boolean
}

export function parseConnector(v: unknown): PluggyConnector {
  const o = obj(v, 'connector')
  return {
    id: num(o, 'id', 'connector'),
    name: str(o, 'name', 'connector'),
    imageUrl: optStr(o, 'imageUrl'),
    isSandbox: o.isSandbox === true,
  }
}

export type PluggyItem = {
  id: string
  connector: PluggyConnector
  status: string
  executionStatus: string | null
  clientUserId: string | null
  error: { code: string | null; message: string | null } | null
  lastUpdatedAt: Date | null
  consentExpiresAt: Date | null
}

export function parseItem(v: unknown): PluggyItem {
  const o = obj(v, 'item')
  const err = o.error && typeof o.error === 'object' ? (o.error as Obj) : null
  return {
    id: str(o, 'id', 'item'),
    connector: parseConnector(o.connector),
    status: str(o, 'status', 'item'),
    executionStatus: optStr(o, 'executionStatus'),
    clientUserId: optStr(o, 'clientUserId'),
    error: err ? { code: optStr(err, 'code'), message: optStr(err, 'message') } : null,
    lastUpdatedAt: optDate(o, 'lastUpdatedAt'),
    consentExpiresAt: optDate(o, 'consentExpiresAt'),
  }
}

export type PluggyAccount = {
  id: string
  itemId: string
  type: 'BANK' | 'CREDIT'
  subtype: string | null
  name: string
  marketingName: string | null
  number: string | null
  balance: number
  currencyCode: string
}

export function parseAccount(v: unknown): PluggyAccount {
  const o = obj(v, 'account')
  const type = o.type
  if (type !== 'BANK' && type !== 'CREDIT') {
    throw new PluggyValidationError('account', `unknown type ${String(type)}`)
  }
  return {
    id: str(o, 'id', 'account'),
    itemId: str(o, 'itemId', 'account'),
    type,
    subtype: optStr(o, 'subtype'),
    name: str(o, 'name', 'account'),
    marketingName: optStr(o, 'marketingName'),
    number: optStr(o, 'number'),
    balance: num(o, 'balance', 'account'),
    currencyCode: optStr(o, 'currencyCode') ?? 'BRL',
  }
}

export type PluggyTransaction = {
  id: string
  accountId: string
  description: string
  descriptionRaw: string | null
  amount: number
  currencyCode: string
  /** YYYY-MM-DD */
  date: string
  type: 'DEBIT' | 'CREDIT'
  status: 'POSTED' | 'PENDING'
  category: string | null
  operationType: string | null
  paymentMethod: string | null
  merchantName: string | null
  merchantCategory: string | null
  payerDocument: string | null
  receiverDocument: string | null
  hasCreditCardMetadata: boolean
  installment: { number: number; total: number } | null
  updatedAt: Date | null
}

function docValue(participant: unknown): string | null {
  if (!participant || typeof participant !== 'object') return null
  const doc = (participant as Obj).documentNumber
  if (!doc || typeof doc !== 'object') return null
  return optStr(doc as Obj, 'value')
}

export function parseTransaction(v: unknown): PluggyTransaction {
  const o = obj(v, 'transaction')
  const type = o.type
  if (type !== 'DEBIT' && type !== 'CREDIT') {
    throw new PluggyValidationError('transaction', `unknown type ${String(type)}`)
  }
  const status = o.status ?? 'POSTED'
  if (status !== 'POSTED' && status !== 'PENDING') {
    throw new PluggyValidationError('transaction', `unknown status ${String(status)}`)
  }
  const date = str(o, 'date', 'transaction')
  const day = date.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new PluggyValidationError('transaction', 'bad date')
  const pd = o.paymentData && typeof o.paymentData === 'object' ? (o.paymentData as Obj) : null
  const merchant = o.merchant && typeof o.merchant === 'object' ? (o.merchant as Obj) : null
  const cc = o.creditCardMetadata && typeof o.creditCardMetadata === 'object' ? (o.creditCardMetadata as Obj) : null
  const instNum = cc ? optNum(cc, 'installmentNumber') : null
  const instTotal = cc ? optNum(cc, 'totalInstallments') : null
  return {
    id: str(o, 'id', 'transaction'),
    accountId: str(o, 'accountId', 'transaction'),
    description: optStr(o, 'description') ?? optStr(o, 'descriptionRaw') ?? '(sem descrição)',
    descriptionRaw: optStr(o, 'descriptionRaw'),
    amount: num(o, 'amount', 'transaction'),
    currencyCode: optStr(o, 'currencyCode') ?? 'BRL',
    date: day,
    type,
    status,
    category: optStr(o, 'category'),
    operationType: optStr(o, 'operationType'),
    paymentMethod: pd ? optStr(pd, 'paymentMethod') : null,
    merchantName: merchant ? (optStr(merchant, 'name') ?? optStr(merchant, 'businessName')) : null,
    merchantCategory: merchant ? optStr(merchant, 'category') : null,
    payerDocument: pd ? docValue(pd.payer) : null,
    receiverDocument: pd ? docValue(pd.receiver) : null,
    hasCreditCardMetadata: !!cc,
    installment: instNum && instTotal && instTotal > 1 ? { number: instNum, total: instTotal } : null,
    updatedAt: optDate(o, 'updatedAt'),
  }
}
