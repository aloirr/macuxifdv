# Dicionário de dados — schema `plataforma`

Migração `db/migrations/0001_plataforma.up.sql` (volta: `.down.sql`). Drizzle: `db/esquema/plataforma.ts`.
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

Função `tenant_por_codigo(codigo)` (SECURITY DEFINER) para o login. Aplicação: só `SELECT` (vê o próprio).

## tenant_modulo — módulos do tenant (RN-CORE-01/02)
| Coluna | Tipo | Regra |
|---|---|---|
| modulo | text not null | id do módulo (`core`, `vendedor`, ..., `teste`); único por tenant |
| ativo | boolean not null | `core` não pode ficar inativo (check) |
| plano, licencas | text, integer | licenças >= 0 |
| parametros | jsonb not null | configuração do módulo no tenant |
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

Índices: `(ocorrido_em) where publicado_em is null` (fila), `(tenant_id, ocorrido_em, id)`. Gravado na mesma transação do fato.

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
