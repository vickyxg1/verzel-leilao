# Casa de Leilões — Verzel Elite Dev 2026

Desenvolvi esta casa de leilões online para o desafio Verzel Elite Dev 2026. O leiloeiro busca obras de arte numa API pública, monta lotes com elas e acompanha o resultado. Os licitantes dão lances em tempo real usando o saldo de uma carteira. Todo lance fica registrado num histórico auditável, que detecta adulteração mesmo quando alguém mexe direto no banco.

- **Aplicação:** https://verzel-leilao.vercel.app
- **Repositório:** https://github.com/vickyxg1/verzel-leilao

## Contas de demonstração

São contas fictícias, criadas pelo seed, e todas usam a senha `demo12345`.

| Papel | E-mail |
|---|---|
| Leiloeiro | `leiloeiro@demo.local` |
| Licitante | `ana@demo.local` |
| Licitante | `bruno@demo.local` |

Cada licitante começa com R$ 5.000,00 na carteira. Para ver o tempo real funcionando, abro Ana numa janela normal e Bruno numa janela anônima e dou lances alternados no mesmo lote.

## O que a aplicação faz

**Leiloeiro**
- Busca obras na API do [Art Institute of Chicago](https://api.artic.edu/docs/), vê a prévia (imagem e atributos) e cria o lote com lance inicial, incremento mínimo, início e fim.
- Cancela um lote enquanto ele não tiver lances. Se já houver um lance reservado, o valor volta para o licitante.
- Acompanha no painel os lotes encerrados, o vencedor e o total recebido.
- Não pode dar lance.

**Licitante**
- Navega pela vitrine com busca, deposita saldo simulado na carteira e dá lances.
- Acompanha o lance atual e a contagem regressiva sem precisar recarregar a página.
- Vê os lotes que arrematou e o comprovante de cada um, que tem um link público para compartilhar.

**Qualquer visitante**
- Abre a auditoria de um lote e confere se o histórico de lances está íntegro.

## Regras de negócio

- O primeiro lance precisa ser maior ou igual ao lance inicial. Cada lance seguinte precisa ser maior ou igual ao lance atual mais o incremento.
- O licitante só dá lance se tiver saldo disponível. Ao assumir a liderança, o valor fica reservado na carteira dele. Quando outra pessoa cobre o lance, a reserva é liberada.
- Quem está na liderança não pode cobrir o próprio lance.
- **Anti-sniping:** um lance aceito nos últimos 2 minutos estende o fim do lote em 2 minutos (fim atual + 2 min). O edital diz "para +2 minutos", o que deixa dúvida entre somar 2 minutos ao fim atual e fixar o fim em agora + 2 minutos. Escolhi somar ao fim atual.
- No encerramento, o valor vencedor sai da carteira do licitante e entra na do leiloeiro, e o sistema gera um comprovante. Lote sem lances encerra sem vencedor.
- O encerramento acontece mesmo sem nenhum navegador aberto (detalhes em [Decisões de arquitetura](#decisões-de-arquitetura)).
- Nas páginas públicas, o licitante aparece por um pseudônimo. E-mail e saldo de terceiros nunca são exibidos.

## Stack e por quê

| Camada | Tecnologia | Por quê |
|---|---|---|
| Front-end | React 19 + TypeScript + Vite, React Router | É a stack sugerida pelo edital. O Vite deixa o desenvolvimento rápido e gera um build estático simples de hospedar. |
| API | Node.js 24 + TypeScript + Express 5 | O Express é direto e fácil de explicar. O Node 24 roda TypeScript nativamente, então a API não tem etapa de build própria. |
| Banco | PostgreSQL com `pg` e SQL puro | As regras de lance dependem de transações e locks. Com SQL escrito à mão, a concorrência fica explícita no código, sem um ORM no meio. Os valores são guardados em centavos inteiros, nunca em float. |
| Validação | Zod | Valida o corpo das requisições na fronteira da API. |
| Autenticação | JWT em cookie `httpOnly`, bcrypt, `express-rate-limit` | O token fica fora do alcance do JavaScript da página, as senhas têm hash forte e o login e o cadastro têm limite de tentativas. |
| Tempo real | Supabase Realtime (Broadcast) | A API roda como função serverless, que não mantém WebSocket aberto. O Supabase cuida da conexão com o navegador. |
| Hospedagem | Vercel (front + API) e Supabase (banco, Realtime, `pg_cron`) | Planos gratuitos que cobrem tudo o que o projeto precisa. |
| Âncora da auditoria | Neon (PostgreSQL) | Um banco separado, em outro provedor, só para os registros de integridade. |
| Testes e CI | Vitest + Supertest, GitHub Actions | Os testes rodam contra um PostgreSQL de verdade, inclusive os de concorrência. O CI roda testes, typecheck e build a cada push. |

## Estrutura de pastas

```
.
├── server/                 API (Express)
│   ├── src/
│   │   ├── app.ts          rotas e middlewares
│   │   ├── index.ts        servidor local (migrations + encerramento periódico)
│   │   ├── vercel.ts       entrada da função serverless
│   │   ├── auth.ts         cadastro, login, papéis
│   │   ├── items.ts        cliente da API do Art Institute of Chicago
│   │   ├── lots.ts         criação, listagem, cancelamento e encerramento de lotes
│   │   ├── bids.ts         lance transacional, reserva e anti-sniping
│   │   ├── wallet.ts       carteira (razão de lançamentos)
│   │   ├── receipts.ts     comprovantes
│   │   ├── audit.ts        cadeia de hashes e verificação
│   │   ├── anchor.ts       gravação na âncora independente
│   │   ├── realtime.ts     publicação no Supabase Realtime
│   │   ├── migrate.ts      executor de migrations
│   │   └── seed.ts         dados de demonstração (idempotente)
│   ├── migrations/         SQL versionado (001, 002, 003)
│   ├── seed/               imagem embutida do lote de demonstração
│   ├── scripts/            Postgres local, usuário restrito da âncora, build da Vercel
│   └── test/               testes de integração
├── web/                    front-end (React + Vite)
│   └── src/
│       ├── pages/          vitrine, lote, painel do leiloeiro, carteira, arremates, comprovante, auditoria, login
│       ├── components/     card de lote, contagem regressiva
│       ├── api.ts          chamadas à API
│       ├── auth.tsx        sessão do usuário
│       └── realtime.ts     assinatura dos eventos de tempo real
├── docker/                 script que cria os bancos extras no Postgres do Docker
├── docker-compose.yml      Postgres de desenvolvimento
├── vercel.json             configuração do deploy
└── .github/workflows/      CI
```

## Decisões de arquitetura

### Monólito modular
Front e API ficam no mesmo repositório (workspace pnpm) e são publicados juntos na Vercel, no mesmo domínio. Com isso, o cookie de sessão funciona sem configurar CORS. Para o tamanho do projeto, separar em serviços só traria trabalho a mais.

### Lance com transação e lock
Cada lance roda numa única transação:
1. Travo o lote (`SELECT ... FOR UPDATE`).
2. Leio o horário do servidor **depois** do lock. Assim, quem ficou esperando na fila é julgado pelo horário real em que foi processado.
3. Valido a janela de tempo, o valor mínimo, a liderança e o saldo do novo líder.
4. Reservo o valor do novo líder, libero a reserva do anterior, gravo o lance e aplico o anti-sniping.

Se qualquer etapa falhar, a transação inteira é desfeita e nada fica pela metade. Em caso de deadlock ou conflito, a API devolve 409 com a mensagem "Muitas operações simultâneas. Tente novamente." Quando dois lances chegam ao mesmo tempo, o segundo enxerga o resultado do primeiro.

### Encerramento sem servidor ligado
Na Vercel não existe processo rodando o tempo todo para fechar os lotes. Por isso a liquidação foi escrita como função do próprio banco (`settle_due_lots`, em PL/pgSQL), agendada pelo `pg_cron` do Supabase a cada 30 segundos. Como reforço, a API também liquida um lote vencido quando ele é consultado, e o servidor local roda a mesma rotina a cada 5 segundos.

Repetir a liquidação não duplica pagamentos. Isso é garantido pelo lock do lote, pela marca `settled_at`, por `UNIQUE(lot_id)` no comprovante e por chaves de idempotência nos lançamentos da carteira.

### Tempo real
Depois do commit de um lance, a API publica no Supabase Realtime um aviso do tipo "o lote X mudou", sem nenhum dado junto. Ao receber o aviso, o navegador busca o estado atualizado na API. A API continua sendo a única fonte da verdade: se um aviso se perder ou chegar fora de ordem, a tela não fica errada. O navegador também ressincroniza ao reconectar e ao voltar para a aba. Sem o Supabase configurado, o front consulta a API a cada 3 segundos.

A contagem regressiva usa o horário do servidor (`server_now`) para corrigir o relógio do computador do usuário.

### Auditoria à prova de adulteração
- Cada lance guarda um hash calculado a partir dos dados públicos do lance (lote, sequência, pseudônimo, valor, horário) e do hash do lance anterior. Isso forma uma cadeia, e qualquer visitante consegue recalculá-la sem acessar dados pessoais.
- Só a cadeia não basta: quem tem acesso ao banco pode reescrever os lances **e** recalcular todos os hashes. Por isso, logo após o commit, a API grava o hash de cada lance numa **âncora** em outro banco, em outro provedor (Neon). A tabela da âncora só aceita inserção (um trigger bloqueia UPDATE e DELETE), e em produção a API se conecta a ela com um usuário que só tem permissão de `INSERT` e `SELECT`.
- A verificação compara a cadeia com a âncora e detecta lance alterado (UPDATE), removido (DELETE) e inserido depois (INSERT retroativo). Os três casos têm teste automatizado.
- **Limite:** quem controlar ao mesmo tempo o banco principal, a âncora e o servidor consegue forjar o histórico. O mecanismo protege contra adulteração em um dos componentes, não contra um administrador que controle todos.

### API externa e resiliência
Ao criar um lote, salvo no banco uma cópia (snapshot) da obra, com título, atributos e os bytes da imagem. Depois disso, o lote não depende mais da API do Art Institute of Chicago. Se a API externa estiver fora do ar, lenta ou devolver limite de requisições (429), só a busca de novas obras é afetada, e o painel mostra uma mensagem de erro. Os lotes existentes continuam funcionando normalmente. O lote do seed usa uma imagem guardada no repositório, então a demonstração também não depende da API externa.

### Deploy na Vercel
O `vercel.json` chama `server/scripts/vercel-build.ts`, que gera a saída no formato Build Output API da Vercel: o build estático do Vite e uma função `api` com o Express empacotado pelo esbuild. Na importação do projeto na Vercel, o Framework Preset deve ser **Other**.

## Como rodar localmente

**Pré-requisitos:** Node.js 24 ou superior e pnpm 10.

1. Clone o repositório e instale as dependências:
   ```bash
   git clone https://github.com/vickyxg1/verzel-leilao.git
   cd verzel-leilao
   pnpm install
   ```
2. Crie o `.env` a partir do exemplo:
   ```bash
   cp .env.example .env
   ```
   Os valores padrão já funcionam com o banco local. Só troque o `JWT_SECRET` por um valor aleatório:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   As variáveis do Supabase são opcionais. Sem elas, o tempo real funciona por consulta periódica.
3. Suba o PostgreSQL, deixando este terminal aberto:
   ```bash
   pnpm db:local
   ```
   Esse comando roda um PostgreSQL de verdade direto no sistema, sem Docker (pacote `embedded-postgres`), e cria os bancos `leilao`, `leilao_test`, `anchor` e `anchor_test` na porta 5433. Os dados ficam em `server/.pgdata`. Quem tiver Docker funcionando pode usar `pnpm db:up` no lugar (veja a [observação sobre o Docker](#observação-sobre-o-docker)).
4. Rode as migrations e o seed, em outro terminal:
   ```bash
   pnpm seed
   ```
   O seed aplica as migrations, cria as três contas de demonstração, deposita o saldo inicial e cria um lote ao vivo. Pode ser rodado de novo sem duplicar dados.
5. Inicie a API e o front, cada um no seu terminal:
   ```bash
   pnpm dev:server   # API em http://localhost:3000
   pnpm dev:web      # front em http://localhost:5173
   ```
6. Acesse http://localhost:5173 e entre com uma das [contas de demonstração](#contas-de-demonstração).

### Testes

Com o banco local rodando:
```bash
pnpm test        # testes de integração (usam o banco leilao_test)
pnpm typecheck   # checagem de tipos da API e do front
```

Os testes cobrem autenticação e papéis, criação e cancelamento de lotes (inclusive com a API externa falhando), regras de lance, lances concorrentes, anti-sniping, liquidação idempotente, a auditoria contra UPDATE, DELETE e INSERT retroativo, o tempo real e o seed.

## Observação sobre o Docker

O Docker ficou só parcialmente implementado. O `docker-compose.yml` sobe apenas o PostgreSQL de desenvolvimento, e o `docker/init-db.sql` cria os bancos extras. Não fiz Dockerfile para a API nem para o front, então a aplicação completa não roda em containers.

O motivo foi um problema na minha máquina: o Docker Desktop não iniciava porque o WSL estava sem nenhuma distribuição instalada (`WSL_E_DEFAULT_DISTRO_NOT_FOUND`). Por isso, não consegui executar nem validar o compose localmente. Para não travar o desenvolvimento, passei a usar o `embedded-postgres` (`pnpm db:local`), que roda o PostgreSQL direto no Windows com a mesma porta e as mesmas credenciais do compose.

A mesma configuração de banco (imagem `postgres:16-alpine` e `docker/init-db.sql`) roda no CI do GitHub Actions, onde os testes passam. Com o Docker funcionando, o próximo passo seria criar os Dockerfiles da API e do front e colocar tudo no mesmo compose.
