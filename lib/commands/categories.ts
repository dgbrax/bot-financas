// Keyword -> category maps used by the message parser (lib/commands/parse.ts).
// Edit freely. Keys are matched as whole words, case- and accent-insensitive.
// Values must be categories from lib/finance.ts for the matching type.
// Multi-word keys (e.g. 'conta de luz') are matched as a phrase.

import type { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/finance'

type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
type IncomeCategory = (typeof INCOME_CATEGORIES)[number]

export const DEFAULT_CATEGORY = 'Outros' as const

export const EXPENSE_KEYWORDS: Record<string, ExpenseCategory> = {
  lanche: 'Alimentação',
  almoco: 'Alimentação',
  jantar: 'Alimentação',
  cafe: 'Alimentação',
  restaurante: 'Alimentação',
  ifood: 'Alimentação',
  pizza: 'Alimentação',
  mercado: 'Mercado',
  supermercado: 'Mercado',
  feira: 'Mercado',
  padaria: 'Mercado',
  uber: 'Transporte',
  '99': 'Transporte',
  onibus: 'Transporte',
  metro: 'Transporte',
  gasolina: 'Transporte',
  combustivel: 'Transporte',
  estacionamento: 'Transporte',
  aluguel: 'Moradia',
  condominio: 'Moradia',
  luz: 'Contas',
  agua: 'Contas',
  internet: 'Contas',
  celular: 'Contas',
  gas: 'Contas',
  farmacia: 'Saúde',
  remedio: 'Saúde',
  medico: 'Saúde',
  consulta: 'Saúde',
  academia: 'Saúde',
  cinema: 'Lazer',
  bar: 'Lazer',
  show: 'Lazer',
  viagem: 'Lazer',
  roupa: 'Compras',
  roupas: 'Compras',
  presente: 'Compras',
  curso: 'Educação',
  livro: 'Educação',
  faculdade: 'Educação',
  escola: 'Educação',
  netflix: 'Assinaturas',
  spotify: 'Assinaturas',
  assinatura: 'Assinaturas',
}

export const INCOME_KEYWORDS: Record<string, IncomeCategory> = {
  trabalho: 'Salário',
  salario: 'Salário',
  pagamento: 'Salário',
  freela: 'Freelance',
  freelance: 'Freelance',
  bico: 'Freelance',
  projeto: 'Freelance',
  dividendos: 'Investimentos',
  rendimento: 'Investimentos',
  juros: 'Investimentos',
  reembolso: 'Reembolso',
  estorno: 'Reembolso',
  presente: 'Presente',
}
