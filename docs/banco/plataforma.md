# Dicionário de dados — schema `plataforma`

Migrações `db/migrations/0001_plataforma.up.sql`, `0003_plataforma_worker` e `0005_plataforma_arquivo` (volta: `.down.sql` de cada uma). Drizzle: `db/esquema/plataforma.ts`.
Campos comuns em toda tabela (regra 5): `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null → plataforma.tenant`,
`created_at`, `updated_at` (trigger `definir_updated_at`, cursor do sync), `deleted_at` (exclusão lógica), `external_id text` (código no ERP).
RLS: política `isolamento_tenant` em todas (ver [rls.md](rls.md)).

## tenant — empresa cliente (exceção: sem `tenant_id`)
| Coluna | Tipo | Regra |
|---|---|---|
| codigo | text not null | "código da empresa" do login; `^[a-z0-9][a-z0-9-]{1,39}$`; único (minúsculas) |
| nome | text not null | |
| documento | text | CNPJ só dígitos |
| fuso | text not null | IANA, padrão `America/Sao_Paulo` (exibição no fuso do tenant; dados em UTC) |
| plano | text not null | padrão `piloto` |
| status | text not null | `ativo` \| `suspenso` \| `encerrado` |
| geracao_base | uuid not null | 0022 (T-0079): geração dos dados do tenant, padrão `gen_random_uuid()`. **Gira** em toda operação que apaga ou volta os dados do tenant: seed demo `--recriar`, restauração de backup (`db/backup/restaurar-vm.sh`, todos os tenants) e tenant novo (primeiro seed de servidor novo). **Nunca** no uso normal. Vai no `/me` e no envelope do pull (contrato do engenheiro-software); o aparelho compara com o guardado e, se mudou, reenvia a fila, limpa a cópia local e puxa tudo |

Função `tenant_por_codigo(codigo)` (SECURITY DEFINER) para o login. Aplicação: só `SELECT` (vê o próprio).
Função `girar_geracao_base(p_tenant uuid default null) → integer` (0022, SECURITY INVOKER, sem EXECUTE para `public`,
`macuxi_app` ou `macuxi_worker`): troca `geracao_base` do tenant (null = todos) e devolve quantos girou. Só o dono do banco
(superusuário do seed e do restaurar-vm.sh) roda; a tabela tem FORCE RLS, então papel sem BYPASSRLS gira 0 (o seed trata como erro).
Caminho de volta: `0022_plataforma_geracao_base.down.sql` (apaga coluna e função; app volta ao comportamento sem marcador).
Função `tenants_ativos() → table (id uuid)` (0027, T-0039, ADR 0022; SECURITY DEFINER, `search_path = pg_catalog, plataforma,
pg_temp`, `execute` **só ao `macuxi_worker`**; `macuxi_app` e `public` sem EXECUTE): ids dos tenants com `status = 'ativo'` e
`deleted_at is null`, ordenados por id. Só o id sai; o agendador das tarefas periódicas (`apps/api/src/agendador.ts`) lê
licenças, parâmetros e fuso depois em `comTenant` (macuxi_app, RLS). Caminho de volta: `0027_plataforma_tenants_ativos.down.sql`
(apaga a função; o worker vê `to_regprocedure` nulo e deixa o agendador desligado com warn). Teste: `db/testes/tenants-ativos.test.ts`.

## tenant_modulo — módulos do tenant (RN-CORE-01/02)
| Coluna | Tipo | Regra |
|---|---|---|
| modulo | text not null | id do módulo (`core`, `vendedor`, ..., `teste`); único por tenant |
| ativo | boolean not null | `core` não pode ficar inativo (check) |
| plano, licencas | text, integer | licenças >= 0 |
| parametros | jsonb not null | **legado, sem uso** (T-0016 §7, R-20261031-165647): parâmetros do tenant só em `plataforma.parametro`; `comment` de LEGADO na 0011 (a coluna fica até uma migração que a remova) |
| ativado_em, desativado_em | timestamptz | retenção de 90 dias conta de `desativado_em` (RN-CORE-02) |

Índices: único `(tenant_id, modulo)` ativo; sync `(tenant_id, updated_at, id)`.

## perfil_modulo — módulos por perfil (RN-CORE-01)
| Coluna | Tipo | Regra |
|---|---|---|
| perfil | text not null | `admin, analista, assistente, supervisor, gerente, vendedor, promotor` |
| modulo | text not null | único `(tenant_id, perfil, modulo)` |

## usuario_modulo — exceção por usuário (RN-CORE-01)
| Coluna | Tipo | Regra |
|---|---|---|
| usuario_id | uuid not null | FK composta `(tenant_id, usuario_id) → core.usuario` (criada na 0002) |
| modulo | text not null | único `(tenant_id, usuario_id, modulo)` |
| efeito | text not null | Sprint 0: só `remover` (exceção nunca acrescenta módulo) |
| motivo | text | |

