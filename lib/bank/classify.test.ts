import { describe, expect, it } from 'vitest'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/finance'
import type { PluggyTransaction } from '@/lib/pluggy/types'
import { channelLabel, classify } from './classify'

function tx(p: Partial<PluggyTransaction>): PluggyTransaction {
  return {
    id: 't', accountId: 'a', description: 'X', descriptionRaw: null, amount: -10, currencyCode: 'BRL',
    date: '2026-10-01', type: p.amount !== undefined && p.amount > 0 ? 'CREDIT' : 'DEBIT', status: 'POSTED',
    category: null, operationType: null, paymentMethod: null, merchantName: null, merchantCategory: null,
    payerDocument: null, receiverDocument: null, hasCreditCardMetadata: false, installment: null, updatedAt: null,
    ...p,
  }
}
const bank = (p: Partial<PluggyTransaction>) => classify({ tx: tx(p), accountType: 'BANK' })
const card = (p: Partial<PluggyTransaction>) => classify({ tx: tx(p), accountType: 'CREDIT' })

describe('classify: real Pluggy Sandbox transactions (checking account)', () => {
  it.each([
    ['SALARIO EMPRESA XYZ LTDA', 8500, 'Salary', { type: 'income', category: 'Salário', categoryStatus: 'suggested', isTransfer: false }],
    ['CONDOMINIO EDIFICIO SOLAR', -800, 'Housing', { type: 'expense', category: 'Moradia', categoryStatus: 'suggested' }],
    ['ELETROBRAS LIGHT SA', -185, 'Electricity', { type: 'expense', category: 'Contas' }],
    ['VIVO SERVICOS E COMERCIO', -120, 'Telecommunications', { type: 'expense', category: 'Contas' }],
    ['PAGAMENTO FATURA CARTAO VISA', -167.7, 'Credit card payment', { type: 'expense', isTransfer: true, category: 'Transferências' }],
    ['Pagamento de boleto', -100, 'Transfer - Bank Slip', { type: 'expense', method: 'boleto', category: 'Contas' }],
  ] as const)('%s', (description, amount, category, expected) => {
    expect(bank({ description, amount, category })).toMatchObject({ amount: Math.abs(amount), ...expected })
  })

  it('generic "Transfers" category is not trusted as a purpose', () => {
    expect(bank({ description: 'Intereses Compensatorios', amount: 1, category: 'Transfers' })).toMatchObject({
      type: 'income', category: 'Outros', categoryStatus: 'review',
    })
  })

  it('unknown text with no category goes to review', () => {
    expect(bank({ description: 'lab', amount: 1.23 })).toMatchObject({ category: 'Outros', categoryStatus: 'review' })
  })
})

describe('classify: real Pluggy Sandbox transactions (credit card)', () => {
  // Sandbox sends card purchases as type CREDIT with a negative amount, while the
  // docs say purchases are DEBIT; classification must not depend on either.
  it.each([
    ['NETFLIX.COM', -55.9, 'CREDIT', 'Video streaming', 'Assinaturas'],
    ['SPOTIFY AB', -21.9, 'CREDIT', 'Music streaming', 'Assinaturas'],
    ['SMART FIT ACADEMIA', -89.9, 'CREDIT', 'Gyms and fitness centers', 'Saúde'],
    ['NETFLIX.COM', 55.9, 'DEBIT', 'Video streaming', 'Assinaturas'],
  ] as const)('%s (%d, %s) is a card purchase', (description, amount, type, category, expected) => {
    expect(card({ description, amount, type, category })).toMatchObject({
      type: 'expense', method: 'credito', category: expected, categoryStatus: 'suggested', isTransfer: false, amount: Math.abs(amount),
    })
  })

  it('card bill payment is a transfer, not income', () => {
    expect(card({ description: 'PAGAMENTO RECEBIDO', amount: 500 })).toMatchObject({ type: 'income', isTransfer: true, rule: 'card-bill-payment' })
  })

  it('card refund is income (Reembolso)', () => {
    expect(card({ description: 'ESTORNO COMPRA LOJA X', amount: 80 })).toMatchObject({ type: 'income', category: 'Reembolso', isTransfer: false })
  })
})

