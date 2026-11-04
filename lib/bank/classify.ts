// Recognition + classification of imported bank transactions. Pure: no I/O.
//
// Precedence for the category:
//   1. structural rules (card bill payment, own-account transfer, withdrawal,
//      investment moves, refunds on cards)
//   2. Pluggy's enriched category (e.g. "Groceries", "Transfer - PIX")
//   3. merchant category
//   4. the text-command keyword map (lib/commands/categories.ts)
//   5. channel defaults, otherwise "Outros"
// Automatic results are never "confirmed": strong signals give "suggested",
// guesses give "review". Only the user confirms.

import { categorize, normalize } from '@/lib/commands/parse'
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type TransactionType,
} from '@/lib/finance'
import type { PluggyTransaction } from '@/lib/pluggy/types'

export type Method =
  | 'pix'
  | 'transferencia'
  | 'boleto'
  | 'debito'
  | 'credito'
  | 'saque'
  | 'deposito'
  | 'tarifa'
  | 'outro'

export type Classification = {
  type: TransactionType
  /** Absolute value, 2 decimals. */
  amount: number
  method: Method
  category: string
  categoryStatus: 'suggested' | 'review'
  isTransfer: boolean
  /** Short machine-readable reason, for tests/debugging. */
  rule: string
}

export type ClassifyInput = {
  tx: PluggyTransaction
  accountType: 'BANK' | 'CREDIT'
}

type CategoryHit = { expense?: string; income?: string; transfer?: boolean }

// Matched against Pluggy's category, then the merchant category. Order matters:
// more specific patterns first. Covers English (Pluggy) and Portuguese names.
const CATEGORY_RULES: Array<[RegExp, CategoryHit]> = [
  [/credit card payment|pagamento (de )?fatura/, { expense: 'Transferências', income: 'Transferências', transfer: true }],
  [/same (person|ownership)|mesma titularidade|own account/, { expense: 'Transferências', income: 'Transferências', transfer: true }],
  [/salary|salario|payroll|proventos|remuneracao/, { income: 'Salário' }],
  [/(investment|rendimento|dividend|juros sobre).*(income|return)?|interest income/, { income: 'Investimentos' }],
  [/retirement|aposentadoria|pension|government aid|auxilio|benefit/, { income: 'Outros' }],
  [/refund|reembolso|estorno|cashback/, { income: 'Reembolso', expense: 'Outros' }],
  [/bank slip|boleto/, { expense: 'Contas' }],
  [/bank fee|tarifa|\biof\b|service fee/, { expense: 'Contas' }],
  [/telecom|internet|mobile|phone|electricity|energia|water|agua|\bgas\b|utilities|tax|imposto|legal obligation|insurance|seguro/, { expense: 'Contas' }],
  [/rent|housing|aluguel|condominio|moradia/, { expense: 'Moradia' }],
  [/grocer|supermarket|supermercado|mercado/, { expense: 'Mercado' }],
  [/food|eating|restaurant|delivery|bakery|padaria|alimentacao|bar\b|coffee/, { expense: 'Alimentação' }],
  [/transport|taxi|ride|gas station|fuel|combustivel|parking|estacionamento|toll|pedagio|automotive|car rental|bicycle/, { expense: 'Transporte' }],
  [/health|pharmac|farmacia|dentist|hospital|clinic|lab|wellness|gym|fitness|academia|optometr/, { expense: 'Saúde' }],
  [/education|school|course|university|book|escola|curso/, { expense: 'Educação' }],
  [/streaming|digital service|subscription|assinatura/, { expense: 'Assinaturas' }],
  [/shopping|clothing|electronic|houseware|online|pet|department|compras/, { expense: 'Compras' }],
  [/leisure|entertainment|cinema|theater|concert|gaming|travel|airline|airport|accommodation|ticket|tourism|lazer|viagem/, { expense: 'Lazer' }],
  [/donation|doacao/, { expense: 'Outros' }],
]