Módulos efetivos = ativos do tenant ∩ perfil − exceções (calculado no `domain` do Core, revalidado por requisição).

## evento — outbox (doc 04 "Comunicação entre módulos")
| Coluna | Tipo | Regra |
|---|---|---|
| nome | text not null | `<modulo>.<entidade>.<fato>@N` (ex.: `core.usuario.modulos_alterados@1`) |
| modulo | text not null | = 1º segmento do nome (check) |
| agregado_id | uuid | entidade de origem |
| payload | jsonb not null | sem dado pessoal desnecessário |
| ocorrido_em | timestamptz not null | |
| publicado_em | timestamptz | NULL = pendente para o pg-boss |
| tentativas, ultimo_erro | integer, text | controle de entrega |
| usuario_id | uuid | autor do fato (envelope do SDK; 0003). Sem FK (o evento pode vir do Hub/sistema) |
| request_id | text | requisição de origem (rastreio ponta a ponta; 0003) |

Índices: `(ocorrido_em) where publicado_em is null` (fila), `(tenant_id, ocorrido_em, id)`, único `(tenant_id, id)`
(`evento_tenant_id_uk`, alvo da FK de `evento_consumo`). Gravado na mesma transação do fato.
Acesso: `macuxi_app` pelo RLS do tenant; `macuxi_worker` (ADR 0007) lê todos os tenants e só atualiza
`publicado_em`, `tentativas`, `ultimo_erro` (ver [rls.md](rls.md)).

**Retenção (0011, T-0032)**: `plataforma.expurgar_outbox(p_agora timestamptz default now(), p_limite int default 10000)`
devolve `(item, quantidade)` para `evento` e `evento_consumo`. Por tenant, apaga os eventos **publicados** há mais de N dias
(até `p_limite` por tenant por chamada) e os consumos deles na mesma transação; evento pendente (`publicado_em` nulo) nunca
sai. N = parâmetro `plataforma.parametro` (`modulo = 'plataforma'`, `chave = 'outbox.retencao_dias'`, número de dias; sem
linha = **30**; limitado a 7..365). `SECURITY DEFINER`, `search_path = pg_catalog, plataforma, pg_temp` (0012), `execute` só ao `macuxi_worker` (agendamento do
engenheiro-software). Índice `evento_publicado_ix (tenant_id, publicado_em) where publicado_em is not null`. Motivo: a carga
inicial do Hub gera ~100 a 200 mil eventos por tenant.

**Resumo para o `/v1/saude` (0024, T-0078)**: `plataforma.resumo_outbox(p_nomes text[], p_max_tentativas integer)` devolve uma
linha `(pendentes integer, parados integer, mais_antigo_s double precision)` com os eventos não publicados de **todos** os
tenants cujo nome está em `p_nomes`: `pendentes` = `tentativas < p_max_tentativas`, `parados` = `tentativas >= p_max_tentativas`,
`mais_antigo_s` = segundos desde o `ocorrido_em` mais antigo dos pendentes (nulo sem pendente). Lista nula ou vazia = 0, 0,
nulo. Só agregados: nenhum id, tenant, payload ou erro sai. `SECURITY DEFINER`, `search_path = pg_catalog, plataforma, pg_temp`,
`execute` só ao `macuxi_app` (a API chama em `apps/api/src/banco.ts`, `resumoOutbox`; o worker conta direto com a política
`despacho_outbox`). Índice `evento_pendente_ix`.

## evento_consumo — consumo idempotente da outbox (ADR 0007, migração 0003)
| Coluna | Tipo | Regra |
|---|---|---|
| consumidor | text not null | `<modulo>.<nome>` (check de formato, minúsculas) |
| evento_id | uuid not null | FK composta `(tenant_id, evento_id)` -> `evento (tenant_id, id)`, `on delete cascade` |
| processado_em | timestamptz not null | default `now()` |

Único `evento_consumo_uk (tenant_id, consumidor, evento_id)` (sem predicado: chave de idempotência absoluta); índice
`(tenant_id, evento_id)`. O handler grava na transação do efeito com
`on conflict (tenant_id, consumidor, evento_id) do nothing` (0 linhas = já processado). RLS por tenant para
`macuxi_app`; nenhum acesso do `macuxi_worker`. Fora do sync do app.

## parametro — parâmetros do tenant (doc 03, tabela de padrões)
| Coluna | Tipo | Regra |
|---|---|---|
| modulo | text not null | dono do parâmetro |
| chave | text not null | `^[a-z][a-z0-9_.]*$`; único `(tenant_id, modulo, chave)` |
| valor | jsonb not null | número, texto, booleano ou objeto |

