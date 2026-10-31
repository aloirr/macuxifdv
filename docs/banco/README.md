# Banco de dados — como subir, testar e derrubar

Dono: `banco-dados`. Pacote `@macuxi/db` em `db/`. Postgres 16 + pgvector via Docker Desktop
(imagem `pgvector/pgvector:pg16`, a mesma do CI — T-0005).

> **Situação em 2026-10-31:** Docker Desktop instalado (motor 29.9.2). Migrações up/down/up, seed
> Fase M, fixture dois-tenants e a suíte inteira de `db/testes/` rodam no container `macuxi-postgres`
> (74 testes, 0 pulados). Medição do sync em [desempenho-sync.md](desempenho-sync.md).

## Windows: subir, derrubar e recriar o banco de teste (5 passos)
1. **Abra o Docker Desktop** e espere "Engine running". No Git Bash, se `docker` não for encontrado:
   `export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"` (no PowerShell:
   `$env:Path += ";C:\Program Files\Docker\Docker\resources\bin"`). O CLI e os testes acham esse
   caminho sozinhos; o PATH só importa para usar `docker` à mão.
2. **Subir** (baixa `pgvector/pgvector:pg16` na 1ª vez, cria o banco `macuxi` e migra):
   `pnpm --filter @macuxi/db banco subir` → `[banco] pronto: localhost:5432/macuxi`.
3. **Carregar dados**: `pnpm --filter @macuxi/db banco seed fase-m` e/ou
   `pnpm --filter @macuxi/db banco fixture dois-tenants` (idempotentes; `banco status` confere).
4. **Testar**: `pnpm --filter @macuxi/db test` (ou `pnpm test` na raiz). Cada execução cria e apaga um
   banco efêmero `macuxi_teste_*`; se o container estiver parado e o Docker aberto, o teste o sobe sozinho.
5. **Derrubar ou recriar**: `banco derrubar` (para o container, mantém o volume),
   `banco derrubar --limpar` (apaga também o volume) ou `banco recriar` (apaga volume e sobe do zero,
   migrado e vazio). Bancos de teste esquecidos por execução interrompida: `banco apagar-teste --todos`.

Porta ocupada (outro Postgres em 5432)? Defina `MACUXI_PG_PORTA=5433` no `.env` da raiz: o compose e
o CLI usam a mesma variável.

## Pré-requisitos
- Docker Desktop instalado e aberto (`docker version` responde).
- Node >= 24.7 para os seeds/fixtures (usam `crypto.argon2Sync` nativo para o hash argon2id).
- `db` registrado no `pnpm-workspace.yaml` e `pnpm install` rodado (traz `pg`, `drizzle-orm`, `drizzle-kit`).
- Opcional: copiar `db/.env.example` para `db/.env` (ou para a `.env` da raiz). Sem `.env`, valem os
  padrões locais (porta 5432 só em `127.0.0.1`, admin `postgres`/`postgres`, banco `macuxi`, papel `macuxi_app`).

## Banco que não é o local (homologação, nuvem)
Os padrões acima são **públicos** e valem só para o Postgres local: host `localhost`, `127.0.0.1`, `::1` ou
`macuxi-postgres` (lista `HOSTS_LOCAIS` em `db/src/config.ts`, a mesma do `global-setup`) **e** `NODE_ENV`
diferente de `production`. Fora disso:
- `lerConfig` **falha** se faltar `MACUXI_PG_ADMIN_SENHA` ou `MACUXI_PG_APP_SENHA` (ou se vierem com a senha
  pública local), com a mensagem `[db] Banco fora do ambiente local (...): defina ... no .env`. Assim
  `banco papeis`/`migrar`/`criar-teste` nunca gravam a senha pública no papel `macuxi_app`;
  `garantirPapelApp` ainda recusa a senha pública se o cliente não estiver num host local (segunda trava).
- `banco seed fase-m` (`carregarFaseM`: senha `demo-macuxi` e usuários fictícios) **recusa** rodar.
- Segredos só no `.env` (CLAUDE.md regra 8). Testes: `db/testes/ambiente-local.test.ts`.

## Logs do Postgres
O compose local liga `log_min_duration_statement=300` (consultas lentas para EXPLAIN), que registra também os
parâmetros da consulta (aqui só dados fictícios). Em nuvem, para não levar dado pessoal ao log (regra 8), use
`log_parameter_max_length=0` e `log_parameter_max_length_on_error=0`.

