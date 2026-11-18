# Telegram mínimo para main

Branch `feat/telegram-main`, baseada na main (logo e Next.js 16.4.5 preservados).
Não depende de Pluggy, cron, SDK bancário, alterações de login, gerenciamento de
contas de integracoes ou das migrations 0000–0006 daquela branch.
Não houve execução no Neon, merge na main ou registro de webhook.

## Configuração para ativar futuramente

Variáveis exclusivamente de servidor na Vercel:
- `TELEGRAM_ENABLED=true`: habilitação explícita; sem ela o webhook responde 503
  e a página não consulta/provisiona tabelas Telegram, mesmo com tokens presentes.
- `TELEGRAM_BOT_TOKEN`: fornecido pelo BotFather para @botfinancas_dgbrax_bot.
- `TELEGRAM_WEBHOOK_SECRET`: segredo independente, aleatório, de 32–256 caracteres
  `A-Z a-z 0-9 _ -`, igual ao enviado em setWebhook.
- Manter `DATABASE_URL`, Better Auth e demais variáveis da main. Não existe
  APP_DATABASE_URL nesta implementação; Preview deve usar DATABASE_URL isolada.

Acesso ao fluxo autenticado: `/telegram`. Nenhum menu, design, logo, API ou formulário
existente do dashboard foi modificado. Não existe link novo no dashboard; abrir a URL
explicitamente permite preservar sua interface. Vinculação expira em 10 minutos e é
single-use. O servidor gera uma Carteira apenas para o usuário que abre o onboarding,
sem mudar o signup ou criar contas para todos os usuários existentes.

O bot registra mensagens, consulta /saldo e /ultimas, lista /contas, seleciona /conta ID
ou revoga com /desvincular. O saldo usa exatamente a soma de receitas menos despesas
da main, incluindo os registros históricos com accountId NULL. Não usa snapshots
bancários nem altera/reatribui lançamentos antigos. `method=outro` é um rótulo de
registro; nunca executa PIX, pagamentos ou chamadas bancárias.

## Migração aditiva e publicação (manuais, não executadas em produção)

1. Identificar inequivocamente o Neon de produção e executar `migrations/preflight.sql`
   em modo somente leitura. O schema real ainda não foi confirmado; o DDL pressupõe
   o schema versionado da main. Se tabelas/colunas já existirem ou tipos divergirem,
   interromper e reconciliar o plano, sem IF NOT EXISTS que esconda incompatibilidade.
2. Criar restore point e clone Neon de teste. Ensaiar primeiro nele. Não executar o
   fixture `lib/telegram/fixtures/main-schema.sql` em banco existente: é só para testes.
3. Executar `migrations/001_telegram_main.sql` uma vez: transação com lock_timeout,
   quatro tabelas novas, campos aditivos em transactions. `accountId` permanece
   nullable, source default manual, sem backfill/UPDATE/DELETE de registros financeiros.
4. Executar `migrations/002_telegram_indexes.sql` em autocommit, fora de transação.
   Exemplo com conexão já configurada por PGSERVICE/PG* (sem URL em linha de comando):

   ```sh
   psql --set=ON_ERROR_STOP=on --file=migrations/001_telegram_main.sql
   psql --set=ON_ERROR_STOP=on --file=migrations/002_telegram_indexes.sql
   ```

   A segunda etapa cria o índice concorrente e valida a FK. Se falhar, parar, verificar
   `pg_index.indisvalid` e constraints, revisar/remover somente o índice inválido após
   aprovação e tentar novamente. Não repetir todo o DDL nem apagar tabelas/dados.
5. Revalidar dashboard antigo e Telegram com dois usuários no clone; revisar PR da
   branch mínima. Só depois autorizar merge/deploy/migrations no ambiente correto.
   Manter TELEGRAM_ENABLED ausente/false até o schema e o deployment estarem prontos.
6. Configurar os três valores na Vercel e fazer novo deployment. Runtime Node.js;
   verificar suporte a maxDuration=60. O endpoint HTTPS `/api/telegram/webhook` deve
   receber POST sem bloqueio de Deployment Protection. Não retirar proteção do
   dashboard. Preview automático após push não significa produção nem ativação do bot.
7. Com token e segredo disponíveis somente no ambiente do terminal, executar:

   ```sh
   node scripts/telegram-webhook.mjs set https://SEU-DOMINIO/api/telegram/webhook
   node scripts/telegram-webhook.mjs status
   ```

   Isso é exclusivamente manual. O script verifica getMe antes de registrar, não
   imprime segredos e não roda em build/CI. Cada bot só tem um webhook; não apontar
   o bot real para Preview enquanto houver outro ambiente ativo. Manter Privacy Mode
   e desabilitar entrada em grupos no BotFather como defesa adicional.

Rollback: desativar TELEGRAM_ENABLED, retirar webhook se já ativado e voltar ao
deployment anterior. Manter schema aditivo e registros do bot; não fazer down migration.
O dashboard anterior continua aceitando inserts sem accountId.

## Segurança e testes

IDs numéricos (nunca username), apenas chats privados, validação de segredo antes
do corpo, limite de payload, códigos com 256 bits e hash no banco, verificação de
usuário/conta em toda operação, locks PostgreSQL e marcador/lançamento atômicos.
Outbox permite retry sem duplicar transações; textos são apagados após entrega ou
revogação. Se o envio for recebido pelo Telegram antes de uma queda de conexão,
a resposta pode repetir, mas o registro financeiro não. Não há tokens/valores em logs.

`pnpm test` executa testes puros; a suíte SQL só usa `TELEGRAM_TEST_DATABASE_URL`
explicitamente apontada a localhost e banco descartável `telegram_test`. Nunca usa
DATABASE_URL para decidir o destino de testes. Dentro da suíte, os módulos do dashboard
recebem essa URL local para executar suas ações reais. As fixtures são destruídas
somente nesse banco de teste. O build não chama migration nem API Telegram.
