# Isolamento entre tenants (RLS) — modelo das políticas

RN-CORE-05: isolamento total entre tenants (`tenant_id` do token + Row Level Security). Dono: `banco-dados`.

## Papéis
| Papel | Atributos | Uso |
|---|---|---|
| admin / migrador (`postgres` no Docker local) | superusuário, dono de todos os objetos | aplica migrações, cria bancos de teste, carrega seed/fixture. **Ignora RLS** — nunca é usado pela API nem para provar isolamento |
| `macuxi_app` | `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, não é dono de nada | **único** papel da API e dos testes de vazamento |
| `macuxi_worker` | mesmos atributos (**NOBYPASSRLS**), não é dono de nada | despachante da outbox (ADR 0007): só lê e marca `plataforma.evento` de todos os tenants |

- A migração 0001 cria `macuxi_app` como `NOLOGIN` se não existir; o executor (`db/src/papeis.ts`)
  liga o `LOGIN` e define a senha a partir de `MACUXI_PG_APP_SENHA`. Papéis são do cluster: o `down` não os remove.
- A migração 0003 cria `macuxi_worker` como `NOLOGIN`; `garantirPapelWorker` (`@macuxi/db`) liga o `LOGIN` com
  `MACUXI_PG_WORKER_SENHA` (local: `macuxi_worker_local`; fora do local é opcional — sem ela o papel fica `NOLOGIN`
  e `urlWorker(cfg)` lança erro; a senha pública local é recusada). O `down` da 0003 revoga tudo do papel no banco.
- Todas as tabelas têm `ENABLE` **e** `FORCE ROW LEVEL SECURITY` (defesa extra caso um dia o dono não seja superusuário).
- Grants explícitos por tabela. `plataforma.tenant`: só `SELECT`. `plataforma.auditoria`: só `SELECT, INSERT` (RN-AUD-01).
  `public.macuxi_migracao`: nenhum acesso.

## Contexto do tenant (como a aplicação define)
Em **cada transação**, antes de qualquer consulta:
```sql
begin;
select set_config('app.tenant_id', '<uuid do tenant do token>', true);  -- true = SET LOCAL
-- ... consultas ...
commit;
```
Em TypeScript: `comTenant(pool, tenantId, async (c) => ...)` de `@macuxi/db` (abre a transação, define o
contexto, faz COMMIT/ROLLBACK e devolve a conexão ao pool). Com Drizzle: `drizzle(c)` dentro do callback.

- O `tenant_id` vem **só do token** (nunca de header, corpo ou query) — responsabilidade da API (T-0003).
- `SET LOCAL` some no fim da transação: a conexão devolvida ao pool não carrega o tenant anterior (S0-027).
- Não usar `SET app.tenant_id` sem `LOCAL` (vazaria para a próxima requisição da mesma conexão).

## Função e política
```sql
create function plataforma.tenant_atual() returns uuid language sql stable parallel safe
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create policy isolamento_tenant on <schema>.<tabela> for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
```
- `plataforma.tenant` (sem `tenant_id`) usa `id = plataforma.tenant_atual()`.
- Uma política só, `FOR ALL`: `USING` filtra leitura/UPDATE/DELETE; `WITH CHECK` barra INSERT/UPDATE que
  gravariam linha de outro tenant (inclui trocar o `tenant_id`).

## Falha fechada
| Situação | Resultado |
|---|---|
| sem `set_config` (ou fora de transação) | `tenant_atual()` = NULL → `tenant_id = NULL` é falso → **0 linhas**; INSERT barrado |
| contexto vazio `''` | NULL → 0 linhas |
| UUID de tenant inexistente | 0 linhas |
| texto que não é UUID | **erro** `22P02` (a transação aborta) |

Nunca "todas as linhas". Coberto por S0-026 em `db/testes/vazamento.test.ts`.

## Integridade entre tenants (além do RLS)
- Toda FK entre tabelas de tenant é **composta**: `(tenant_id, x_id) references t (tenant_id, id)` com
  `unique (tenant_id, id)` no alvo. Checagens de FK ignoram RLS, então sem isso daria para apontar para a
  linha de outro tenant "às cegas"; com a FK composta o banco recusa (`23503`).
- `tenant_id` sempre `not null references plataforma.tenant (id)`.

## Exceções à regra 5 (CLAUDE.md) — `db/src/excecoes.ts`
| Tabela | Motivo |
|---|---|
| `plataforma.tenant` | o próprio `id` é o tenant; RLS por `id` |
| `public.macuxi_migracao` | controle do executor de migrações; sem RLS e sem acesso do `macuxi_app` |

Fora do índice de sync `(tenant_id, updated_at, id)` (não são puxadas pelo app): `plataforma.evento`
(índices próprios: pendentes e por tenant/ocorrido_em), `plataforma.evento_consumo` (único por consumidor/evento)
e `plataforma.auditoria`.

## Acesso sem contexto (casos previstos)
- **Login** (código da empresa + e-mail + senha): `plataforma.tenant_por_codigo(codigo)` é
  `SECURITY DEFINER` (roda como o dono, que ignora RLS) e devolve só `id, nome, fuso, status`. Depois a
  API abre transação com o tenant resolvido e busca o usuário por `lower(email)`.
  Premissa: o dono das funções é superusuário ou tem `BYPASSRLS` (em nuvem gerenciada, conceder ao papel migrador).
- **Despacho do outbox** (ADR 0007, migração 0003): papel `macuxi_worker` **NOBYPASSRLS** (`BYPASSRLS` vale para o
  papel inteiro, não dá para restringir a uma tabela) com **políticas próprias** só em `plataforma.evento`:
  `despacho_outbox` (`for select to macuxi_worker using (true)`) e `despacho_outbox_marcar`
  (`for update to macuxi_worker using (true) with check (true)`). Grants por coluna: `select (id, tenant_id, nome,
  modulo, agregado_id, payload, ocorrido_em, publicado_em, tentativas, usuario_id, request_id)` e
  `update (publicado_em, tentativas, ultimo_erro)`; `usage` no schema `plataforma`; **nada** em `core.*`, nos schemas
  dos módulos nem nas outras tabelas da plataforma (42501). O handler do consumidor roda como `macuxi_app` em
  `comTenant(envelope.tenant_id)` e registra o consumo em `plataforma.evento_consumo` (RLS por tenant).
  pg-boss (schema `pgboss`) entra com o primeiro consumidor real. Plano B: funções `SECURITY DEFINER`.
- **Hub de Integração** (0010, T-0032): `integracao.autenticar_chave(hash)` (`SECURITY DEFINER`, só `macuxi_app`) é a única
  leitura sem tenant: devolve no máximo a linha da chave (sem o hash) com o `tenant_id` e o Conector; depois a API abre
  `comTenant` com o tenant da chave. `integracao.expurgar_retencao` e `plataforma.expurgar_outbox` (0011) são `SECURITY DEFINER`
  com `execute` só ao `macuxi_worker` (que também ganha `usage` no schema `integracao`, sem nenhum grant de tabela). Dicionário:
  [integracao.md](integracao.md).
- **`search_path` das SECURITY DEFINER** (0012, T-0042): as 4 (`tenant_por_codigo`, `autenticar_chave`, `expurgar_retencao`,
  `expurgar_outbox`) usam `pg_catalog, <schema>, pg_temp` (pg_temp por último: o schema temporário da sessão não sombreia
  nome do dono). Função SECURITY DEFINER nova nasce assim. Único índice único sem `tenant_id`: `integracao.credencial_hash_uk`
  (exceção nominal com condição de validade em [integracao.md](integracao.md#credencial)).
- **`plataforma.resumo_outbox`** (0024, T-0078): quinta `SECURITY DEFINER`, já com `pg_temp` no fim do `search_path`;
  `execute` só ao `macuxi_app`; devolve só contagens da outbox de todos os tenants (`/v1/saude`). As funções da LGPD da 0024
  (`anonimizar_*`, `excluir_tenant`) são `SECURITY INVOKER`, sem `execute` para os papéis da aplicação ([lgpd.md](lgpd.md)).
- **`plataforma.tenants_ativos()`** (0027, T-0039, ADR 0022): sexta `SECURITY DEFINER`, `pg_temp` no fim do `search_path`;
  `execute` só ao `macuxi_worker` (que segue sem `SELECT` em `plataforma.tenant`); devolve só os ids dos tenants `ativo` e não
  apagados, para o agendador das tarefas periódicas. `macuxi_app` e `public` sem EXECUTE.
- **Conferência B1** (T-0078): `db/scripts/conferir-rls.sql` lista toda tabela de domínio com RLS desligado, RLS não forçado,
  sem política, sem política para o `macuxi_app` ou com coluna comum ausente, de outro tipo ou anulável. Esperado: zero linhas
  (exceções de `db/src/excecoes.ts`: `plataforma.tenant` sem `tenant_id`; `public.macuxi_migracao` fora). À mão, só leitura:
  `psql "$URL_ADMIN" -v ON_ERROR_STOP=1 -f db/scripts/conferir-rls.sql`.

## Testes que provam
| ID | Onde |
|---|---|
| S0-023 conformidade (campos, RLS, política, índice) | `db/testes/conformidade.test.ts` + `db/testes/estatico.test.ts` |
| S0-024 leitura cruzada (tabelas descobertas dinamicamente) | `db/testes/vazamento.test.ts` |
| S0-025 escrita cruzada (INSERT/UPDATE/DELETE/troca de tenant, FK composta) | idem |
| S0-026 falha fechada | idem |
| S0-027 pool de 1 conexão A/B/A | idem |
| S0-028 papel sem SUPERUSER/BYPASSRLS, não dono | `db/testes/conformidade.test.ts` |
| B1 (T-0078) conferência numa consulta só: zero tabelas sem RLS forçado, sem política ou sem coluna comum; a consulta acusa uma tabela criada sem RLS | `db/testes/conformidade.test.ts` + `db/scripts/conferir-rls.sql` |
| `resumo_outbox`: só agregados de todos os tenants para o `macuxi_app`; worker sem EXECUTE | `db/testes/lgpd-outbox.test.ts` |
| `tenants_ativos`: worker recebe só os ids dos ativos de todos os tenants (suspenso, encerrado e apagado fora); app 42501 | `db/testes/tenants-ativos.test.ts` |
| macuxi_worker: lê A e B, 42501 fora das colunas/tabelas concedidas, só marca 3 colunas, sem BYPASSRLS; app sem contexto = 0 | `db/testes/worker.test.ts` |
