# Dicionário de dados — schema `core`

Migração `db/migrations/0002_core.up.sql` (volta: `.down.sql`). Drizzle: `modules/core/db/nuvem.ts` (uso interno do Core).
Campos comuns e RLS como em [plataforma.md](plataforma.md). Toda FK entre tabelas do tenant é composta
`(tenant_id, x_id) → (tenant_id, id)`; toda tabela tem índice de sync `(tenant_id, updated_at, id)` e
`external_id` único por tenant (quando preenchido).

## equipe — árvore de equipes (RN-CORE-04)
| Coluna | Tipo | Regra |
|---|---|---|
| nome | text not null | |
| equipe_pai_id | uuid | FK composta para `equipe`; diferente do próprio id |
| responsavel_id | uuid | FK composta para `usuario` (supervisor da equipe; gerente no nó de cima) |
| ativo | boolean not null | |

Escopo: supervisor vê a carteira da equipe de que é responsável; gerente vê as equipes abaixo do seu nó (CTE recursiva por `equipe_pai_id`).

## usuario
| Coluna | Tipo | Regra |
|---|---|---|
| nome, nome_curto | text | |
| email | text not null | único **por tenant** em minúsculas `(tenant_id, lower(email))` (Q3); formato validado |
| perfil | text not null | `admin, analista, assistente, supervisor, gerente, vendedor, promotor` |
| equipe_id | uuid | FK composta para `equipe` |
| senha_hash | text | só argon2id em PHC (`$argon2id$...`, check) |
| ativo, bloqueado_em, ultimo_login_em | | bloqueio remoto (RF-CORE-01) |

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

Índices: único `(tenant_id, cliente_id, usuario_id, papel)` ativo; `(tenant_id, usuario_id)` (escopo do vendedor/promotor); `(tenant_id, cliente_id)`.

## Volume e consultas principais (para EXPLAIN quando houver dados)
- Sync pull por entidade: `where tenant_id = $t and (updated_at, id) > ($cursor_ts, $cursor_id) order by updated_at, id limit 1000` — índice de sync.
- Carteira do vendedor: `carteira where tenant_id = $t and usuario_id = $u and deleted_at is null` — `carteira_usuario_ix`.
- Volume alvo por tenant: 500 clientes por vendedor, 20 mil SKUs (doc 04).