// Generic transfer categories only tell us the channel, not the purpose.
const GENERIC_TRANSFER = /^(transfers?|transferencias?)( - (pix|ted|doc|tef))?$/

function categoryFrom(text: string | null, type: TransactionType): CategoryHit & { category?: string } {
  if (!text) return {}
  const t = normalize(text)
  if (GENERIC_TRANSFER.test(t)) return {}
  for (const [re, hit] of CATEGORY_RULES) {
    if (re.test(t)) {
      const category = type === 'income' ? hit.income : hit.expense
      if (category || hit.transfer) return { ...hit, category }
    }
  }
  return {}
}

const RE = {
  billPayment: /pagamento (de )?fatura|pagto fatura|pgto fatura|pagamento cartao|payment received|pagamento recebido/,
  refund: /estorno|reembolso|cashback|refund|devolucao|credito de/,
  pix: /\bpix\b/,
  ted: /\b(ted|doc|tef)\b|transf/,
  boleto: /boleto|pagto cobranca|pagamento de titulo|\bpag tit/,
  debit: /compra (no |com )?(cartao )?(de )?deb|cartao de debito|\bdeb (visa|master|elo)|compra cartao deb|debito visa|debito master/,
  withdrawal: /\bsaque\b|withdraw|\batm\b/,
  deposit: /deposito|deposit/,
  fee: /tarifa|\biof\b|anuidade|cesta de servicos|juros (cheque|limite)|encargos/,
  investment: /aplicacao|resgate|\bcdb\b|tesouro|poupanca|invest/,
  salary: /salario|folha de pag|proventos|remuneracao|\bpagto sal|vencimentos/,
}

function validFor(type: TransactionType, category: string | undefined): category is string {
  if (!category) return false
  const list: readonly string[] = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  return list.includes(category)
}

function methodFrom(tx: PluggyTransaction, text: string): Method | null {
  const pm = normalize(`${tx.paymentMethod ?? ''} ${tx.operationType ?? ''}`)
  if (/\bpix\b/.test(pm) || RE.pix.test(text)) return 'pix'
  if (/boleto/.test(pm) || RE.boleto.test(text)) return 'boleto'
  if (/\b(ted|doc|tef)\b|transferencia/.test(pm)) return 'transferencia'
  if (/tarifa/.test(pm) || RE.fee.test(text)) return 'tarifa'
  if (RE.withdrawal.test(text)) return 'saque'
  if (RE.debit.test(text)) return 'debito'
  if (RE.deposit.test(text)) return 'deposito'
  if (RE.ted.test(text)) return 'transferencia'
  return null
}

const cents = (n: number) => Math.round(Math.abs(n) * 100) / 100

export function classify({ tx, accountType }: ClassifyInput): Classification {
  const text = normalize(`${tx.description} ${tx.descriptionRaw ?? ''}`)
  const bankCat = tx.category ? normalize(tx.category) : ''
  const amount = cents(tx.amount)

  // --- credit card accounts: decide by meaning, not by sign/type, because
  // providers disagree on the sign convention for card transactions.
  if (accountType === 'CREDIT') {
    if (RE.billPayment.test(text) || /credit card payment/.test(bankCat)) {
      return { type: 'income', amount, method: 'credito', category: 'Transferências', categoryStatus: 'suggested', isTransfer: true, rule: 'card-bill-payment' }
    }
    if (RE.refund.test(text) || /refund|estorno|cashback/.test(bankCat)) {
      return { type: 'income', amount, method: 'credito', category: 'Reembolso', categoryStatus: 'suggested', isTransfer: false, rule: 'card-refund' }
    }
    return finish({ tx, text, type: 'expense', amount, method: 'credito', rule: 'card-purchase' })
  }

  // --- bank accounts: the sign of the amount is the direction.
  const type: TransactionType = tx.amount > 0 ? 'income' : tx.amount < 0 ? 'expense' : tx.type === 'CREDIT' ? 'income' : 'expense'
  const method = methodFrom(tx, text) ?? 'outro'

  if (RE.billPayment.test(text) || /credit card payment/.test(bankCat)) {
    return { type, amount, method: method === 'outro' ? 'transferencia' : method, category: 'Transferências', categoryStatus: 'suggested', isTransfer: true, rule: 'bank-card-bill' }
  }
  if (tx.payerDocument && tx.receiverDocument && tx.payerDocument === tx.receiverDocument) {
    return { type, amount, method, category: 'Transferências', categoryStatus: 'suggested', isTransfer: true, rule: 'own-transfer' }
  }
  if (/same (person|ownership)|mesma titularidade/.test(bankCat)) {
    return { type, amount, method, category: 'Transferências', categoryStatus: 'suggested', isTransfer: true, rule: 'own-transfer-category' }
  }
  if (method === 'saque') {
    return { type: 'expense', amount, method, category: 'Transferências', categoryStatus: 'suggested', isTransfer: true, rule: 'withdrawal' }
  }
  if (RE.investment.test(text) && !/rendimento|dividend|juros sobre/.test(text)) {
    return { type, amount, method, category: 'Transferências', categoryStatus: 'suggested', isTransfer: true, rule: 'investment-move' }
  }
  if (type === 'income' && (RE.salary.test(text) || /salary|payroll/.test(bankCat))) {
    return { type, amount, method, category: 'Salário', categoryStatus: 'suggested', isTransfer: false, rule: 'salary' }
  }
  return finish({ tx, text, type, amount, method, rule: 'bank' })
}

