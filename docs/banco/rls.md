# Isolamento entre tenants (RLS) — modelo das políticas

RN-CORE-05: isolamento total entre tenants (`tenant_id` do token + Row Level Security). Dono: `banco-dados`.

## Papéis
| Papel | Atributos | Uso |
|---|---|---|
| admin / migrador (`postgres` no Docker local) | superusuário, dono de todos os objetos | aplica migrações, cria bancos de teste, carrega seed/fixture. **Ignora RLS** — nunca é usado pela API nem para provar isolamento |
| `macuxi_app` | `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, não é dono de nada | **único** papel da API e dos testes de vazamento |

- A migração 0001 cria `macuxi_app` como `NOLOGIN` se não existir; o executor (`db/src/papeis.ts`)
  liga o `LOGIN` e define a senha a partir de `MACUXI_PG_APP_SENHA`. Papéis são do cluster: o `down` não os remove.
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
(índices próprios: pendentes e por tenant/ocorrido_em) e `plataforma.auditoria`.

## Acesso sem contexto (casos previstos)
- **Login** (código da empresa + e-mail + senha): `plataforma.tenant_por_codigo(codigo)` é
  `SECURITY DEFINER` (roda como o dono, que ignora RLS) e devolve só `id, nome, fuso, status`. Depois a
  API abre transação com o tenant resolvido e busca o usuário por `lower(email)`.
  Premissa: o dono das funções é superusuário ou tem `BYPASSRLS` (em nuvem gerenciada, conceder ao papel migrador).
- **Despacho do outbox (pg-boss)**: ainda não implementado. Proposta: papel `macuxi_worker` com
  `BYPASSRLS` restrito a `plataforma.evento`, **ou** worker que itera por tenant com `comTenant`. Decidir com o
  `engenheiro-software` quando o pg-boss entrar.

## Testes que provam
| ID | Onde |
|---|---|
| S0-023 conformidade (campos, RLS, política, índice) | `db/testes/conformidade.test.ts` + `db/testes/estatico.test.ts` |
| S0-024 leitura cruzada (tabelas descobertas dinamicamente) | `db/testes/vazamento.test.ts` |
| S0-025 escrita cruzada (INSERT/UPDATE/DELETE/troca de tenant, FK composta) | idem |
| S0-026 falha fechada | idem |
| S0-027 pool de 1 conexão A/B/A | idem |
| S0-028 papel sem SUPERUSER/BYPASSRLS, não dono | `db/testes/conformidade.test.ts` |