## auditoria — RN-AUD-01 (quem, quando, antes/depois)
| Coluna | Tipo | Regra |
|---|---|---|
| usuario_id | uuid | autor (NULL = sistema/integração) |
| modulo, acao, entidade | text not null | ex.: `core`, `licenca.alterar`, `usuario_modulo` |
| entidade_id | uuid | |
| antes, depois | jsonb | |
| request_id | text | correlação com o log |
| ocorrido_em | timestamptz not null | |

Aplicação só faz `SELECT` e `INSERT`. Índices `(tenant_id, ocorrido_em, id)` e `(tenant_id, entidade, entidade_id)`.

**Parâmetros padrão do Core** (0006): `core.semear_padroes` grava em todo tenant (existentes e novos, gatilho
`tenant_semear_core`) `core / checkin.raio_m = 200` (RN-CORE-10) e `core / metas.base_apuracao = "aprovado"` (RN-CORE-21),
com id `uuid_de_chave('<tenant_id>:plataforma.parametro:core:<chave>')` e `on conflict do nothing` (valor editado pelo
tenant é mantido). As chaves antigas `raio_checkin_m` / `base_apuracao_metas` do seed Fase M e da fixture ficam como legado
(não são lidas pelo Core novo).

## arquivo — fotos/arquivos enviados pelo aparelho (0005, ADR 0010). Fora do sync
| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid | UUID do aparelho (o mesmo gravado na coluna que referencia, ex.: `core.visita.foto_fachada_id`) |
| modulo | text not null | dono (licença checada no GET) |
| finalidade | text not null | ex.: `fachada`, `gondola_antes` |
| entidade, entidade_id | text, uuid not null | dono lógico (ex.: `visita` / id) |
| cliente_id | uuid | FK composta para `core.cliente` (escopo de carteira do GET) |
| enviado_por | uuid not null | FK composta para `core.usuario` (o upload só completa linha do mesmo usuário) |
| tipo | text not null | só `image/jpeg` |
| tamanho_bytes | integer | 1 a 2.097.152 (2 MB) |
| sha256 | text | hex 64 (idempotência do upload) |
| largura_px, altura_px | integer | > 0 |
| situacao | text not null | `aguardando` (criada pelo módulo na transação do comando) → `recebido` (rota `PUT /v1/arquivos/:id`) |
| recebido_em, chave_armazenamento | | `recebido` exige `recebido_em`, `sha256`, `tamanho_bytes` e `chave_armazenamento` (`<tenant_id>/<modulo>/<aaaa-mm>/<id>.jpg`) |

Índices: `arquivo_entidade_ix (tenant_id, entidade, entidade_id)`; parcial `arquivo_aguardando_ix (tenant_id, situacao) where
situacao = 'aguardando'` (monitor de fotos que não chegaram); `(tenant_id, cliente_id)`; único `(tenant_id, id)` (alvo de FK).
Os bytes NUNCA ficam no banco (porta `ArmazenamentoArquivos`); o down da 0005 deixa os bytes órfãos.

## Funções
- `plataforma.tenant_atual()` (0001): contexto do tenant (falha fechada).
- `plataforma.tenant_por_codigo(text)` (0001): login, SECURITY DEFINER revisada; `pg_temp` no fim do `search_path` (0012).
- `plataforma.uuid_de_chave(text)` (0005): UUID determinístico (md5 de `macuxi:<chave>` com versão 5 e variante RFC 4122),
  gêmeo de `idDeChave` em `db/src/ids.ts`. Usado nas linhas padrão semeadas em todo tenant.
- `plataforma.resumo_outbox(text[], integer)` (0024): contagens da outbox para o `/v1/saude` (seção evento).
- `plataforma.tenants_ativos()` (0027): ids dos tenants ativos para o agendador do worker (seção tenant); só `macuxi_worker`.
- LGPD (0024, T-0078; roteiro [lgpd.md](lgpd.md)): `anonimizar_usuario(p_tenant, p_usuario)`, `anonimizar_cliente(p_tenant,
  p_cliente)`, `anonimizar_contato(p_tenant, p_contato)` e `excluir_tenant(p_tenant, p_codigo)`. Todas `SECURITY INVOKER`,
  `search_path` fixo, sem `execute` para `public`, `macuxi_app` ou `macuxi_worker`: só o dono do banco roda, à mão. Devolvem
  `(item|tabela, quantidade)`. `excluir_tenant` exige o código do tenant e `status = 'encerrado'` e apaga toda tabela com
  `tenant_id` (descoberta pelo catálogo) com `session_replication_role = replica` local à transação (superusuário).