function finish(p: {
  tx: PluggyTransaction
  text: string
  type: TransactionType
  amount: number
  method: Method
  rule: string
}): Classification {
  const base = { type: p.type, amount: p.amount, method: p.method, isTransfer: false }

  const fromBank = categoryFrom(p.tx.category, p.type)
  if (fromBank.transfer) {
    return { ...base, category: 'Transferências', categoryStatus: 'suggested', isTransfer: true, rule: `${p.rule}:bank-category-transfer` }
  }
  if (validFor(p.type, fromBank.category)) {
    return { ...base, category: fromBank.category, categoryStatus: 'suggested', rule: `${p.rule}:bank-category` }
  }
  const fromMerchant = categoryFrom(p.tx.merchantCategory, p.type)
  if (validFor(p.type, fromMerchant.category)) {
    return { ...base, category: fromMerchant.category, categoryStatus: 'suggested', rule: `${p.rule}:merchant-category` }
  }
  const keyword = categorize(`${p.tx.merchantName ?? ''} ${p.tx.description}`, p.type)
  if (keyword !== 'Outros' && validFor(p.type, keyword)) {
    return { ...base, category: keyword, categoryStatus: 'suggested', rule: `${p.rule}:keyword` }
  }
  if (p.method === 'tarifa' && p.type === 'expense') {
    return { ...base, category: 'Contas', categoryStatus: 'suggested', rule: `${p.rule}:fee` }
  }
  if (p.method === 'pix' || p.method === 'transferencia') {
    // A transfer to/from someone else: purpose unknown.
    return { ...base, category: 'Transferências', categoryStatus: 'review', rule: `${p.rule}:transfer-default` }
  }
  if (p.method === 'boleto' && p.type === 'expense') {
    return { ...base, category: 'Contas', categoryStatus: 'review', rule: `${p.rule}:boleto-default` }
  }
  return { ...base, category: 'Outros', categoryStatus: 'review', rule: `${p.rule}:fallback` }
}

/** Human label for the payment channel, e.g. "PIX recebido". */
export function channelLabel(method: string, type: TransactionType): string | null {
  const income = type === 'income'
  switch (method) {
    case 'pix': return income ? 'PIX recebido' : 'PIX enviado'
    case 'transferencia': return income ? 'Transferência recebida' : 'Transferência enviada'
    case 'boleto': return 'Boleto'
    case 'debito': return 'Cartão de débito'
    case 'credito': return 'Cartão de crédito'
    case 'saque': return 'Saque'
    case 'deposito': return 'Depósito'
    case 'tarifa': return 'Tarifa bancária'
    default: return null
  }
}