## Comandos (rodar na raiz)
| O quê | Comando |
|---|---|
| Subir o Postgres, criar o banco `macuxi` e migrar | `pnpm --filter @macuxi/db banco subir` |
| Estado (conexão, migrações, bancos de teste esquecidos) | `pnpm --filter @macuxi/db banco status` |
| Aplicar migrações pendentes | `pnpm --filter @macuxi/db banco migrar up [--ate 0001]` |
| Desfazer a última / N / todas | `pnpm --filter @macuxi/db banco migrar down [--passos N \| --tudo]` |
| Carregar o seed da Fase M | `pnpm --filter @macuxi/db banco seed fase-m` |
| Carregar a fixture dois-tenants | `pnpm --filter @macuxi/db banco fixture dois-tenants` |
| Criar banco de teste efêmero (migrado) | `pnpm --filter @macuxi/db banco criar-teste [--fixture dois-tenants\|fase-m]` |
| Apagar banco(s) de teste | `pnpm --filter @macuxi/db banco apagar-teste <nome> \| --todos` |
| (Re)criar o papel de aplicação | `pnpm --filter @macuxi/db banco papeis` |
| Recriar do zero (apaga volume, sobe e migra) | `pnpm --filter @macuxi/db banco recriar` |
| Medir o sync com volume (EXPLAIN + p50/p95) | `pnpm --filter @macuxi/db exec tsx scripts/medir-sync.ts` |
| Parar o container (mantém os dados) | `pnpm --filter @macuxi/db banco derrubar` |
| Parar e APAGAR o volume de dados | `pnpm --filter @macuxi/db banco derrubar --limpar` |
| Testes do banco | `pnpm --filter @macuxi/db test` |

Todas aceitam `--banco <nome>` (padrão: `MACUXI_PG_BANCO` ou `macuxi`).

## Testes
`pnpm --filter @macuxi/db test` (também roda no `pnpm test` da raiz):
- **Estáticos (sempre rodam):** pares up/down, campos comuns, RLS/FORCE/política/grant/índice de sync
  em cada `create table`, Drizzle x SQL, cobertura da fixture e do seed.
- **Com Postgres:** o `globalSetup` cria um banco efêmero `macuxi_teste_<...>`, aplica as migrações,
  carrega a fixture dois-tenants e apaga o banco no fim. Arquivos:
  `migracoes.test.ts` (S0-020/021/022), `conformidade.test.ts` (S0-023/028), `vazamento.test.ts`
  (S0-024/025/026/027), `seed-fase-m.test.ts` (S0-031..034), `drizzle-x-banco.test.ts`.
- **Postgres parado, Docker aberto:** o `globalSetup` roda `docker compose up -d --wait` e os testes
  **rodam** (desligue com `MACUXI_PG_AUTO_SUBIR=0`; só vale para host local).
- **Sem Docker/Postgres:** esses arquivos são **pulados** e, no fim, aparece
  `[db] Docker não está rodando: N testes de banco pulados.` (relator `db/testes/aviso-pulos.ts`).
- **CI:** defina `MACUXI_PG_EXIGIR=1` — aí a ausência do banco é **erro** (não pula).
- Vários processos ao mesmo tempo (ex.: `pnpm test` da raiz + `tests/`) são seguros: cada um usa o
  próprio banco efêmero; a criação do papel `macuxi_app` é serializada por advisory lock.

## Para o agente `testes` (tests/)

**Opção 1 — mesmo setup do db/ (recomendada para o vazamento):** em `tests/vitest.config.ts`:
```ts
import AvisoPulos from '@macuxi/db/teste/aviso-pulos';
// ...
test: {
  globalSetup: ['../db/testes/global-setup.ts'],   // relativo ao root (tests/): sobe o Docker se preciso,
  reporters: ['default', new AvisoPulos()],         // cria macuxi_teste_*, migra, carrega dois-tenants e apaga no fim
  hookTimeout: 120_000,
}
```
E no teste: `import { banco, semBanco } from '@macuxi/db/teste/estado'` +
`describe.skipIf(semBanco())(...)`; `banco().urlApp` (papel `macuxi_app`, RLS) e `banco().urlAdmin`.
Utilitários do vazamento (`tabelasComTenant`, `emTransacao`, `erroDe`, `comCliente`) em
`@macuxi/db/teste/util`. O próprio `db/testes/vazamento.test.ts` é o modelo.

**Opção 2 — banco por arquivo, sem globalSetup:**
```ts
import { criarBancoDeTeste, carregarDoisTenants, comTenant, DOIS_TENANTS, TABELAS_SEM_TENANT_ID } from '@macuxi/db/teste';
import pg from 'pg';

const banco = await criarBancoDeTeste({ preparar: (admin) => carregarDoisTenants(admin).then(() => {}) });
const pool = new pg.Pool({ connectionString: banco.urlApp });           // papel macuxi_app (sujeito a RLS)
const linhas = await comTenant(pool, DOIS_TENANTS.A.tenantId, (c) => c.query('select * from core.usuario'));
await pool.end(); await banco.apagar();
```
- `banco.urlAdmin` ignora RLS: use só para preparar dados ou ler o catálogo, **nunca** para provar isolamento.
- `postgresDisponivel()` devolve `{ ok }` para decidir `describe.skipIf`.
- IDs determinísticos em `DOIS_TENANTS` (prefixo `aaaaaaaa-` para A, `bbbbbbbb-` para B). Detalhe em
  [fixture-dois-tenants.md](fixture-dois-tenants.md).

