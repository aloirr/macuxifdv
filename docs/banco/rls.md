# Isolamento entre tenants (RLS) — modelo das políticas

RN-CORE-05: isolamento total entre tenants (`tenant_id` do token + Row Level Security). Dono: `banco-dados`.

## Papéis
| Papel | Atributos | Uso |
|---|---|---|
| admin / migrador (`postgres` no Docker local; `macuxi_admin` no DBaaS) | superusuário, dono de todos os objetos (no DBaaS: sem SUPERUSER/BYPASSRLS, com CREATEDB/CREATEROLE, membro com INHERIT do `macuxi_manutencao`) | aplica migrações, cria bancos de teste, carrega seed/fixture. **Ignora RLS** (superusuário ou política `manutencao`) — nunca é usado pela API nem para provar isolamento |
| `macuxi_manutencao` (0031) | NOLOGIN, NOSUPERUSER, **NOBYPASSRLS**; ninguém conecta com ele | só existe para a política `manutencao` (`for all ... using (true) with check (true)`) valer para o migrador, que o herda. **Nunca** concedido a `macuxi_app`, `macuxi_worker` nem `macuxi_portal` |
| `macuxi_app` | `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, não é dono de nada | **único** papel da API e dos testes de vazamento |
| `macuxi_worker` | mesmos atributos (**NOBYPASSRLS**), não é dono de nada | despachante das outboxes (ADR 0007; 0040, ADR 0032): só lê e marca `plataforma.evento` e `plataforma.email_saida` (só a linha pendente) de todos os tenants; desde a 0058 (ADR 0043), lê `plataforma.diagnostico` sem o texto livre e marca só as `alerta_*` |
| `macuxi_portal` (0038, T-0091) | mesmos atributos (**NOBYPASSRLS**), não é dono de nada, membro de nenhum papel, **nenhum grant de tabela** | portal do super-admin (ADR 0029): 2º pool da API; só `USAGE` em `plataforma` e `EXECUTE` nas `plataforma.sa_*` (20 na 0038; 12 desde a 0039, T-0093; 14 desde a 0042; 16 desde a 0058, T-0158) (o único papel com ele) |

- A migração 0001 cria `macuxi_app` como `NOLOGIN` se não existir; o executor (`db/src/papeis.ts`)
  liga o `LOGIN` e define a senha a partir de `MACUXI_PG_APP_SENHA`. Papéis são do cluster: o `down` não os remove.
- A migração 0003 cria `macuxi_worker` como `NOLOGIN`; `garantirPapelWorker` (`@macuxi/db`) liga o `LOGIN` com
  `MACUXI_PG_WORKER_SENHA` (local: `macuxi_worker_local`; fora do local é opcional — sem ela o papel fica `NOLOGIN`
  e `urlWorker(cfg)` lança erro; a senha pública local é recusada). O `down` da 0003 revoga tudo do papel no banco.
- A migração 0038 cria `macuxi_portal` como `NOLOGIN` se não existir; `garantirPapelPortal` liga o `LOGIN` com
  `MACUXI_PG_PORTAL_SENHA` (local: `macuxi_portal_local`; fora do local é opcional — sem ela o papel fica `NOLOGIN`
  (`garantirPapelSemLogin`, atributos conferidos), `urlPortal(cfg)` lança e o portal responde 503; a senha pública local é
  recusada). O `down` da 0038 devolve o EXECUTE das `sa_*` ao `macuxi_app` e tira o do portal; o papel fica.
  **Regra:** toda função `plataforma.sa_*` nova tem EXECUTE só ao `macuxi_portal` (nunca `macuxi_app`/`macuxi_worker`/`public`).
- **Como o executor mexe no papel** (`garantirPapelDeLogin`, B0 do plano B do DBaaS, T-0075, 05/11): papel **novo** =
  `CREATE ROLE ... LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ...`; papel **existente** =
  só `ALTER ROLE <papel> LOGIN PASSWORD ...`, sem citar atributo (no PG 16, citar `NOSUPERUSER`/`NOBYPASSRLS`/
  `NOREPLICATION` num `ALTER ROLE` exige superusuário — era o "permission denied to alter role" do DBaaS). Os atributos do
  papel existente são **conferidos** em `pg_roles`: `SUPERUSER`, `BYPASSRLS`, `CREATEDB`, `CREATEROLE` ou `REPLICATION` =
  erro com a correção (`alter role <papel> nosuperuser ...` por um superusuário, ou apagar o papel); nada é alterado
  (antes, o `ALTER ROLE` corrigia em silêncio). Com `password_encryption = scram-sha-256` (padrão do PG 14+, demo e CI) e
  senha ASCII imprimível sem espaço, a senha vai como **verificador SCRAM** calculado no cliente (`db/src/scram.ts`, com o
  `scram_iterations` do servidor): o servidor guarda a mesma credencial e a senha em texto não chega a ele nem a log. Fora
  disso (md5 ou outros caracteres), vai em texto, como antes, na transação sem log de comando. Na demo e no CI nada muda:
  os papéis nascem pelas migrações 0001/0003 com os atributos certos e o passo dá `LOGIN` e a senha.
- Todas as tabelas têm `ENABLE` **e** `FORCE ROW LEVEL SECURITY` (defesa extra caso um dia o dono não seja superusuário).
- Grants explícitos por tabela. `plataforma.tenant`: só `SELECT`. `plataforma.auditoria`: só `SELECT, INSERT` (RN-AUD-01).
  `public.macuxi_migracao`: nenhum acesso.

## Papel de manutenção (0031, T-0075 — B1 do plano B do DBaaS, ADR 0024)

No DBaaS da Magalu o admin **não** é superusuário, não tem BYPASSRLS e não consegue ganhá-lo (relatório do run
42021914715, X1/X1.2). Com `FORCE ROW LEVEL SECURITY`, o dono das tabelas sem política não lê nem grava linha de tenant:
seed, fixtures, backfill de migração (0 linhas, sem erro) e as funções `SECURITY DEFINER` entre tenants quebravam.

- `macuxi_manutencao`: NOLOGIN, sem BYPASSRLS. Criado pela 0031 (ou antes, por `garantirPapelManutencao` em
  `db/src/papeis.ts`, que `criarBanco` chama com advisory lock para os bancos de teste paralelos).
- `grant macuxi_manutencao to current_user with inherit true` (PG 16): o migrador herda o papel. Dentro das funções
  `SECURITY DEFINER` o `current_user` é o dono, então elas também enxergam todos os tenants, sem `ALTER FUNCTION`.
- Política **`manutencao`** em **toda tabela com RLS**: `for all to macuxi_manutencao using (true) with check (true)` (mesmo
  padrão das `despacho_outbox*` do worker, 0003). Num superusuário (demo, CI) nada muda.
- **Regra para tabela nova (0032 em diante)**: a migração cria, junto da `isolamento_tenant`,
  `create policy manutencao on <schema>.<tabela> for all to macuxi_manutencao using (true) with check (true);`. Falham sem
  ela: `db/scripts/conferir-rls.sql` ("sem política de manutenção"), `db/testes/conformidade.test.ts` (no banco) e
  `db/testes/estatico.test.ts` (nas migrações).
- **Trava**: `macuxi_app` e `macuxi_worker` nunca são membros (nem INHERIT nem SET). A 0031 aborta (42501) se forem;
  `conferir-rls.sql` lista "(papel) <nome>"; `diagnosticarPapelApp` (S0-028) conta a filiação como `ignoraRls`.
- Risco: o mesmo do superusuário (a conexão de administração vê todos os tenants); API e worker nunca a usam.
- Down da 0031: apaga só as políticas `manutencao`; o papel e a filiação ficam (objetos do cluster, como o `macuxi_worker`).
- B0 (no mesmo plano): sem superusuário, `garantirPapelDeLogin` dá ao admin `SET` (sem INHERIT) nos papéis que cria, para
  `set role macuxi_app/macuxi_worker` nos testes e na manutenção; o admin não herda as políticas deles.

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
| `plataforma.super_admin`, `super_admin_desafio`, `super_admin_sessao`, `auditoria_plataforma` (0035, ADR 0029) | super-admin de plataforma, fora dos tenants: **só por função** (`TABELAS_SO_POR_FUNCAO`): RLS forçado sem política e sem grant para `macuxi_app`/`macuxi_worker` (42501 direto), só a `manutencao`; acesso pelas 20 `plataforma.sa_*` SECURITY DEFINER (só `macuxi_portal` desde a 0038; na 0035, `macuxi_app`). A auditoria guarda o tenant em `tenant_alvo_id` (sem FK) para sobreviver à `excluir_tenant`. Dicionário: [plataforma.md](plataforma.md) |
| `plataforma.portal_tentativa`, `portal_sessao`, `portal_sessao_empresa` (0039, T-0093, ADR 0031) | login do portal só com e-mail e senha: **só por função**, como as da 0035 (RLS forçado, só a `manutencao`, nenhum grant: app, worker e portal 42501); acesso pelas 12 `plataforma.sa_*` da 0039 (só `macuxi_portal`). A empresa da sessão fica em `tenant_alvo_id` (não `tenant_id`, de propósito). Dicionário: [plataforma.md](plataforma.md) |
| `plataforma.backup_empresa`, `backup_empresa_parte`, `exclusao_empresa`, `empresa_excluida` (0072, ADR 0052) | ações da empresa no portal: `empresa_id` **sem FK** no lugar de `tenant_id`, de propósito, para o backup, a exclusão e o registro da empresa excluída sobreviverem à `excluir_tenant` (como a `auditoria_plataforma`). **Só por função** (RLS forçado, só a `manutencao`, nenhum grant: app, worker e portal 42501); acesso pelas 8 `sa_*` da 0072 (só `macuxi_portal`) e pelas funções do worker (só `macuxi_worker`), que tiram o tenant da linha do job. A 0072 também restringe as políticas `despacho_outbox` e `despacho_email` do worker aos tenants ativos (`plataforma.tenant_esta_ativo`). Dicionário: [plataforma.md](plataforma.md) |

Fora do índice de sync `(tenant_id, updated_at, id)` (não são puxadas pelo app): `plataforma.evento`
(índices próprios: pendentes e por tenant/ocorrido_em), `plataforma.evento_consumo` (único por consumidor/evento)
e `plataforma.auditoria`.

## Acesso sem contexto (casos previstos)
- **Login** (código da empresa + e-mail + senha): `plataforma.tenant_por_codigo(codigo)` é
  `SECURITY DEFINER` (roda como o dono, que ignora RLS) e devolve só `id, status` (desde a 0052; o nome e o fuso saem depois
  da senha por `plataforma.tenant_da_sessao()`, no contexto do tenant). Depois a
  API abre transação com o tenant resolvido e busca o usuário por `lower(email)`.
  Premissa: o dono das funções é superusuário ou herda o `macuxi_manutencao` (0031; é o caso do DBaaS, onde BYPASSRLS
  não é concedível).
- **Despacho do outbox** (ADR 0007, migração 0003): papel `macuxi_worker` **NOBYPASSRLS** (`BYPASSRLS` vale para o
  papel inteiro, não dá para restringir a uma tabela) com **políticas próprias** só em `plataforma.evento`:
  `despacho_outbox` (`for select to macuxi_worker using (true)`) e `despacho_outbox_marcar`
  (`for update to macuxi_worker using (true) with check (true)`). Grants por coluna: `select (id, tenant_id, nome,
  modulo, agregado_id, payload, ocorrido_em, publicado_em, tentativas, usuario_id, request_id)` e
  `update (publicado_em, tentativas, ultimo_erro)`; `usage` no schema `plataforma`; **nada** em `core.*`, nos schemas
  dos módulos nem nas outras tabelas da plataforma (42501). O handler do consumidor roda como `macuxi_app` em
  `comTenant(envelope.tenant_id)` e registra o consumo em `plataforma.evento_consumo` (RLS por tenant).
  pg-boss (schema `pgboss`) entra com o primeiro consumidor real. Plano B: funções `SECURITY DEFINER`.
- **Despacho do e-mail** (0040, ADR 0032 §6): `plataforma.email_saida` tem a `isolamento_tenant` do `macuxi_app` (grant só
  `select, insert`) e, só para o `macuxi_worker`, `despacho_email` (`for select ... using (true)`) e `despacho_email_marcar`
  (`for update ... using (enviado_em is null and falhou_em is null) with check (true)`), com `select` e `update` por coluna
  (`carga, tentativas, proxima_tentativa_em, enviado_em, falhou_em, ultimo_erro`). O `db/scripts/conferir-rls.sql` acusa
  política do `macuxi_worker` em qualquer tabela fora de `plataforma.evento`, `plataforma.email_saida` e
  `plataforma.diagnostico`.
- **Alerta do diagnóstico** (0058, T-0158, ADR 0043): `plataforma.diagnostico` tem a `isolamento_tenant` do `macuxi_app`
  (`select` e `insert` por coluna, sem `protocolo`, `recebido_em`, `alerta_*` nem `external_id`; `usage` na sequência do
  protocolo) e, só para o `macuxi_worker`, `diagnostico_alerta` (`for select ... using (true)`) e `diagnostico_alerta_marcar`
  (`for update ... using (alerta_situacao in ('pendente', 'agrupado')) with check (true)`), com `select` por coluna SEM
  `descricao` e `detalhe` e `update` só das `alerta_*`. O expurgo de 90 dias é a `plataforma.expurgar_diagnosticos`
  (SECURITY DEFINER, `execute` só ao worker). O portal só pelas `sa_listar_diagnosticos` e `sa_diagnostico` (super-admin).
  Dicionário: [plataforma.md](plataforma.md).
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
- **`plataforma.provisionar_tenant(jsonb)`** (0029, T-0083): `SECURITY INVOKER` (NÃO entra na lista das DEFINER), `search_path`
  fixo com `pg_temp` no fim, sem EXECUTE para `public`, `macuxi_app` e `macuxi_worker` (42501): só a conexão de administração
  (superusuário ou herdeira do `macuxi_manutencao`, 0031) cria tenant. Grava com o contexto do tenant novo ligado e restaurado no fim.
- **`core.plano_rv`** (0028, T-0082): enable + force + `isolamento_tenant`, como toda tabela de domínio.
- **Perfis de acesso** (0041, T-0111/T-0112, ADR 0033): `plataforma.perfil`, `perfil_permissao` e `usuario_perfil` com enable +
  force + `isolamento_tenant` do `macuxi_app` e `manutencao`, como `perfil_modulo` (`perfil` sem `delete` para o app: sai por soft
  delete); `macuxi_worker` e `macuxi_portal` sem nada. FKs compostas (inclusive `perfil_modulo_perfil_fk (tenant_id, perfil) →
  perfil (tenant_id, codigo)`). As 14 funções da 0041 nasceram `SECURITY INVOKER`; a leitura da
  API, `plataforma.perfis_do_usuario(uuid)`, filtra por `plataforma.tenant_atual()` além da RLS (sem contexto = 0 linhas).
  Prova: `db/testes/perfis-acesso.test.ts`.
- **Conferências do COMMIT** (0049, defeito R-20261108-130423-testes): as 4 funções dos gatilhos adiáveis da 0041
  (`usuario_conferir_acesso`, `usuario_perfil_conferir`, `perfil_conferir`, `perfil_permissao_conferir`) passam a `SECURITY
  DEFINER` (`search_path` fixo com `pg_temp`, EXECUTE só do dono): o gatilho adiado roda no COMMIT como quem commita e, vindo de
  uma `sa_*` do `macuxi_portal` (sem grant de tabela), dava 42501. Função de gatilho não é chamável por papel nenhum, então não
  entram nas listas DEFINER do `conformidade.test.ts` (que listam o que cada papel EXECUTA). O portal continua sem grant de
  tabela. Prova com COMMIT de verdade: `db/testes/conferencias-no-commit.test.ts`.
- **Conferência B1** (T-0078): `db/scripts/conferir-rls.sql` lista toda tabela de domínio com RLS desligado, RLS não forçado,
  sem política, sem política para o `macuxi_app`, sem a política `manutencao` (0031) ou com coluna comum ausente, de outro
  tipo ou anulável, os papéis `macuxi_app`/`macuxi_worker`/`macuxi_portal` que forem membros do `macuxi_manutencao` e (0038)
  toda tabela com política ou grant para o `macuxi_portal`. Esperado: zero linhas
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
| `provisionar_tenant`: app e worker 42501; 2x a mesma entrada = mesmas contagens; só `redefinir_senha` troca o hash | `db/testes/provisionar-tenant.test.ts` |
| Super-admin (0035/0038): app e worker 42501 direto nas 4 tabelas (e 0 linhas com grant indevido); app e worker 42501 nas 20 `sa_*` (rodam como `macuxi_portal`); primeiro acesso 2x (e em paralelo) = 1 linha; sessão falsa após revogar e após o teto; auditoria append-only que sobrevive à `excluir_tenant`; `sa_provisionar_tenant` recusa sessão revogada ou vencida; `sem_admin` + parâmetros idempotente | `db/testes/super-admin.test.ts` + `db/testes/estatico.test.ts` + `db/scripts/conferir-rls.sql` |
| `core.plano_rv`: A não lê nem grava B; sem contexto = 0; FK do autor no próprio tenant | `db/testes/plano-rv.test.ts` |
| `macuxi_portal` (0038): EXECUTE só nas `sa_*` (pelo catálogo; app, worker e PUBLIC sem); sem atributo indevido, filiação, posse ou grant de tabela (42501 nas 4 do super-admin, `tenant`, `parametro`, `core.*`); só `USAGE` em `plataforma`; login real pela `urlPortal`; up/down devolve a 0035 e é idempotente | `db/testes/papel-portal.test.ts` + `db/testes/conformidade.test.ts` + `db/scripts/conferir-rls.sql` |
| Portal só com e-mail e senha (0039): app e worker 42501 nas 12 `sa_*` e na `criar_super_admin`; portal 42501 em `core.usuario`, `tenant` e nas 3 tabelas novas; contas do e-mail só de admin ativo de empresa ativa (até 20, sem e-mail na auditoria); bloqueio por chave; escolha de empresa só da lista e com admin ainda admin; sessão do cliente cai na hora; `criar_super_admin` idempotente e não desativa o último; down volta ao catálogo e às ACLs da 0038 | `db/testes/portal-email-senha.test.ts` + `db/testes/papel-portal.test.ts` + `db/scripts/conferir-rls.sql` |
| macuxi_worker: lê A e B, 42501 fora das colunas/tabelas concedidas, só marca 3 colunas, sem BYPASSRLS; app sem contexto = 0 | `db/testes/worker.test.ts` |
| Outbox de e-mail (0040): app só insere e lê o próprio tenant (update/delete 42501); worker lê A e B, marca só a linha pendente e só as colunas do despacho, sem insert/delete; política do worker só nas duas outboxes; portal sem privilégio; CHECKs da carga e da senha temporária; sessão do portal cai com `sessao_versao` nova e com `trocar_senha` | `db/testes/senha-email-saida.test.ts` + `db/scripts/conferir-rls.sql` |
| Redefinir a senha do admin pelo portal (0042): app e worker 42501 nas 2 `sa_*` novas (agora 14 do portal); só sessão de super-admin (cliente = 28000); portal continua sem privilégio direto em `core.usuario` e na `email_saida`; alvo só admin ativo da empresa pedida (outro tenant = P0002); B intacto; auditoria sem e-mail, hash nem carga; down volta às ACLs da 0041 | `db/testes/portal-redefinir-senha.test.ts` + `db/testes/papel-portal.test.ts` |
| Logo e nome fantasia (0081, T-0182): o `macuxi_app` do tenant B não vê a linha do A (nem pelo id) e o A vê a própria marca; contexto vazio = 0 linhas; app 42501 ao gravar `plataforma.tenant`; app e worker 42501 nas 4 `sa_*` da marca e na interna `marca_da_empresa_json`; portal 42501 direto na tabela; admin do cliente lê só a empresa atual da sessão e não grava nenhuma (42501); a chave da logo só aceita o prefixo do próprio tenant (CHECK) | `db/testes/tenant-logo.db.test.ts` |
| B1 do DBaaS (0031): política `manutencao` em toda tabela com RLS; tabela nova sem ela é acusada; app e worker não são membros (nem herdam nem assumem); o migrador herda | `db/testes/conformidade.test.ts` + `db/testes/estatico.test.ts` |
| B2 do DBaaS (0032): `excluir_tenant` sem `session_replication_role`, por um papel sem superusuário só com a política `manutencao` (sem ela: P0002) | `db/testes/lgpd-outbox.test.ts` |
