# Telegram v1 — @botfinancas_dgbrax_bot

Implementado em `feat/telegram`, baseada no código existente de `integracoes`.
Essa branch também preserva os dois commits já publicados de correção de segurança
Next.js 16.4.5 e da logo aprovada. Não publicar a branch inteira na main sem revisar
as outras funcionalidades e migrações herdadas de integracoes.

## Funcionamento

Abra `/telegram` autenticado (atalho em `/conexoes`), escolha uma conta sua e gere
um link. O link tem 256 bits aleatórios, expira em 10 minutos, é consumido uma única
vez e somente o hash é persistido. Gerar outro invalida o anterior. Trate o link
como um segredo: quem o possuir pode vincular o Telegram à sua conta. Não o compartilhe.
O servidor usa a sessão Better Auth, nunca um userId enviado pelo formulário.
O vínculo é de um usuário do dashboard para um ID numérico do Telegram. Username
não é identidade. Não substitui um vínculo existente; revogue antes de trocar.
Após abrir o link, clique em Iniciar no bot; atualize `/telegram` para ver o status.

Somente conversas privadas com sender ID igual ao chat ID são aceitas. Grupos,
canais, bots, mensagens editadas, business messages, tópicos e mensagens sem texto
são ignorados sem consultas financeiras nem respostas. Antes da vinculação,
nenhuma operação financeira é permitida.

Comandos:
- `Gastei 35 reais no almoço`, `Recebi 150 reais`, `-12,50 lanche`, `+100 freelance`.
- Datas opcionais conforme o parser existente: `ontem`, `03/11`, `03/11/2026`.
- `/saldo`: saldos registrados de todas as suas contas, com a mesma regra do
  dashboard para snapshots, importações bancárias e duplicatas.
- `/ultimas`: últimas cinco transações suas; `/contas`: suas contas e IDs.
- `/conta ID`: seleciona uma conta sua para novos registros.
- `/ajuda` ou `/help`; `/desvincular`: revoga acesso. Também é possível revogar
  pelo dashboard, inclusive códigos e respostas financeiras ainda pendentes.

Os registros usam as contas, tabela de transações, parser, categorias, datas e
aritmética em centavos existentes. `source=telegram`, `method=outro`. Não inferimos
PIX nem executamos pagamentos, transferências, Pluggy ou chamadas bancárias.
Não há IA externa, interpretação livre ou alteração automática de valores existentes.

## Garantias e limites

O webhook valida `X-Telegram-Bot-Api-Secret-Token` antes de ler o corpo e limita-o
por streaming a 32 KiB. Rotas e ações não registram corpos, valores, tokens ou
exceções nativas em logs. O token do bot só é acessado em módulos de servidor.
Respostas são texto simples, com conteúdo protegido e previews de links desativados.

Marcador de update, vínculo e lançamento usam uma única transação PostgreSQL.
Locks transacionais serializam mensagens de cada identidade e as operações de
vínculo/revogação do usuário. Há unicidade por update ID, chat/message ID e origem
externa da transação. Falha financeira reverte também o marcador, permitindo retry.

Uma outbox durável permite repetir a entrega da resposta sem repetir o lançamento.
Antes de enviar uma resposta pendente, o vínculo e a propriedade da conta são
revalidados sob locks. Após entrega/revogação, o texto é apagado; ficam os IDs para
deduplicação. Se Telegram receber a resposta mas a conexão cair antes da confirmação,
a resposta pode ser repetida; o lançamento não é duplicado. Não existe garantia de
exactly-once para envio remoto via sendMessage. Entregas que falharem por toda a
janela de retries do Telegram exigem inspeção/retry operacional; não há worker separado.
Não remova marcadores durante o período em que quiser impedir replays antigos.

Os links são bearer tokens; guarde-os apenas até uso/expiração. Use um segredo
independente do token do bot. Se o token vazar, rotacione no BotFather, configure o
novo token na Vercel e gere outro segredo de webhook. Não use URLs com tokens em
comandos curl, logs ou ferramentas de analytics. A funcionalidade depende das
variáveis e do schema; autenticação/banco/Telegram ao vivo não são testados no build.

## Ativação manual na Vercel (não executada pelo agente)

1. Revisar a branch. Preparar banco Neon de TESTE/Preview que já possua o schema
   de `integracoes` (migrações 0000–0005). A migration `0006_telegram.sql` só cria
   três tabelas, índices e FKs; não altera/remove dados financeiros existentes.
   Aplicá-la primeiro nesse banco e validar os fluxos. Não executar `db:push` nem
   migrações contra produção sem revisão. Snapshot/journal são de geração Drizzle.
2. Configurar no ambiente desejado da Vercel, como variáveis de servidor:
   `TELEGRAM_BOT_TOKEN` (BotFather) e `TELEGRAM_WEBHOOK_SECRET` (32–256 caracteres
   aleatórios URL-safe). Manter Better Auth (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`)
   e a URL Neon correta (`APP_DATABASE_URL` prevalece sobre `DATABASE_URL`). Nunca
   prefixar segredos com `NEXT_PUBLIC_`. Não usar o banco de produção em Preview.
3. Só depois configurar/revisar migrations no ambiente de destino e autorizar o
   deploy. Esta implementação não fez push, merge, deploy nem setWebhook.
   O endpoint é `https://SEU-DOMINIO/api/telegram/webhook`; precisa aceitar o POST
   do Telegram sem Vercel Deployment Protection. Não desative a proteção de outras
   áreas do aplicativo. Não inclua segredo em query string.
4. Com os segredos disponíveis apenas no ambiente do terminal, executar manualmente:

   ```sh
   node scripts/telegram-webhook.mjs set https://SEU-DOMINIO/api/telegram/webhook
   node scripts/telegram-webhook.mjs status
   ```

   O script verifica a identidade do bot por `getMe`, configura `secret_token`,
   `allowed_updates=["message"]`, mantém mensagens pendentes e mostra apenas status
   sanitizado. Nunca chama setWebhook automaticamente no build. Cada bot tem um
   único webhook: apontar para Preview substitui produção. Use outro bot para testes
   paralelos (o código/scripts desta versão estão fixados no bot solicitado).
5. No BotFather, desabilitar entrada em grupos (`/setjoingroups`) e manter Privacy
   Mode ativo como defesa adicional. Mesmo sem isso, o endpoint ignora grupos.
6. Testar com dois usuários reais: cada um gera seu link em `/telegram`; verificar
   lançamentos/contas/saldo isolados, link expirado/reutilizado e revogação. Consultar
   `status` para pendências/erro e a Vercel sem imprimir bodies ou segredos.

Referências oficiais: [webhook](https://core.telegram.org/bots/api#setwebhook),
[deep links](https://core.telegram.org/bots/features#deep-linking).

## Testes locais sem produção

`pnpm test` executa testes unitários existentes e do Telegram. A suíte SQL é opcional:
requer exclusivamente `TELEGRAM_TEST_DATABASE_URL`, host localhost, banco chamado
`telegram_test`, vazio e descartável. Aplica 0000–0006 e limpa fixtures desse banco;
nunca usa `DATABASE_URL`/`APP_DATABASE_URL` e não chama Telegram ou Pluggy reais.

```sh
TELEGRAM_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:PORTA/telegram_test \
  node node_modules/vitest/vitest.mjs run lib/telegram/store.integration.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

O teste SQL cobre isolamento real, uso único concorrente, contas alheias, snapshots,
duplicação concorrente, rollback/retry, outbox e revogação. O build usa configuração
local temporária; avisos de schema Better Auth sem banco disponível não validam
uma conexão Neon de produção. Não inclua segredos reais no repositório.