## Arquivos
| Caminho | Conteúdo |
|---|---|
| `db/docker-compose.yml` | serviço `postgres` (pgvector/pgvector:pg16), volume `macuxi-pgdata`, porta 5432 só em `127.0.0.1`, UTC |
| `db/migrations/NNNN_nome.up.sql` / `.down.sql` | migrações versionadas (SQL), sempre com caminho de volta |
| `db/src/migrador.ts` | executor up/down com checksum do up e do down (migração aplicada não pode ser editada) e advisory lock |
| `db/src/contexto.ts` | `comTenant` / `definirTenant` (contexto do tenant por transação) |
| `db/src/papeis.ts` | papéis `macuxi_app` e `macuxi_worker` (`garantirPapelApp`, `garantirPapelWorker`) e diagnóstico (S0-028) |
| `db/src/banco-teste.ts` | banco efêmero, disponibilidade do Postgres |
| `db/esquema/plataforma.ts`, `modules/core/db/nuvem.ts`, `modules/vendedor/db/nuvem.ts` | espelho Drizzle (tipado) das tabelas |
| `db/src/ids.ts`, `db/src/datas.ts` | ids fixos/determinísticos (`idDeChave` = `plataforma.uuid_de_chave`, `idMotivoPadrao`) e datas relativas a hoje no fuso |
| `drizzle.config.ts` | Drizzle Kit; `drizzle:rascunho` gera só rascunho em `db/drizzle-rascunho/` (ignorado) |
| `db/seeds/fase-m/fase-m.ts` | seed de demonstração da Fase M |
| `db/seeds/fixtures/dois-tenants.ts` | fixture dos testes de RLS e licenças |
| `db/scripts/banco.ts` | CLI acima |
| `db/src/docker.ts` | acha o Docker (inclusive fora do PATH no Windows), diz se está rodando, sobe o compose |
| `db/testes/global-setup.ts`, `db/testes/aviso-pulos.ts` | setup dos testes de banco (sobe/pula/exige) e aviso de pulados |
| `db/scripts/medir-sync.ts` | medição do sync com volume ([desempenho-sync.md](desempenho-sync.md)) |

## Migrações: regras
1. Uma migração = `NNNN_nome.up.sql` + `NNNN_nome.down.sql`, numeração contínua (o executor recusa buraco).
2. **Nunca edite migração aplicada** — checksum (sha256, fim de linha normalizado) do `.up.sql` diferente aborta o `up`;
   o do `.down.sql` diferente aborta o `up` e o `down`. Crie a próxima.
3. Toda tabela nova: campos comuns, `enable` + `force row level security`, política `isolamento_tenant`
   para `macuxi_app`, grant explícito, índice `(tenant_id, updated_at, id)` se for sincronizada. O teste
   estático reprova o `create table` que esquecer algum.
4. O `down` apaga dados (DROP SCHEMA ... CASCADE). Em produção, só com backup e decisão registrada.
5. Drizzle é espelho: ao mudar o SQL, ajuste `db/esquema/*.ts` ou `modules/<m>/db/nuvem.ts` (o teste Drizzle x banco acusa).
6. Perfis: a fonte única é `PERFIS` de `@macuxi/platform-sdk`. O Drizzle importa de lá; os `check (perfil in (...))`
   das migrações são comparados com ela em `db/testes/estatico.test.ts` (perfil novo = migração nova trocando o CHECK).

Modelo e políticas: [rls.md](rls.md) · dicionários: [plataforma.md](plataforma.md), [core.md](core.md), [vendedor.md](vendedor.md).

Migrações: 0001 plataforma · 0002 core · 0003 worker/outbox · 0004 sessão e aparelho · **0005 `plataforma.arquivo` +
`uuid_de_chave`** · **0006 lote A do core** (Cliente 360, rotas, visitas, motivos, notificações, metas, indicador diário;
padrões em todo tenant por gatilho) · **0007 schema `vendedor`** (pedido e pedido_item, mínimo do pull).
O executor roda como admin (superusuário no Docker/CI): a semeadura dos padrões e as fixtures dependem disso (FORCE RLS).

## Pendências
Feitas na **T-0004** (migração `0003_plataforma_worker`): `carteira_usuario_sync_ix`, papel `macuxi_worker` com as
políticas `despacho_outbox*` (ADR 0007), `plataforma.evento_consumo` e colunas `usuario_id`/`request_id` em
`plataforma.evento`. Feitas na **T-0003 Fase 2** (migração `0004_core_sessao`): `core.sessao`, `core.dispositivo`,
`core.usuario.tentativas_falhas`/`bloqueio_ate` e `equipe_responsavel_ix` ([core.md](core.md)). Pendentes:
- Limpeza de `core.sessao` expirada (job no worker ou por tenant; índice `sessao_expira_ix` pronto).
- pg-boss (schema `pgboss`, criado pelo migrador) junto do primeiro consumidor real (ADR 0007 item 5).
- `MACUXI_PG_WORKER_SENHA` nos `.env.example` (raiz: engenheiro-software; `db/.env.example`: sem permissão de leitura nesta sessão).
- Cursor do pull com transação longa (`updated_at = now()` é o início da transação): tratado na rota de pull (T-0004).