describe('classify: payment channels', () => {
  it.each([
    ['PIX RECEBIDO JOAO SILVA', 150, {}, 'pix', 'income', 'PIX recebido'],
    ['PIX ENVIADO MARIA', -80, {}, 'pix', 'expense', 'PIX enviado'],
    ['Transferencia', -80, { paymentMethod: 'PIX' }, 'pix', 'expense', 'PIX enviado'],
    ['TED RECEBIDA', 1000, {}, 'transferencia', 'income', 'Transferência recebida'],
    ['TRANSF ENVIADA CONTA', -300, {}, 'transferencia', 'expense', 'Transferência enviada'],
    ['Pagamento', -99, { paymentMethod: 'BOLETO' }, 'boleto', 'expense', 'Boleto'],
    ['COMPRA CARTAO DEB PADARIA BOM PAO', -12.5, {}, 'debito', 'expense', 'Cartão de débito'],
    ['SAQUE 24H BANCO24HORAS', -200, {}, 'saque', 'expense', 'Saque'],
    ['DEPOSITO EM DINHEIRO', 300, {}, 'deposito', 'income', 'Depósito'],
    ['TARIFA PACOTE SERVICOS', -29.9, {}, 'tarifa', 'expense', 'Tarifa bancária'],
    ['IOF', -1.2, {}, 'tarifa', 'expense', 'Tarifa bancária'],
  ] as const)('%s -> %s', (description, amount, extra, method, type, label) => {
    const c = bank({ description, amount, ...extra })
    expect(c).toMatchObject({ method, type })
    expect(channelLabel(c.method, c.type)).toBe(label)
  })

  it('operationType from Open Finance is used', () => {
    expect(bank({ description: 'X', amount: -5, operationType: 'PIX' }).method).toBe('pix')
  })
})

describe('classify: transfers between own money', () => {
  it('same payer and receiver document is an own transfer', () => {
    expect(bank({ description: 'PIX ENVIADO', amount: -500, payerDocument: '123', receiverDocument: '123' })).toMatchObject({ isTransfer: true, rule: 'own-transfer' })
  })
  it('different documents is a normal PIX', () => {
    expect(bank({ description: 'PIX ENVIADO', amount: -500, payerDocument: '123', receiverDocument: '999' })).toMatchObject({ isTransfer: false })
  })
  it('withdrawals and investment moves are transfers', () => {
    expect(bank({ description: 'SAQUE', amount: -100 }).isTransfer).toBe(true)
    expect(bank({ description: 'APLICACAO CDB', amount: -1000 }).isTransfer).toBe(true)
    expect(bank({ description: 'RESGATE POUPANCA', amount: 1000 }).isTransfer).toBe(true)
  })
  it('investment income is income, not a transfer', () => {
    expect(bank({ description: 'RENDIMENTO POUPANCA', amount: 12.34, category: 'Investment income' })).toMatchObject({ type: 'income', isTransfer: false, category: 'Investimentos' })
  })
})

describe('classify: categories and review status', () => {
  it('uses the merchant category when the bank category is missing', () => {
    expect(bank({ description: 'COMPRA 123', amount: -40, merchantCategory: 'Supermarkets' })).toMatchObject({ category: 'Mercado', categoryStatus: 'suggested' })
  })
  it('falls back to the text-command keyword map', () => {
    expect(bank({ description: 'COMPRA CARTAO DEB UBER TRIP', amount: -23 })).toMatchObject({ category: 'Transporte', categoryStatus: 'suggested', rule: 'bank:keyword' })
  })
  it('PIX to a third party with no other hint needs review', () => {
    expect(bank({ description: 'PIX ENVIADO FULANO', amount: -50 })).toMatchObject({ category: 'Transferências', categoryStatus: 'review' })
  })
  it('never returns confirmed and always returns a valid category for the type', () => {
    const samples = [
      bank({ description: 'X', amount: 5 }), bank({ description: 'X', amount: -5 }),
      bank({ description: 'Y', amount: 9, category: 'Groceries' }), // expense category on income
      card({ description: 'Z', amount: -3, category: 'Salary' }), // income category on expense
    ]
    for (const c of samples) {
      expect(c.categoryStatus).not.toBe('confirmed')
      const list: readonly string[] = c.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
      expect(list).toContain(c.category)
      expect(c.amount).toBeGreaterThanOrEqual(0)
    }
  })
})
