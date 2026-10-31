# Banco de dados — como subir, testar e derrubar

Dono: `banco-dados`. Pacote `@macuxi/db` em `db/`. Postgres 16 + pgvector via Docker Desktop
(imagem `pgvector/pgvector:pg16`, a mesma do CI — T-0005).

> **Situação em 2026-10-31:** o Docker ainda não está instalado nesta máquina. Tudo abaixo está
> escrito e os testes estáticos rodam; os testes que precisam de Postgres **pulam com aviso** até o
> Docker subir. Ver "O que falta executar" no fim.

## Pré-requisitos
- Docker Desktop instalado e aberto (`docker version` responde).
- Node >= 24.7 para os seeds/fixtures (usam `crypto.argon2Sync` nativo para o hash argon2id).
- `db` registrado no `pnpm-workspace.yaml` e `pnpm install` rodado (traz `pg`, `drizzle-orm`, `drizzle-kit`).
- Opcional: copiar `db/.env.example` para `db/.env` (ou para a `.env` da raiz). Sem `.env`, valem os
  padrões locais (porta 5432, admin `postgres`/`postgres`, banco `macuxi`, papel `macuxi_app`).

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
| Parar o container (mantém os dados) | `pnpm --filter @macuxi/db banco derrubar` |
| Parar e APAGAR o volume de dados | `pnpm --filter @macuxi/db banco derrubar --limpar` |
| Testes do banco | `pnpm --filter @macuxi/db test` |

Todas aceitam `--banco <nome>` (padrão: `MACUXI_PG_BANCO` ou `macuxi`). Sem Docker, use `docker compose -f db/docker-compose.yml up -d --wait` só depois de instalar.

## Testes
`pnpm --filter @macuxi/db test` (também roda no `pnpm test` da raiz):
- **Estáticos (sempre rodam):** pares up/down, campos comuns, RLS/FORCE/política/grant/índice de sync
  em cada `create table`, Drizzle x SQL, cobertura da fixture e do seed.
- **Com Postgres:** o `globalSetup` cria um banco efêmero `macuxi_teste_<...>`, aplica as migrações,
  carrega a fixture dois-tenants e apaga o banco no fim. Arquivos:
  `migracoes.test.ts` (S0-020/021/022), `conformidade.test.ts` (S0-023/028), `vazamento.test.ts`
  (S0-024/025/026/027), `seed-fase-m.test.ts` (S0-031..034), `drizzle-x-banco.test.ts`.
- **Sem Postgres:** esses arquivos são **pulados** e o setup imprime
  `[db] Postgres indisponível ... Testes de banco ... PULADOS`.
- **CI:** defina `MACUXI_PG_EXIGIR=1` — aí a ausência do banco é **erro** (não pula).

## Para o agente `testes` (tests/)
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
| `db/docker-compose.yml` | serviço `postgres` (pgvector/pgvector:pg16), volume `macuxi-pgdata`, porta 5432, UTC |
| `db/migrations/NNNN_nome.up.sql` / `.down.sql` | migrações versionadas (SQL), sempre com caminho de volta |
| `db/src/migrador.ts` | executor up/down com checksum (migração aplicada não pode ser editada) e advisory lock |
| `db/src/contexto.ts` | `comTenant` / `definirTenant` (contexto do tenant por transação) |
| `db/src/papeis.ts` | papel `macuxi_app` e diagnóstico (S0-028) |
| `db/src/banco-teste.ts` | banco efêmero, disponibilidade do Postgres |
| `db/esquema/plataforma.ts`, `modules/core/db/nuvem.ts` | espelho Drizzle (tipado) das tabelas |
| `drizzle.config.ts` | Drizzle Kit; `drizzle:rascunho` gera só rascunho em `db/drizzle-rascunho/` (ignorado) |
| `db/seeds/fase-m/fase-m.ts` | seed de demonstração da Fase M |
| `db/seeds/fixtures/dois-tenants.ts` | fixture dos testes de RLS e licenças |
| `db/scripts/banco.ts` | CLI acima |

## Migrações: regras
1. Uma migração = `NNNN_nome.up.sql` + `NNNN_nome.down.sql`, numeração contínua (o executor recusa buraco).
2. **Nunca edite migração aplicada** — o checksum (sha256, fim de linha normalizado) diferente aborta o `up`. Crie a próxima.
3. Toda tabela nova: campos comuns, `enable` + `force row level security`, política `isolamento_tenant`
   para `macuxi_app`, grant explícito, índice `(tenant_id, updated_at, id)` se for sincronizada. O teste
   estático reprova o `create table` que esquecer algum.
4. O `down` apaga dados (DROP SCHEMA ... CASCADE). Em produção, só com backup e decisão registrada.
5. Drizzle é espelho: ao mudar o SQL, ajuste `db/esquema/*.ts` ou `modules/<m>/db/nuvem.ts` (o teste Drizzle x banco acusa).

Modelo e políticas: [rls.md](rls.md) · dicionários: [plataforma.md](plataforma.md), [core.md](core.md).

## O que falta executar (quando o Docker estiver de pé)
1. `pnpm --filter @macuxi/db banco subir` (baixa a imagem, cria `macuxi`, aplica 0001 e 0002).
2. `pnpm --filter @macuxi/db test` sem pulos (todos os arquivos com Postgres) — inclusive o de pgvector.
3. `pnpm --filter @macuxi/db banco seed fase-m` e conferir `banco status`.
4. EXPLAIN das consultas de sync pull por `(tenant_id, updated_at, id)` com volume (meta p95 < 300 ms) — fica para quando houver a rota de sync com dados.
