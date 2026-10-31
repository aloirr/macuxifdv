# Dicionário de dados — schema `core`

Migrações `db/migrations/0002_core.up.sql`, `0003_plataforma_worker` (índice da carteira) e `0004_core_sessao` (sessão, aparelho, tentativas; volta: `.down.sql` de cada uma). Drizzle: `modules/core/db/nuvem.ts` (uso interno do Core).
Campos comuns e RLS como em [plataforma.md](plataforma.md). Toda FK entre tabelas do tenant é composta
`(tenant_id, x_id) → (tenant_id, id)`; toda tabela sincronizada tem índice de sync `(tenant_id, updated_at, id)` (`sessao` e `dispositivo` ficam fora do sync) e
`external_id` único por tenant (quando preenchido).

## equipe — árvore de equipes (RN-CORE-04)
| Coluna | Tipo | Regra |
|---|---|---|
| nome | text not null | |
| equipe_pai_id | uuid | FK composta para `equipe`; diferente do próprio id |
| responsavel_id | uuid | FK composta para `usuario` (supervisor da equipe; gerente no nó de cima) |
| ativo | boolean not null | |

Índice `equipe_responsavel_ix (tenant_id, responsavel_id)` (0004): equipes de que o usuário é responsável.
Escopo: supervisor vê a carteira da equipe de que é responsável; gerente vê as equipes abaixo do seu nó (CTE recursiva por `equipe_pai_id`).

## usuario
| Coluna | Tipo | Regra |
|---|---|---|
| nome, nome_curto | text | |
| email | text not null | único **por tenant** em minúsculas `(tenant_id, lower(email))` (Q3); formato validado |
| perfil | text not null | `admin, analista, assistente, supervisor, gerente, vendedor, promotor` |
| equipe_id | uuid | FK composta para `equipe` |
| senha_hash | text | só argon2id em PHC (`$argon2id$...`, check) |
| ativo, bloqueado_em, ultimo_login_em | | `bloqueado_em` = bloqueio MANUAL do admin (RF-CORE-01) |
| tentativas_falhas | smallint not null default 0 | (0004) falhas de senha seguidas, `>= 0`; 5 falhas => `bloqueio_ate` = agora + 15 min; login certo zera (regra no domain do Core) |
| bloqueio_ate | timestamptz | (0004) bloqueio TEMPORÁRIO por tentativas |

Login: código da empresa → `plataforma.tenant_por_codigo` → transação com o tenant → `where lower(email) = lower($1)`.

## produto — cadastro base (ADR-0005)
| Coluna | Tipo | Regra |
|---|---|---|
| sku | text not null | único por tenant |
| ean | text | 8 a 14 dígitos |
| nome, marca, categoria | text | |
| unidade | text not null | padrão `UN` (`PC`, `JG`, ...) |
| ativo | boolean not null | |

Preço, estoque, conteúdo, mídia, sinônimos e embeddings ficam no schema `catalogo` (por contrato, nunca FK cruzada de leitura).

## cliente
| Coluna | Tipo | Regra |
|---|---|---|
| documento | text | CPF (11) ou CNPJ (14) só dígitos; único por tenant |
| razao_social | text not null | |
| nome_fantasia, segmento, telefone, email | text | |
| logradouro, numero, bairro, cidade, uf, cep | text | `uf` com 2 letras maiúsculas |
| latitude, longitude | numeric(9,6) | opcionais (RN-CORE-10: 1º check-in sugere coordenada) |
| ativo | boolean not null | |

## carteira — cliente x usuário (RN-CORE-04)
| Coluna | Tipo | Regra |
|---|---|---|
| cliente_id | uuid not null | FK composta para `cliente` |
| usuario_id | uuid not null | FK composta para `usuario` |
| papel | text not null | `vendedor` \| `promotor` |
| inicio, fim | date | `fim >= inicio` |

Índices: único `(tenant_id, cliente_id, usuario_id, papel)` ativo; `(tenant_id, usuario_id)` (escopo do vendedor/promotor); `(tenant_id, cliente_id)`;
`carteira_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)` **sem** filtro de `deleted_at` (migração 0003): pull
da carteira por usuário inclusive removidas (Q6 de [desempenho-sync.md](desempenho-sync.md)).

## dispositivo — aparelho do usuário (0004; RF-CORE-01 bloqueio remoto). Fora do sync
| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid | gerado NO APARELHO; o login faz upsert `on conflict (id)` |
| usuario_id | uuid not null | FK composta para `usuario` |
| nome, plataforma | text | ex.: `Moto G`, `android` |
| ultimo_acesso_em | timestamptz | atualizado a cada login |
| bloqueado_em | timestamptz | bloqueio remoto: o login recusa o aparelho |

Índices: PK `id`; `dispositivo_usuario_ix (tenant_id, usuario_id)`; único `(tenant_id, id)` (alvo da FK de `sessao`).
Volume: 1-2 por usuário.

## sessao — refresh token rotativo (0004; doc 04 "Sessão"). Fora do sync
| Coluna | Tipo | Regra |
|---|---|---|
| usuario_id | uuid not null | FK composta para `usuario` |
| familia_id | uuid not null | todos os refresh descendentes de um login; reuso de refresh já usado revoga a família |
| token_hash | text not null | sha256 **hex** do segredo (check `^[0-9a-f]{64}$`); único POR tenant. O cliente recebe `<tenant_id>.<segredo>` |
| dispositivo_id | uuid | FK composta para `dispositivo` (opcional) |
| expira_em | timestamptz not null | 30 dias |
| usado_em | timestamptz | rotação: marca usado e cria o próximo da família |
| revogado_em | timestamptz | logout, reuso (roubo) ou bloqueio remoto |

Índices: `sessao_token_uk (tenant_id, token_hash)` único; `sessao_familia_ix (tenant_id, familia_id)`;
`sessao_usuario_ativa_ix (tenant_id, usuario_id) where revogado_em is null` (revogar tudo do usuário);
`sessao_expira_ix (tenant_id, expira_em)` (limpeza). Volume: ~1 linha por login/refresh por aparelho; limpeza por expiração
(job futuro). EXPLAIN com 6 mil sessões em `db/testes/sessao.test.ts`: todas as consultas usam o índice com o predicado
da RLS (`tenant_id = tenant_atual()`, função SQL inline) na `Index Cond`.

Upsert do aparelho (`on conflict (id) do update ... where core.dispositivo.usuario_id = excluded.usuario_id`): se o id
já é de OUTRO usuário (mesmo tenant) ou de outro tenant, o `where` descarta (0 linhas, sem erro) e a linha alheia não muda.

## Volume e consultas principais (para EXPLAIN quando houver dados)
- Sync pull por entidade: `where tenant_id = $t and (updated_at, id) > ($cursor_ts, $cursor_id) order by updated_at, id limit 1000` — índice de sync.
- Carteira do vendedor: `carteira where tenant_id = $t and usuario_id = $u and deleted_at is null` — `carteira_usuario_ix`.
- Volume alvo por tenant: 500 clientes por vendedor, 20 mil SKUs (doc 04).
- Login/refresh (`modules/core/api/repositorio.ts`): `usuario where lower(email) = lower($1)` (`usuario_email_uk`); `sessao where token_hash = $1` (`sessao_token_uk`); revogar família (`sessao_familia_ix`); aparelho por `id` (PK).
